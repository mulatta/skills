import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMMAND = [process.execPath, join(import.meta.dir, "..", "scripts", "history.ts")];

let root = "";
let env: Record<string, string> = {};

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, env });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function runRaw(args: string[], extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync([...COMMAND, ...args], {
    cwd: root,
    env: { ...env, ...extraEnv },
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function runHelper(args: string[], code = 0): Record<string, unknown> {
  const result = runRaw(args);
  expect({ code: result.code, stderr: result.stderr }).toEqual({
    code,
    stderr: code === 2 ? result.stderr : "",
  });
  return JSON.parse(code === 2 ? result.stderr : result.stdout);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tidy-history-"));
  env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        !entry[0].startsWith("GIT_") && entry[1] !== undefined,
    ),
  );
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  git("init", "-b", "main");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "Base");
  git("checkout", "-b", "topic");
  writeFileSync(join(root, "file.txt"), "content\n");
  git("add", "file.txt");
  git("commit", "-m", "Add content");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("backup and tree comparison", () => {
  const backup = String(runHelper(["prepare"]).backupRef);
  expect(git("rev-parse", backup)).toBe(git("rev-parse", "HEAD"));
  git("commit", "--amend", "-m", "Explain intent");
  expect(runHelper(["verify", backup]).identical).toBe(true);
  writeFileSync(join(root, "file.txt"), "different\n");
  git("commit", "-am", "Change content");
  expect(runHelper(["verify", backup], 1).identical).toBe(false);
});

test("dirty preparation preserves index and worktree", () => {
  writeFileSync(join(root, "file.txt"), "staged\n");
  git("add", "file.txt");
  writeFileSync(join(root, "file.txt"), "unstaged\n");
  writeFileSync(join(root, "new.txt"), "untracked\n");
  const snapshot = () => [git("diff"), git("diff", "--cached"), git("status", "--short")];
  const before = snapshot();
  runHelper(["prepare"]);
  expect(snapshot()).toEqual(before);
  expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("untracked\n");
});

test("empty range has no backup", () => {
  expect(runHelper(["prepare", "HEAD"]).backupRef).toBeNull();
  expect(git("for-each-ref", "refs/backup/tidy")).toBe("");
});

test("invalid ref fails without backup", () => {
  runHelper(["prepare", "missing"], 2);
  expect(git("for-each-ref", "refs/backup/tidy")).toBe("");
});

test("operation in progress is rejected", () => {
  writeFileSync(join(root, ".git", "MERGE_HEAD"), `${git("rev-parse", "main")}\n`);
  expect(runHelper(["prepare"], 2)).toEqual({
    error: "Finish or abort in-progress operation: MERGE_HEAD",
  });
  expect(git("for-each-ref", "refs/backup/tidy")).toBe("");
});

test("explicit head and remote default", () => {
  git("branch", "trunk", "main");
  git("update-ref", "refs/remotes/origin/trunk", git("rev-parse", "trunk"));
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
  expect(runHelper(["prepare"]).baseRef).toBe("trunk");
  expect(runHelper(["prepare", "main", "main"]).backupRef).toBeNull();
});

test("backups are unique", () => {
  const first = runHelper(["prepare"]).backupRef;
  const second = runHelper(["prepare"]).backupRef;
  expect(first).not.toBe(second);
});

test("missing default is an error", () => {
  git("branch", "-D", "main");
  runHelper(["prepare"], 2);
});

test("prepare prints the full inventory as indented JSON", () => {
  git("checkout", "-b", "side", "main");
  writeFileSync(join(root, "side.txt"), "side\n");
  git("add", "side.txt");
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = "2099-01-01T00:00:00Z";
  git("commit", "-m", "Add side");
  git("checkout", "topic");
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = "2099-01-02T00:00:00Z";
  git("merge", "--no-ff", "-m", "Merge side", "side");
  writeFileSync(join(root, "draft.txt"), "draft\n");
  const [base, add, side, merge] = ["main", "topic~1", "side", "topic"].map((ref) =>
    git("rev-parse", ref),
  );
  const result = runRaw(["prepare", "main"]);
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(result.stdout).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  const backupRef = String(parsed.backupRef);
  expect(backupRef).toMatch(
    new RegExp(`^refs/backup/tidy/\\d{20}-${merge?.slice(0, 12)}-[0-9a-f]{8}$`),
  );
  expect(parsed).toEqual({
    baseRef: "main",
    baseOid: base,
    headRef: "HEAD",
    headOid: merge,
    currentHead: merge,
    branch: "topic",
    mergeBase: base,
    status: "?? draft.txt",
    commits: [`${add} Add content`, `${side} Add side`, `${merge} Merge side`].join("\n"),
    merges: merge,
    stat: [
      "file.txt | 1 +",
      " side.txt | 1 +",
      " 2 files changed, 2 insertions(+)",
    ].join("\n"),
    matrix: [
      `commit ${add} Add content`,
      "",
      "A\tfile.txt",
      `commit ${side} Add side`,
      "",
      "A\tside.txt",
      `commit ${merge} Merge side`,
    ].join("\n"),
    backupRef,
  });
  expect(git("for-each-ref", "--format=%(refname) %(objectname)", "refs/backup/tidy")).toBe(
    `${backupRef} ${merge}`,
  );
});

test("verify prints the tree comparison as indented JSON", () => {
  const backup = git("rev-parse", "HEAD");
  const result = runRaw(["verify", backup, "main"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    `${JSON.stringify(
      {
        backupOid: backup,
        headOid: git("rev-parse", "main"),
        originalTree: git("rev-parse", "HEAD^{tree}"),
        rewrittenTree: git("rev-parse", "main^{tree}"),
        identical: false,
      },
      null,
      2,
    )}\n`,
  );
});

test("usage errors exit 2 and help exits 0", () => {
  for (const args of [[], ["verify"], ["bogus"], ["prepare", "-x"], ["prepare", "a", "b", "c"]]) {
    const result = runRaw(args);
    expect({ args, code: result.code, stdout: result.stdout }).toEqual({ args, code: 2, stdout: "" });
    expect(result.stderr).toStartWith("usage:");
  }
  expect(runRaw(["bogus"]).stderr).toContain("'bogus'");
  const help = runRaw(["prepare", "-h"]);
  expect({ code: help.code, stderr: help.stderr }).toEqual({ code: 0, stderr: "" });
  expect(help.stdout).toStartWith("usage:");
  expect(git("for-each-ref", "refs/backup/tidy")).toBe("");
});
