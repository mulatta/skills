import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

const SYNOPSIS = `usage: history.ts prepare [base] [head]
       history.ts verify backup [head]
`;
const USAGE = `${SYNOPSIS}
Prepare a history inventory and verify tree preservation without rewriting.

commands:
  prepare [base] [head]  print the inventory of base..head as JSON and create a
                         backup ref under refs/backup/tidy/; base defaults to the
                         branch origin/HEAD names, then main, then master;
                         head defaults to HEAD
  verify backup [head]   compare the trees of backup and head (default HEAD);
                         exit 0 identical, 1 different, 2 error

options:
  -h, --help             show this help and exit
`;
const TIMEOUT_MS = 30_000;
const BACKUP_PREFIX = "refs/backup/tidy/";
const MARKERS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "sequencer",
];

type Inventory = {
  baseRef: string;
  baseOid: string;
  headRef: string;
  headOid: string;
  currentHead: string;
  branch: string;
  mergeBase: string;
  status: string;
  commits: string;
  merges: string;
  stat: string;
  matrix: string;
  backupRef: string | null;
};

type Comparison = {
  backupOid: string;
  headOid: string;
  originalTree: string;
  rewrittenTree: string;
  identical: boolean;
};

type Command =
  | { command: "prepare"; base: string | null; head: string }
  | { command: "verify"; backup: string; head: string };

type GitResult = { exitCode: number; stdout: string; stderr: string };

function run(args: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], { timeout: TIMEOUT_MS });
  if (result.exitedDueToTimeout) {
    throw new Error(`git ${args.join(" ")} timed out after ${TIMEOUT_MS / 1000} seconds`);
  }
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function git(args: string[], optional = false): string {
  const result = run(args);
  if (result.exitCode === 0) {
    return result.stdout;
  }
  if (optional && result.exitCode === 1) {
    return "";
  }
  throw new Error(result.stderr || `git ${args[0]} failed`);
}

function resolve(ref: string): string {
  return git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
}

function branchExists(branch: string): boolean {
  const result = run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new Error(result.stderr || `Branch lookup failed: ${branch}`);
}

function defaultBase(): string {
  const remote = git(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    true,
  );
  const candidates = remote.startsWith("origin/") ? [remote.slice("origin/".length)] : [];
  candidates.push("main", "master");
  for (const branch of candidates) {
    if (branchExists(branch)) {
      return branch;
    }
  }
  return "main";
}

function backupName(headOid: string): string {
  const micros = Math.floor((performance.timeOrigin + performance.now()) * 1000);
  const now = new Date(Math.floor(micros / 1000));
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const timestamp = [
    pad(now.getUTCFullYear(), 4),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    pad(micros % 1_000_000, 6),
  ].join("");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `${BACKUP_PREFIX}${timestamp}-${headOid.slice(0, 12)}-${suffix}`;
}

function rejectOperationInProgress(): void {
  for (const marker of MARKERS) {
    if (existsSync(git(["rev-parse", "--git-path", marker]))) {
      throw new Error(`Finish or abort in-progress operation: ${marker}`);
    }
  }
}

function prepare(baseArg: string | null, headRef: string): Inventory {
  git(["rev-parse", "--show-toplevel"]);
  const baseRef = baseArg || defaultBase();
  const baseOid = resolve(baseRef);
  const headOid = resolve(headRef);
  rejectOperationInProgress();
  const mergeBase = git(["merge-base", baseOid, headOid]);
  const range = `${mergeBase}..${headOid}`;
  const commits = git(["log", "--reverse", "--format=%H %s", range]);
  const inventory: Inventory = {
    baseRef,
    baseOid,
    headRef,
    headOid,
    currentHead: resolve("HEAD"),
    branch: git(["branch", "--show-current"]),
    mergeBase,
    status: git(["status", "--short"]),
    commits,
    merges: git(["rev-list", "--merges", "--reverse", range]),
    stat: git(["diff", "--stat", mergeBase, headOid]),
    matrix: git(["log", "--reverse", "--format=commit %H %s", "--name-status", range]),
    backupRef: null,
  };
  if (commits) {
    const backup = backupName(headOid);
    git(["update-ref", backup, headOid, "0".repeat(headOid.length)]);
    inventory.backupRef = backup;
  }
  return inventory;
}

function verify(backupRef: string, headRef: string): Comparison {
  const original = resolve(backupRef);
  const rewritten = resolve(headRef);
  const originalTree = git(["rev-parse", `${original}^{tree}`]);
  const rewrittenTree = git(["rev-parse", `${rewritten}^{tree}`]);
  return {
    backupOid: original,
    headOid: rewritten,
    originalTree,
    rewrittenTree,
    identical: originalTree === rewrittenTree,
  };
}

function usageError(message: string): never {
  process.stderr.write(`${SYNOPSIS}error: ${message}\n`);
  process.exit(2);
}

function parseCommand(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    usageError((error as Error).message);
  }
  if (parsed.values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const [command, ...positionals] = parsed.positionals;
  if (command === undefined) {
    usageError("missing command: expected prepare or verify");
  }
  if (command !== "prepare" && command !== "verify") {
    usageError(`unknown command '${command}': expected prepare or verify`);
  }
  if (positionals.length > 2) {
    usageError(`unexpected arguments: ${positionals.slice(2).join(" ")}`);
  }
  const [first, head = "HEAD"] = positionals;
  if (command === "prepare") {
    return { command, base: first ?? null, head };
  }
  if (first === undefined) {
    usageError("verify needs a backup ref");
  }
  return { command, backup: first, head };
}

function main(): number {
  const args = parseCommand(Bun.argv.slice(2));
  try {
    if (args.command === "prepare") {
      const inventory = prepare(args.base, args.head);
      process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
      return 0;
    }
    const comparison = verify(args.backup, args.head);
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
    return comparison.identical ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: (error as Error).message })}\n`);
    return 2;
  }
}

process.exitCode = main();
