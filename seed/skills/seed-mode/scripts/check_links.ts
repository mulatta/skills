import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const USAGE = "usage: check_links.ts [-h] [roots ...]";
const HELP = `${USAGE}

Report relative references in a skill tree that have no target: markdown
links, script paths inside backticks, and skills named in bold or backticks.
Exit status is 0 when every reference resolves, 1 while any is unresolved,
and 2 on a usage error or a root that is not a directory.

positional arguments:
  roots       trees to check, installed side by side; the one this script sits
              in when omitted

options:
  -h, --help  show this help message and exit`;

const MD_LINK = /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;
const CODE_PATH =
  /`[^`]*?(?<![~/\p{L}\p{N}_.-])((?:[\p{L}\p{N}_.-]+\/)+[\p{L}\p{N}_-]+\.(?:py|sh|mjs|js|json|ts))(?![\p{L}\p{N}_.])[^`]*`/gu;
const BOLD_NAME = /\*\*([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\*\*( (?:principle )?skill)?/g;
const TICK_NAME = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)` skill/g;
const LINE_BREAK = /\r\n|\n|\r/;
const TEXT_SUFFIXES = [".md", ".yaml", ".yml"];
const SKIPPED_DIRS = new Set(["evals", "__pycache__", "node_modules"]);
const HERE = realpathSync(import.meta.dir);
const DEFAULT_ROOT = dirname(dirname(HERE));
const ALLOWLIST = join(HERE, "check_links_allow.txt");

const EXIT_RESOLVED = 0;
const EXIT_UNRESOLVED = 1;
const EXIT_USAGE = 2;

type Reference = { line: number; target: string };
type NamedSkill = { line: number; name: string; written: string };
type Gap = { path: string; line: number; target: string };

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function references(text: string): Reference[] {
  const found: Reference[] = [];
  text.split(LINE_BREAK).forEach((content, index) => {
    for (const match of content.matchAll(MD_LINK)) {
      found.push({ line: index + 1, target: (match[1] ?? "").split("#")[0] ?? "" });
    }
    for (const match of content.matchAll(CODE_PATH)) {
      found.push({ line: index + 1, target: match[1] ?? "" });
    }
  });
  return found.filter((reference) => reference.target !== "");
}

function namedSkills(text: string): NamedSkill[] {
  const found: NamedSkill[] = [];
  text.split(LINE_BREAK).forEach((content, index) => {
    for (const match of content.matchAll(BOLD_NAME)) {
      const name = match[1] ?? "";
      const saysSkill = match[2] !== undefined;
      if (name.includes("-") || saysSkill) found.push({ line: index + 1, name, written: `**${name}**` });
    }
    for (const match of content.matchAll(TICK_NAME)) {
      const name = match[1] ?? "";
      found.push({ line: index + 1, name, written: `\`${name}\` skill` });
    }
  });
  return found;
}

function resolveReference(source: string, target: string, root: string): string | null {
  if (target.startsWith("/")) return null;
  const base = dirname(source);
  if (target.startsWith(".")) return join(base, target);
  for (let dir = base; ; dir = dirname(dir)) {
    const candidate = join(dir, target);
    if (existsSync(candidate)) return candidate;
    if (dir === root || dir === dirname(dir)) break;
  }
  return join(base, target);
}

function lands(landing: string | null, root: string, roots: string[]): boolean {
  if (landing === null) return false;
  if (existsSync(landing)) return true;
  const rel = relative(resolve(root), resolve(landing));
  const insideRoot = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  if (!insideRoot) return false;
  return roots.some((other) => other !== root && existsSync(join(other, rel)));
}

function hasSkill(root: string, name: string): boolean {
  return [name, `principle-${name}`].some((dir) => isFile(join(root, dir, "SKILL.md")));
}

function allowed(): Set<string> {
  const entries = new Set<string>();
  if (!isFile(ALLOWLIST)) return entries;
  for (const line of readFileSync(ALLOWLIST, "utf8").split(LINE_BREAK)) {
    const entry = (line.split("#")[0] ?? "").trim();
    if (entry) entries.add(entry);
  }
  return entries;
}

function textFiles(root: string): string[] {
  const found: string[] = [];
  const pending = [""];
  for (let rel = pending.pop(); rel !== undefined; rel = pending.pop()) {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(child);
      } else if (TEXT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(child);
      }
    }
  }
  return found
    .sort()
    .map((rel) => join(root, rel))
    .filter(isFile);
}

function unresolvedIn(root: string, roots: string[], skip: Set<string>): Gap[] {
  const gaps: Gap[] = [];
  for (const path of textFiles(root)) {
    const text = readFileSync(path, "utf8");
    for (const { line, target } of references(text)) {
      if (skip.has(target)) continue;
      if (!lands(resolveReference(path, target, root), root, roots)) gaps.push({ path, line, target });
    }
    for (const { line, name, written } of namedSkills(text)) {
      if (skip.has(name)) continue;
      if (!roots.some((other) => hasSkill(other, name))) gaps.push({ path, line, target: written });
    }
  }
  return gaps;
}

function cleanRoot(root: string): string {
  return normalize(root).replace(/(.)\/+$/, "$1");
}

function parseRoots(argv: string[]): string[] | number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    console.error(`${USAGE}\ncheck_links.ts: error: ${(error as Error).message}`);
    return EXIT_USAGE;
  }
  if (parsed.values.help) {
    console.log(HELP);
    return EXIT_RESOLVED;
  }
  const roots = parsed.positionals.map(cleanRoot);
  return roots.length ? roots : [DEFAULT_ROOT];
}

function main(): number {
  const roots = parseRoots(process.argv.slice(2));
  if (typeof roots === "number") return roots;
  for (const root of roots) {
    if (!isDir(root)) {
      console.error(`${root}: not a directory`);
      return EXIT_USAGE;
    }
  }
  const skip = allowed();
  const gaps = roots.flatMap((root) => unresolvedIn(root, roots, skip));
  for (const { path, line, target } of gaps) console.log(`${path}:${line}: ${target}`);
  console.log(`${gaps.length} unresolved references under ${roots.join(", ")}`);
  return gaps.length ? EXIT_UNRESOLVED : EXIT_RESOLVED;
}

process.exit(main());
