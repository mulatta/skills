import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const COMMAND = [process.execPath, join(import.meta.dir, "..", "scripts", "user_turns.ts")];

type Json = Record<string, unknown>;

let home = "";
let claude = "";
let codex = "";
let pi = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "user-turns-"));
  claude = join(home, "claude");
  codex = join(home, "codex");
  pi = join(home, "pi");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function write(path: string, records: Json[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r) + "\n").join(""));
}

function claudeTurn(text: unknown, stamp: string, cwd: string, extra: Json = {}): Json {
  return {
    type: "user",
    isSidechain: false,
    cwd,
    timestamp: stamp,
    origin: { kind: "human" },
    message: { role: "user", content: text },
    ...extra,
  };
}

function codexTurn(text: string, stamp: string): Json {
  return {
    type: "response_item",
    timestamp: stamp,
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  };
}

function runScript(...args: string[]): { code: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(
    [...COMMAND, "--claude-root", claude, "--codex-root", codex, "--pi-root", pi, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: done.exitCode,
    stdout: done.stdout.toString(),
    stderr: done.stderr.toString(),
  };
}

function rows(...args: string[]): string[][] {
  const done = runScript(...args);
  expect(done.code, done.stderr).toBe(0);
  return done.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
}

test("a typed turn is reported with its file line", () => {
  write(join(claude, "-w-proj", "aaaa.jsonl"), [
    { type: "summary" },
    claudeTurn("trim the comments", "2026-10-16T01:00:00Z", "/w/proj"),
  ]);
  expect(rows("--workspace", "proj")).toEqual([
    ["claude", "aaaa", "2026-10-16", "2", "-", "trim the comments"],
  ]);
});

test("tool results, summaries and side chains are not turns", () => {
  const tool = [{ type: "tool_result", content: "comments everywhere" }];
  write(join(claude, "-w-proj", "aaaa.jsonl"), [
    claudeTurn(tool, "2026-10-16T01:00:00Z", "/w/proj"),
    claudeTurn("recap", "2026-10-16T01:01:00Z", "/w/proj", { isCompactSummary: true }),
    claudeTurn("sub", "2026-10-16T01:02:00Z", "/w/proj", { isSidechain: true }),
    claudeTurn("hook", "2026-10-16T01:03:00Z", "/w/proj", { origin: { kind: "hook" } }),
    claudeTurn("meta", "2026-10-16T01:04:00Z", "/w/proj", { isMeta: true }),
  ]);
  expect(rows("--workspace", "proj")).toEqual([]);
});

test("codex is matched by cwd and drops injected instructions", () => {
  write(join(codex, "2026", "10", "17", "rollout-2026-10-17T01-00-00-bbbb.jsonl"), [
    { type: "session_meta", payload: { id: "bbbb", cwd: "/w/proj/sub" } },
    codexTurn("# AGENTS.md instructions\n\nbe brief", "2026-10-17T01:00:00Z"),
    codexTurn("<environment_context>x</environment_context>", "2026-10-17T01:00:01Z"),
    codexTurn("too many comments", "2026-10-17T01:00:02Z"),
  ]);
  write(join(codex, "2026", "10", "17", "rollout-2026-10-17T02-00-00-cccc.jsonl"), [
    { type: "session_meta", payload: { id: "cccc", cwd: "/w/other" } },
    codexTurn("too many comments", "2026-10-17T02:00:02Z"),
  ]);
  expect(rows("--workspace", "proj")).toEqual([
    ["codex", "bbbb", "2026-10-17", "4", "-", "too many comments"],
  ]);
});

test("pi turns are read and a worktree matches its repository", () => {
  write(join(pi, "--w-.worktrees-proj-fix--", "2026-10-18T01-00-00-000Z_dddd.jsonl"), [
    { type: "session", id: "dddd", cwd: "/w/.worktrees/proj/fix" },
    {
      type: "message",
      timestamp: "2026-10-18T01:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "cut\nthese" }] },
    },
    {
      type: "message",
      timestamp: "2026-10-18T01:00:05Z",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    },
  ]);
  expect(rows("--workspace", "proj")).toEqual([["pi", "dddd", "2026-10-18", "2", "-", "cut these"]]);
});

test("a workspace name matches a whole path component", () => {
  write(join(claude, "-w-project", "aaaa.jsonl"), [
    claudeTurn("hello", "2026-10-16T01:00:00Z", "/w/project"),
  ]);
  expect(rows("--workspace", "proj")).toEqual([]);
});

test("a workspace pattern matches a component by glob", () => {
  write(join(claude, "-w-proj--worktrees-fix", "aaaa.jsonl"), [
    claudeTurn("hello", "2026-10-16T01:00:00Z", "/w/proj__worktrees/fix"),
  ]);
  expect(rows("--workspace", "proj")).toEqual([]);
  expect(rows("--workspace", "proj*")).toHaveLength(1);
});

test("a turn carried into another file is marked as a repeat", () => {
  write(join(claude, "-w-proj", "aaaa.jsonl"), [
    claudeTurn("one line only", "2026-11-15T01:00:00Z", "/w/proj"),
  ]);
  write(join(codex, "2026", "11", "17", "rollout-2026-11-17T01-00-00-bbbb.jsonl"), [
    { type: "session_meta", payload: { id: "bbbb", cwd: "/w/proj" } },
    codexTurn("one line only", "2026-11-17T01:00:00Z"),
  ]);
  expect(rows("--workspace", "proj").map((r) => [r[1], r[4]])).toEqual([
    ["aaaa", "-"],
    ["bbbb", "repeat"],
  ]);
});

test("the window and the pattern narrow the rows", () => {
  write(join(claude, "-w-proj", "aaaa.jsonl"), [
    claudeTurn("주석 너무 많음", "2026-09-30T01:00:00Z", "/w/proj"),
    claudeTurn("주석 너무 많음. 정리", "2026-10-16T01:00:00Z", "/w/proj"),
    claudeTurn("build it", "2026-10-16T02:00:00Z", "/w/proj"),
  ]);
  const found = rows("--workspace", "proj", "--since", "2026-10-01", "--grep", "주석|comment");
  expect(found.map((r) => r[3])).toEqual(["2"]);
});

test("a file last written before the window is not read", () => {
  const path = join(claude, "-w-proj", "aaaa.jsonl");
  write(path, [claudeTurn("hello", "2026-10-16T01:00:00Z", "/w/proj")]);
  const old = new Date(2026, 8, 1, 12);
  utimesSync(path, old, old);
  expect(rows("--workspace", "proj", "--since", "2026-10-01")).toEqual([]);
  expect(rows("--workspace", "proj", "--since", "2026-09-01")).toHaveLength(1);
});

test("the width cuts the text by characters and marks the cut", () => {
  write(join(claude, "-w-proj", "aaaa.jsonl"), [
    claudeTurn("주석🙂 너무\n많음", "2026-10-16T01:00:00Z", "/w/proj"),
  ]);
  expect(rows("--width", "4").map((r) => r[5])).toEqual(["주석🙂 …"]);
  expect(rows("--width", "0").map((r) => r[5])).toEqual(["주석🙂 너무 많음"]);
});

test("an unreadable line is counted, not fatal", () => {
  const path = join(claude, "-w-proj", "aaaa.jsonl");
  write(path, [claudeTurn("hello", "2026-10-16T01:00:00Z", "/w/proj")]);
  appendFileSync(path, '{"type": "user", not json\n');
  const done = runScript("--workspace", "proj");
  expect(done.code).toBe(0);
  expect(done.stderr).toContain("1 unreadable");
});

test("a malformed argument exits with status 2", () => {
  expect(runScript("--width", "wide").code).toBe(2);
  expect(runScript("--bogus").code).toBe(2);
  expect(runScript("--grep", "(").code).toBe(2);
});

test("help lists every flag and exits 0", () => {
  const done = runScript("--help");
  expect(done.code).toBe(0);
  for (const flag of ["--workspace", "--since", "--until", "--grep", "--width", "--claude-root", "--codex-root", "--pi-root"]) {
    expect(done.stdout).toContain(flag);
  }
});
