import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = "usage: bun scripts/audit_commands.ts [-h] [--json]\n";
const HELP = `${USAGE}
Check every \`rhwp ...\` line in SKILL.md and references/*.md against the
installed rhwp: does the command, the subcommand and each flag still exist.
Prose rots silently when an upgrade moves a flag. The audit runs 3 times
to catch a nondeterministic binary.

Exit 0 clean, 1 findings, 2 usage error.

options:
  -h, --help  print this help and exit
  --json      print the findings as one JSON object instead of one per line
`;

const ROOT = resolve(realpathSync(import.meta.dir), "..");
const ALLOWLIST = join(ROOT, "scripts", "audit_allowlist.json");
const PASSES = 3;
const TIMEOUT_MS = 20_000;
const GROUPS = ["edit", "inspect"];
const COMMENT_OR_CHAIN = ["#", "&&", ";", "$("];

const WORD = String.raw`[\p{L}\p{N}_]`;
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const INVOKE = new RegExp(String.raw`(?<!${WORD})rhwp ([a-z][a-z0-9_-]*)([^\n\x60|]*)`, "gu");
const FLAG = new RegExp(String.raw`(?<![\p{L}\p{N}_-])(--[a-z][a-z0-9-]*|-[A-Za-z])${BOUNDARY}`, "gu");
const PLACEHOLDER = /<[^<>\n]*>/g;
const LISTED = /^\s{2,}([a-z][a-z0-9_-]*)\s{2,}\S/u;
const SUBCOMMAND = /^\s+([a-z][a-z0-9_-]+)/u;

type Options = { json: boolean };
type FindingKind = "unknown-command" | "unknown-subcommand" | "unknown-flag";
type Finding = { file: string; line: number; kind: FindingKind; detail: string };

function parseOptions(argv: string[]): Options | number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" } },
      strict: true,
    });
  } catch (error) {
    process.stderr.write(`${USAGE}error: ${(error as Error).message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  return { json: parsed.values.json ?? false };
}

function docs(): string[] {
  const references = join(ROOT, "references");
  const names = readdirSync(references)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return [join(ROOT, "SKILL.md"), ...names.map((name) => join(references, name))];
}

function codeSpans(markdown: string): string[] {
  const fenced = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const inline = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  return [...fenced, ...inline].join("\n").split("\n");
}

function dropPlaceholdersAndComments(line: string): string {
  let out = line.replace(PLACEHOLDER, " ");
  for (const cut of COMMENT_OR_CHAIN) {
    const at = out.indexOf(cut);
    if (at >= 0) out = out.slice(0, at);
  }
  return out;
}

function rhwp(args: string[]): string {
  const done = Bun.spawnSync(["rhwp", ...args], { stdout: "pipe", stderr: "pipe", timeout: TIMEOUT_MS });
  if (done.exitedDueToTimeout) return "";
  const stdout = done.stdout.toString();
  return done.exitCode === 0 ? stdout : stdout + done.stderr.toString();
}

function listedNames(helpText: string): Set<string> {
  const names = new Set<string>();
  for (const line of helpText.split("\n")) {
    const name = LISTED.exec(line)?.[1];
    if (name) names.add(name);
  }
  return names;
}

function knownCommands(): Set<string> {
  const names = new Set<string>(["help"]);
  try {
    const capabilities = JSON.parse(rhwp(["capabilities"]) || "{}") as { commands?: { name?: unknown }[] };
    for (const command of capabilities.commands ?? []) {
      if (typeof command?.name === "string") names.add(command.name);
    }
  } catch {}
  for (const name of listedNames(rhwp(["--help"]))) names.add(name);
  return names;
}

function flagsOf(path: string[]): Set<string> {
  const helpText = rhwp([...path, "--help"]).replaceAll("/", " ");
  return new Set([...helpText.matchAll(FLAG)].map((m) => m[1] ?? ""));
}

function allowedInvocations(): Set<string> {
  const data = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as { allow: { invocation: string }[] };
  return new Set(data.allow.map((entry) => entry.invocation));
}

function audit(): Finding[] {
  const allowed = allowedInvocations();
  const commands = knownCommands();
  const groups = new Map<string, Set<string>>();
  for (const group of GROUPS) {
    if (commands.has(group)) groups.set(group, listedNames(rhwp([group, "--help"])));
  }
  const flagCache = new Map<string, Set<string>>();
  const findings: Finding[] = [];

  for (const doc of docs()) {
    const file = basename(doc);
    codeSpans(readFileSync(doc, "utf8")).forEach((raw, index) => {
      const line = index + 1;
      for (const m of dropPlaceholdersAndComments(raw).matchAll(INVOKE)) {
        const head = m[1] ?? "";
        const rest = m[2] ?? "";
        if (!commands.has(head)) {
          findings.push({ file, line, kind: "unknown-command", detail: head });
          continue;
        }
        const path = [head];
        const sub = SUBCOMMAND.exec(rest)?.[1];
        const group = groups.get(head);
        if (group && sub) {
          if (!group.has(sub)) {
            findings.push({ file, line, kind: "unknown-subcommand", detail: `${head} ${sub}` });
            continue;
          }
          path.push(sub);
        }
        const command = path.join(" ");
        let known = flagCache.get(command);
        if (known === undefined) {
          known = flagsOf(path);
          flagCache.set(command, known);
        }
        if (known.size === 0) continue;
        for (const fm of rest.matchAll(FLAG)) {
          const flag = fm[1] ?? "";
          const detail = `${command} ${flag}`;
          if (!known.has(flag) && !allowed.has(detail)) {
            findings.push({ file, line, kind: "unknown-flag", detail });
          }
        }
      }
    });
  }
  return findings;
}

function main(): number {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "number") return options;

  if (Bun.which("rhwp") === null) {
    process.stderr.write("rhwp not found; skipping\n");
    return 0;
  }

  const version = rhwp(["--version"]).trim();
  const runs = Array.from({ length: PASSES }, audit);
  const first = JSON.stringify(runs[0]);
  if (runs.some((run) => JSON.stringify(run) !== first)) {
    process.stderr.write("warning: passes disagreed; the binary is nondeterministic\n");
  }
  const findings = runs[0] ?? [];

  if (options.json) {
    const report = { version, passes: PASSES, findingCount: findings.length, findings };
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(findings.map((f) => `${f.file}:${f.line}  ${f.kind}  ${f.detail}\n`).join(""));
    const summary = `${version} / ${docs().length} documents / ${PASSES} passes / ${findings.length} findings`;
    process.stderr.write(`\n${summary}\n`);
  }
  return findings.length > 0 ? 1 : 0;
}

process.exitCode = main();
