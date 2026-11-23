import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChecksUnavailable,
  WatcherQueryError,
  buildReviewThreads,
  mapRollupNode,
  orderStack,
  parseFastCheck,
  parsePullRequest,
  parseRequiredChecks,
  parseReviewThreadPage,
  resolveChecks,
  resolveContext,
  resolveReviewThreads,
} from "./github.ts";
import {
  fakeReader,
  failedCheck,
  passingCheck,
  pendingCheck,
} from "./fakes.test-helper.ts";
import { parsePrNumber } from "./types.ts";

const context = {
  owner: "owner",
  repo: "repo",
  number: parsePrNumber(42),
};

describe("checks fallback chain", () => {
  it("uses a non-empty fast-path result without a rollup query", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [passingCheck("fast")] },
    });
    const read = await resolveChecks(reader, context);
    expect(read.source).toBe("gh-pr-checks");
    expect(read.checks.map((check) => check.name)).toEqual(["fast"]);
    expect(reader.calls).toEqual(["checksFastPath"]);
  });

  it("paginates GraphQL when the fast path is unusable", async () => {
    const reader = fakeReader({
      fastPath: { kind: "unusable", exitCode: 8, stderr: "" },
      rollupPages: [
        { checks: [passingCheck("first")], endCursor: "next" },
        { checks: [failedCheck("second")], endCursor: null },
      ],
    });
    const read = await resolveChecks(reader, context);
    expect(read.source).toBe("graphql-rollup");
    expect(read.checks.map((check) => check.name)).toEqual(["first", "second"]);
    expect(reader.calls).toEqual([
      "checksFastPath",
      "checkRollupPage:null",
      "checkRollupPage:next",
    ]);
  });

  it("falls back when valid fast-path JSON represented an empty list", async () => {
    const reader = fakeReader({
      fastPath: { kind: "checks", checks: [] },
      rollupPages: [{ checks: [pendingCheck("fallback")], endCursor: null }],
    });
    expect((await resolveChecks(reader, context)).checks[0].name).toBe(
      "fallback"
    );
    expect(reader.calls).toEqual(["checksFastPath", "checkRollupPage:null"]);
  });

  it("fails closed when both paths are empty", async () => {
    const reader = fakeReader({
      fastPath: {
        kind: "unusable",
        exitCode: 8,
        stderr: "credential cannot read checks",
      },
    });
    await expect(resolveChecks(reader, context)).rejects.toBeInstanceOf(
      ChecksUnavailable
    );
    expect(reader.calls).toEqual(["checksFastPath", "checkRollupPage:null"]);
  });
});

describe("rollup node mapping", () => {
  it("maps terminal and non-terminal CheckRun states fail closed", () => {
    const cases = [
      ["IN_PROGRESS", null, "pending", "PENDING"],
      ["COMPLETED", "SUCCESS", "passed", "SUCCESS"],
      ["COMPLETED", "NEUTRAL", "skipped", "NEUTRAL"],
      ["COMPLETED", "SKIPPED", "skipped", "SKIPPED"],
      ["COMPLETED", "ACTION_REQUIRED", "failed", "ACTION_REQUIRED"],
      ["COMPLETED", "TIMED_OUT", "failed", "FAILURE"],
      ["COMPLETED", "FUTURE_VALUE", "failed", "FAILURE"],
    ] as const;
    for (const [status, conclusion, kind, reportedState] of cases) {
      expect(
        mapRollupNode({
          __typename: "CheckRun",
          name: "ci",
          status,
          conclusion,
        })
      ).toMatchObject({ kind, reportedState });
    }
  });

  it("classifies an in-progress Code Review Gate from the rollup as the gate", () => {
    expect(
      mapRollupNode({
        __typename: "CheckRun",
        name: "Code Review Gate",
        status: "IN_PROGRESS",
        conclusion: null,
      })
    ).toMatchObject({ kind: "code-review-gate" });
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "Code Review Gate",
        state: "PENDING",
      })
    ).toMatchObject({ kind: "code-review-gate" });
  });

  it("classifies a Code Review Gate waiting on an owner approval as the gate", () => {
    expect(
      mapRollupNode({
        __typename: "CheckRun",
        name: "Code Review Gate",
        status: "COMPLETED",
        conclusion: "ACTION_REQUIRED",
        description: "1 of 2 policies",
      })
    ).toMatchObject({
      kind: "code-review-gate",
      reportedState: "ACTION_REQUIRED",
    });
  });

  it("classifies a fast-path Code Review Gate waiting on an owner approval as the gate", () => {
    expect(
      parseFastCheck({
        name: "Code Review Gate",
        state: "ACTION_REQUIRED",
        bucket: "fail",
      })
    ).toMatchObject({
      kind: "code-review-gate",
      reportedState: "ACTION_REQUIRED",
    });
    expect(
      parseFastCheck({ name: "ci", state: "ACTION_REQUIRED", bucket: "fail" })
    ).toMatchObject({ kind: "failed", reportedState: "ACTION_REQUIRED" });
  });

  it("maps StatusContext states and drops unknown typenames", () => {
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "ci",
        state: "EXPECTED",
      })
    ).toMatchObject({ kind: "pending", reportedState: "PENDING" });
    expect(
      mapRollupNode({
        __typename: "StatusContext",
        context: "ci",
        state: "FUTURE_VALUE",
      })
    ).toMatchObject({ kind: "failed", reportedState: "FUTURE_VALUE" });
    expect(mapRollupNode({ __typename: "FutureNode" })).toBeNull();
  });
});

describe("closed enum parsing", () => {
  const rawPullRequest = {
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefOid: "head",
    headRefName: "feature",
    baseRefName: "main",
    state: "OPEN",
    mergedAt: null,
    isDraft: false,
  };

  it("accepts mergeStateStatus CONFLICTING", () => {
    expect(
      parsePullRequest(
        { ...rawPullRequest, mergeStateStatus: "CONFLICTING" },
        context
      ).mergeStateStatus
    ).toBe("CONFLICTING");
  });

  it("reads gh's empty reviewDecision as no decision rather than a parse failure", () => {
    expect(
      parsePullRequest({ ...rawPullRequest, reviewDecision: "" }, context)
        .reviewDecision
    ).toBeNull();
  });

  it("still rejects an unknown reviewDecision", () => {
    expect(() =>
      parsePullRequest({ ...rawPullRequest, reviewDecision: "MAYBE" }, context)
    ).toThrow(WatcherQueryError);
  });

  it("rejects unknown enum values as retryable errors carrying the raw value", () => {
    try {
      parsePullRequest(
        { ...rawPullRequest, mergeStateStatus: "FUTURE_STATE" },
        context
      );
      throw new Error("expected parser to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherQueryError);
      if (!(error instanceof WatcherQueryError)) throw error;
      expect(error.failure).toMatchObject({
        kind: "missing-key",
        retryable: true,
        rawValue: '"FUTURE_STATE"',
      });
    }
  });
});

it("annotates Bugbot threads with distinct review-pass counts", () => {
  const response = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "one",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-1",
                      createdAt: "now",
                      path: "a.ts",
                      line: 1,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
              {
                id: "two",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      body: "CURSOR_AUTOMATION_ID: run-2 severity high",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "cursor" },
                    },
                  ],
                },
              },
              {
                id: "resolved",
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      body: "RUN_ID: run-3",
                      createdAt: "now",
                      path: null,
                      line: null,
                      author: { login: "bugbot" },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const threads = buildReviewThreads(parseReviewThreadPage(response).threads);
  expect(threads).toHaveLength(2);
  expect(threads.map((thread) => thread.isBugbot)).toEqual([true, true]);
  expect(threads.map((thread) => thread.bugbotReviewPasses)).toEqual([3, 3]);
});

describe("review thread pagination", () => {
  const thread = (id: string, resolved = false) => ({
    id,
    firstComment: {
      authorLogin: "someone",
      body: "please fix",
      path: "a.ts",
      line: 1,
      createdAt: "now",
    },
    resolved,
  });

  it("keeps walking pages until the cursor is exhausted", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("one")], endCursor: "next" },
        { threads: [thread("two")], endCursor: "last" },
        { threads: [thread("three")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, context);
    expect(threads.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(reader.calls).toEqual([
      "reviewThreadPage:null",
      "reviewThreadPage:next",
      "reviewThreadPage:last",
    ]);
  });

  it("sees an unresolved thread that sits past the first page", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("early", true)], endCursor: "next" },
        { threads: [thread("late")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, context);
    expect(threads.map((item) => item.id)).toEqual(["late"]);
  });

  it("stops after a single page when the cursor is exhausted", async () => {
    const reader = fakeReader({
      threadPages: [{ threads: [thread("only")], endCursor: null }],
    });
    expect((await resolveReviewThreads(reader, context)).length).toBe(1);
    expect(reader.calls).toEqual(["reviewThreadPage:null"]);
  });

  it("counts Bugbot review passes across every page", async () => {
    const bugbot = (id: string, runId: string) => ({
      id,
      firstComment: {
        authorLogin: "bugbot",
        body: `RUN_ID: ${runId}`,
        path: "a.ts",
        line: 1,
        createdAt: "now",
      },
      resolved: false,
    });
    const reader = fakeReader({
      threadPages: [
        { threads: [bugbot("one", "run-1")], endCursor: "next" },
        { threads: [bugbot("two", "run-2")], endCursor: null },
      ],
    });
    const threads = await resolveReviewThreads(reader, context);
    expect(threads.map((item) => item.bugbotReviewPasses)).toEqual([2, 2]);
  });

  it("drops resolved threads from later pages too", async () => {
    const reader = fakeReader({
      threadPages: [
        { threads: [thread("one")], endCursor: "next" },
        { threads: [thread("two", true)], endCursor: null },
      ],
    });
    expect(
      (await resolveReviewThreads(reader, context)).map((item) => item.id)
    ).toEqual(["one"]);
  });

  it("rejects a page that omits pageInfo instead of assuming one page", async () => {
    const response = {
      data: {
        repository: {
          pullRequest: { reviewThreads: { nodes: [] } },
        },
      },
    };
    expect(() => parseReviewThreadPage(response)).toThrow(WatcherQueryError);
  });
});

describe("context and stack discovery", () => {
  it("returns a fully explicit context without any reader call", async () => {
    const reader = fakeReader();
    expect(
      await resolveContext({
        reader,
        owner: "explicit",
        repo: "repo",
        pr: context.number,
      })
    ).toEqual({ owner: "explicit", repo: "repo", number: context.number });
    expect(reader.calls).toEqual([]);
  });

  it("uses the local origin before currentPr for an explicit number", async () => {
    const reader = fakeReader({ origin: { owner: "local", repo: "checkout" } });
    expect(
      await resolveContext({
        reader,
        owner: null,
        repo: null,
        pr: context.number,
      })
    ).toEqual({ owner: "local", repo: "checkout", number: context.number });
    expect(reader.calls).toEqual(["originRepo"]);
  });

  it("orders the connected stack bottom-to-top", () => {
    const ordered = orderStack(context, [
      {
        number: parsePrNumber(41),
        headRefName: "base-feature",
        isCrossRepository: false,
        baseRefName: "main",
      },
      {
        number: context.number,
        headRefName: "feature",
        isCrossRepository: false,
        baseRefName: "base-feature",
      },
      {
        number: parsePrNumber(43),
        headRefName: "upstack",
        isCrossRepository: false,
        baseRefName: "feature",
      },
    ]);
    expect(ordered.map((item) => Number(item.number))).toEqual([41, 42, 43]);
  });
  it("does not use a fork's same-named head as a stack parent", () => {
    const ordered = orderStack(context, [
      { number: parsePrNumber(41), headRefName: "base-feature", baseRefName: "main", isCrossRepository: true },
      { number: context.number, headRefName: "feature", baseRefName: "base-feature", isCrossRepository: false },
    ]);
    expect(ordered.map((item) => Number(item.number))).toEqual([42]);
  });

  it("does not attach upstream branch children to a fork head", () => {
    const ordered = orderStack(context, [
      { number: context.number, headRefName: "feature", baseRefName: "main", isCrossRepository: true },
      { number: parsePrNumber(43), headRefName: "upstack", baseRefName: "feature", isCrossRepository: false },
    ]);
    expect(ordered.map((item) => Number(item.number))).toEqual([42]);
  });

  it("terminates when an unrelated fork opens main against main", () => {
    // Bound the subprocess so this regression reports a failure instead of hanging the suite.
    const program = `import { orderStack } from ${JSON.stringify(import.meta.dir + "/github.ts")};
      console.log(JSON.stringify(orderStack(${JSON.stringify(context)}, [
        { number: 41, headRefName: "main", baseRefName: "main", isCrossRepository: true },
        { number: 42, headRefName: "feature", baseRefName: "main", isCrossRepository: false }
      ])));`;
    const child = spawnSync(process.execPath, ["-e", program], { encoding: "utf8", timeout: 2000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).map((item: { number: number }) => item.number)).toEqual([42]);
  });

  it("requests and parses fork identity from gh before stack discovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "watch-pr-fork-"));
    try {
      writeFileSync(join(directory, "gh"), `#!/bin/sh
case "$*" in
  *number,headRefName,baseRefName,isCrossRepository*) ;;
  *) exit 2 ;;
esac
printf '%s\\n' '[{"number":42,"headRefName":"feature","baseRefName":"main","isCrossRepository":true}]'
`, { mode: 0o755 });
      const program = `import { GhGitHubReader } from ${JSON.stringify(import.meta.dir + "/github.ts")};
        console.log(JSON.stringify(await new GhGitHubReader().openPullRequests({ owner: "owner", repo: "repo" })));`;
      const child = spawnSync(process.execPath, ["-e", program], {
        encoding: "utf8", timeout: 2000,
        env: { ...process.env, PATH: directory + ":" + process.env.PATH },
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual([
        { number: 42, headRefName: "feature", baseRefName: "main", isCrossRepository: true },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});

describe("required checks", () => {
  const rules: unknown = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "dots-894", "rules-main.json"), "utf8")
  );
  const contextsOf = (required: ReturnType<typeof parseRequiredChecks>) =>
    required.kind === "declared" ? [...required.contexts].sort() : required.kind;

  it("reads every required_status_checks ruleset that applies to the branch", () => {
    expect(contextsOf(parseRequiredChecks({ rules: { kind: "present", json: rules }, classic: { kind: "absent" } }))).toEqual([
      "gitea-mq",
      "nixbot/nix-build",
      "nixbot/nix-eval",
    ]);
  });

  it("unions rulesets with classic protection contexts and checks", () => {
    expect(
      contextsOf(
        parseRequiredChecks({
          rules: { kind: "present", json: rules },
          classic: {
            kind: "present",
            json: {
              strict: false,
              contexts: ["legacy"],
              checks: [
                { context: "legacy", app_id: null },
                { context: "app-check", app_id: 15368 },
              ],
            },
          },
        })
      )
    ).toEqual(["app-check", "gitea-mq", "legacy", "nixbot/nix-build", "nixbot/nix-eval"]);
  });

  it("is undeclared when no rule names a status check", () => {
    expect(
      parseRequiredChecks({
        rules: {
          kind: "present",
          json: [{ type: "deletion", ruleset_source_type: "Repository", ruleset_id: 1 }],
        },
        classic: { kind: "absent" },
      })
    ).toEqual({ kind: "undeclared" });
    expect(parseRequiredChecks({ rules: { kind: "absent" }, classic: { kind: "absent" } })).toEqual({ kind: "undeclared" });
  });

  it("reads both sources through gh, treats 404 as none, and reads each branch once", () => {
    const directory = mkdtempSync(join(tmpdir(), "watch-pr-required-"));
    try {
      writeFileSync(join(directory, "gh"), `#!/bin/sh
echo "$*" >> "$WATCH_PR_LOG"
case "$*" in
  "api repos/mulatta/dots/rules/branches/main") cat "$WATCH_PR_RULES" ;;
  "api repos/mulatta/dots/rules/branches/gone") echo '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  "api repos/mulatta/dots/rules/branches/"*) echo '[]' ;;
  "api repos/mulatta/dots/branches/classic/protection/required_status_checks")
    echo '{"strict":false,"contexts":["legacy"],"checks":[{"context":"legacy","app_id":null}]}' ;;
  "api repos/mulatta/dots/branches/forbidden/protection/required_status_checks")
    echo '{"message":"Resource not accessible by integration","status":"403"}'; echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1 ;;
  "api repos/mulatta/dots/branches/"*"/protection/required_status_checks")
    echo '{"message":"Branch not protected","status":"404"}'; echo "gh: Branch not protected (HTTP 404)" >&2; exit 1 ;;
  *) echo "unexpected gh $*" >&2; exit 99 ;;
esac
`, { mode: 0o755 });
      const program = `import { GhGitHubReader, WatcherQueryError } from ${JSON.stringify(import.meta.dir + "/github.ts")};
        const reader = new GhGitHubReader();
        const repository = { owner: "mulatta", repo: "dots" };
        const out = {};
        for (const base of ["main", "unprotected", "gone", "classic", "main"]) {
          const required = await reader.requiredChecks({ repository, base });
          out[base] = required.kind === "declared" ? [...required.contexts].sort() : required.kind;
        }
        try {
          await reader.requiredChecks({ repository, base: "forbidden" });
          out.forbidden = "resolved";
        } catch (error) {
          out.forbidden = error instanceof WatcherQueryError ? error.failure.kind : String(error);
        }
        console.log(JSON.stringify(out));`;
      const log = join(directory, "log");
      const child = spawnSync(process.execPath, ["-e", program], {
        encoding: "utf8", timeout: 5000,
        env: {
          ...process.env,
          PATH: directory + ":" + process.env.PATH,
          WATCH_PR_LOG: log,
          WATCH_PR_RULES: join(import.meta.dir, "fixtures", "dots-894", "rules-main.json"),
        },
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        main: ["gitea-mq", "nixbot/nix-build", "nixbot/nix-eval"],
        unprotected: "undeclared",
        gone: "undeclared",
        classic: ["legacy"],
        forbidden: "command-exit",
      });
      const reads = readFileSync(log, "utf8").trim().split("\n");
      expect(reads.filter((line) => line.includes("/main"))).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
