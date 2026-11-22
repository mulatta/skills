import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `usage: user_turns.ts [-h] [--workspace GLOB]... [--since DATE] [--until DATE]
                     [--grep REGEX] [--width N] [--claude-root DIR] [--codex-root DIR] [--pi-root DIR]

List the turns a person typed in the Claude, Codex and pi transcripts on this machine.
Tool results, compaction summaries, injected instruction files and subagent prompts
are dropped. One tab-separated row per turn: harness, session id, date, line in the
file, \`repeat\` or \`-\`, and the text on one line. \`repeat\` marks text already seen
in an earlier session, which is what a resumed or forked session looks like.

options:
  -h, --help          show this help and exit
  --workspace GLOB    keep sessions whose cwd has a path component matching GLOB;
                      repeatable, any match keeps the session
  --since DATE        first date, YYYY-MM-DD; also skips files last written before it
  --until DATE        last date, YYYY-MM-DD (default: no limit)
  --grep REGEX        JavaScript regex the turn must contain, case-insensitive
  --width N           cut the text at N characters, 0 for none (default 200)
  --claude-root DIR   Claude Code transcripts (default ~/.claude/projects)
  --codex-root DIR    Codex transcripts (default ~/.codex/sessions)
  --pi-root DIR       pi transcripts (default ~/.pi/agent/sessions)
`;

const EXIT_OK = 0;
const EXIT_USAGE = 2;

const DEFAULT_WIDTH = 200;
const NO_UNTIL = "9999";
const CUT_MARK = "…";
const CODEX_INJECTED_PREFIXES = ["# AGENTS.md instructions", "<"];

const CLAUDE_FILES = "*/*.jsonl";
const CODEX_FILES = "*/*/*/rollout-*.jsonl";
const PI_FILES = "*/*.jsonl";

type Json = Record<string, unknown>;

type Turn = {
  harness: string;
  session: string;
  stamp: string;
  line: number;
  text: string;
};

type Found = { cwd: string; turn: Turn };

type Counter = { unreadable: number };

type Args = {
  workspaces: Bun.Glob[];
  since: string;
  until: string;
  grep: RegExp | null;
  width: number;
  claudeRoot: string;
  codexRoot: string;
  piRoot: string;
};

class UsageError extends Error {}

function isDict(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function localDate(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function filesWrittenSince(root: string, pattern: string, since: string): string[] {
  let names: string[];
  try {
    names = [...new Bun.Glob(pattern).scanSync({ cwd: root })];
  } catch {
    return [];
  }
  const paths = names.map((name) => join(root, name));
  return paths.filter((path) => localDate(statSync(path).mtimeMs) >= since);
}

function* records(path: string, counter: Counter): Generator<[number, Json]> {
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.includes('"user"') && !line.includes('"cwd"')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      counter.unreadable++;
      continue;
    }
    if (isDict(record)) yield [index + 1, record];
  }
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isDict(block)) return null;
    if (block.type !== "text" && block.type !== "input_text") return null;
    parts.push(stringOr(block.text, ""));
  }
  return parts.join("\n");
}

function isTypedClaudeTurn(record: Json): boolean {
  if (record.type !== "user") return false;
  if (record.isSidechain || record.isMeta || record.isCompactSummary) return false;
  if (isDict(record.origin) && record.origin.kind !== "human") return false;
  return true;
}

function* claudeTurns(root: string, since: string, counter: Counter): Generator<Found> {
  for (const path of filesWrittenSince(root, CLAUDE_FILES, since)) {
    const session = basename(path, ".jsonl");
    for (const [line, record] of records(path, counter)) {
      if (!isTypedClaudeTurn(record)) continue;
      const text = isDict(record.message) ? textOf(record.message.content) : null;
      if (text === null) continue;
      const stamp = stringOr(record.timestamp, "");
      yield { cwd: stringOr(record.cwd, ""), turn: { harness: "claude", session, stamp, line, text } };
    }
  }
}

function isCodexInjected(text: string): boolean {
  const lead = text.trimStart();
  return CODEX_INJECTED_PREFIXES.some((prefix) => lead.startsWith(prefix));
}

function* codexTurns(root: string, since: string, counter: Counter): Generator<Found> {
  for (const path of filesWrittenSince(root, CODEX_FILES, since)) {
    let cwd = "";
    let session = basename(path, ".jsonl");
    for (const [line, record] of records(path, counter)) {
      const payload = record.payload;
      if (!isDict(payload)) continue;
      if (record.type === "session_meta") {
        cwd = stringOr(payload.cwd, "");
        session = stringOr(payload.id, session);
        continue;
      }
      if (payload.type !== "message" || payload.role !== "user") continue;
      const text = textOf(payload.content);
      if (text === null || isCodexInjected(text)) continue;
      const stamp = stringOr(record.timestamp, "");
      yield { cwd, turn: { harness: "codex", session, stamp, line, text } };
    }
  }
}

function* piTurns(root: string, since: string, counter: Counter): Generator<Found> {
  for (const path of filesWrittenSince(root, PI_FILES, since)) {
    let cwd = "";
    const name = basename(path, ".jsonl");
    let session = name.slice(name.lastIndexOf("_") + 1);
    for (const [line, record] of records(path, counter)) {
      if (record.type === "session") {
        cwd = stringOr(record.cwd, "");
        session = stringOr(record.id, session);
        continue;
      }
      const message = record.message;
      if (!isDict(message) || message.role !== "user") continue;
      const text = textOf(message.content);
      if (text === null) continue;
      const stamp = stringOr(record.timestamp, "");
      yield { cwd, turn: { harness: "pi", session, stamp, line, text } };
    }
  }
}

function inWorkspace(cwd: string, workspaces: Bun.Glob[]): boolean {
  if (workspaces.length === 0) return true;
  const components = cwd.split("/").filter((part) => part !== "");
  return workspaces.some((glob) => components.some((part) => glob.match(part)));
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareTurns(a: Turn, b: Turn): number {
  return (
    compareText(a.stamp, b.stamp) ||
    compareText(a.harness, b.harness) ||
    compareText(a.session, b.session) ||
    a.line - b.line
  );
}

function flatten(text: string): string {
  return text.split(/\s+/).filter((word) => word !== "").join(" ");
}

function cut(text: string, width: number): string {
  if (width === 0) return text;
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  return chars.slice(0, width).join("") + CUT_MARK;
}

function parseWidth(text: string): number {
  const width = Number(text);
  if (text.trim() === "" || !Number.isInteger(width) || width < 0) {
    throw new UsageError(`--width: expected a whole number of characters, got '${text}'`);
  }
  return width;
}

function parseGrep(source: string | undefined): RegExp | null {
  if (source === undefined || source === "") return null;
  try {
    return new RegExp(source, "iu");
  } catch (error) {
    throw new UsageError(`--grep: not a valid JavaScript regex '${source}': ${(error as Error).message}`);
  }
}

function parseCli(argv: string[]): Args | "help" {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: "boolean", short: "h" },
        workspace: { type: "string", multiple: true },
        since: { type: "string" },
        until: { type: "string" },
        grep: { type: "string" },
        width: { type: "string" },
        "claude-root": { type: "string" },
        "codex-root": { type: "string" },
        "pi-root": { type: "string" },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help) return "help";
  const home = homedir();
  return {
    workspaces: (values.workspace ?? []).map((glob) => new Bun.Glob(glob)),
    since: values.since ?? "",
    until: values.until ?? NO_UNTIL,
    grep: parseGrep(values.grep),
    width: values.width === undefined ? DEFAULT_WIDTH : parseWidth(values.width),
    claudeRoot: values["claude-root"] ?? join(home, ".claude/projects"),
    codexRoot: values["codex-root"] ?? join(home, ".codex/sessions"),
    piRoot: values["pi-root"] ?? join(home, ".pi/agent/sessions"),
  };
}

function collectTurns(args: Args, counter: Counter): Turn[] {
  const turns: Turn[] = [];
  const sources = [
    claudeTurns(args.claudeRoot, args.since, counter),
    codexTurns(args.codexRoot, args.since, counter),
    piTurns(args.piRoot, args.since, counter),
  ];
  for (const source of sources) {
    for (const { cwd, turn } of source) {
      if (inWorkspace(cwd, args.workspaces)) turns.push(turn);
    }
  }
  return turns.sort(compareTurns);
}

function inWindow(day: string, args: Args): boolean {
  return day >= args.since && day <= args.until + "~";
}

function report(turns: Turn[], args: Args, counter: Counter): void {
  const firstSession = new Map<string, string>();
  const sessions = new Set<string>();
  const rows: string[] = [];
  for (const turn of turns) {
    const flat = flatten(turn.text);
    if (!firstSession.has(flat)) firstSession.set(flat, turn.session);
    const mark = firstSession.get(flat) === turn.session ? "-" : "repeat";
    const day = turn.stamp.slice(0, 10);
    if (!inWindow(day, args)) continue;
    if (args.grep !== null && !args.grep.test(flat)) continue;
    const row = [turn.harness, turn.session, day, String(turn.line), mark, cut(flat, args.width)];
    rows.push(row.join("\t") + "\n");
    sessions.add(turn.session);
  }
  process.stdout.write(rows.join(""));
  process.stderr.write(
    `${rows.length} turns in ${sessions.size} sessions; ${counter.unreadable} unreadable lines; this machine only\n`,
  );
}

function main(argv: string[]): number {
  let args: Args | "help";
  try {
    args = parseCli(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${USAGE}error: ${error.message}\n`);
    return EXIT_USAGE;
  }
  if (args === "help") {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }
  const counter: Counter = { unreadable: 0 };
  report(collectTurns(args, counter), args, counter);
  return EXIT_OK;
}

process.exitCode = main(process.argv.slice(2));
