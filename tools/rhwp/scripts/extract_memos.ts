import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = "usage: bun scripts/extract_memos.ts [-h] [--grep TEXT] [--author NAME] [--plain] FILE\n";
const HELP = `${USAGE}
Extract memo (주석) bodies, authors and timestamps from an HWP or HWPX file.
rhwp's own IR drops memo bodies, so \`export-text\`, \`export-markdown\` and
\`dump-records\` never show them. The HWPX package carries them: each memo is
an \`hp:fieldBegin type="MEMO"\` whose \`hp:subList\` holds the body paragraphs.
An .hwp FILE is converted with \`rhwp export-hwpx\` first; the sections are
read with \`unzip\`.

Exit 0 listed (also when no memo matches), 1 the file could not be read,
2 usage error. The memo count goes to stderr.

options:
  -h, --help       print this help and exit
  --grep TEXT      only memos whose body contains TEXT
  --author NAME    only memos whose author is exactly NAME
  --plain          print the bodies only, without the header line
`;

const SECTION = /^Contents\/section[^/]*\.xml$/;
const ERROR_DETAIL_CHARS = 300;
const UNKNOWN = "?";

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/[^\s>]+\s*>|<([^\s/>!?]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

type Options = { file: string; grep: string; author: string; plain: boolean };
type XmlElement = {
  name: string;
  attrs: Map<string, string>;
  text: string | null;
  children: XmlElement[];
  parent: XmlElement | null;
};
type Memo = { id: string | null; author: string | null; when: string | null; location: string; lines: string[] };

function parseOptions(argv: string[]): Options | number {
  const fail = (message: string): number => {
    process.stderr.write(`${USAGE}error: ${message}\n`);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        grep: { type: "string" },
        author: { type: "string" },
        plain: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  if (parsed.values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const [file, ...extra] = parsed.positionals;
  if (file === undefined) return fail("FILE is required");
  if (extra.length > 0) return fail(`only one FILE is accepted, also got: ${extra.join(" ")}`);
  return {
    file,
    grep: parsed.values.grep ?? "",
    author: parsed.values.author ?? "",
    plain: parsed.values.plain ?? false,
  };
}

function toHwpx(path: string, workdir: string): string {
  if (path.toLowerCase().endsWith(".hwpx")) return path;
  const out = join(workdir, "doc.hwpx");
  const done = Bun.spawnSync(["rhwp", "export-hwpx", path, out], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode === 0 && existsSync(out)) return out;
  const status = done.exitCode === null ? `signal ${done.signalCode}` : `exit ${done.exitCode}`;
  const detail = Array.from(done.stderr.toString().trim()).slice(0, ERROR_DETAIL_CHARS).join("");
  throw new Error(`export-hwpx failed (${status}): ${detail}`);
}

function unzip(hwpx: string, args: string[]): string {
  const done = Bun.spawnSync(["unzip", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) {
    const status = done.exitCode === null ? `signal ${done.signalCode}` : `exit ${done.exitCode}`;
    throw new Error(`cannot read ${hwpx} as a zip archive (unzip ${args[0]} ${status})`);
  }
  return done.stdout.toString();
}

function sectionXml(hwpx: string): string[] {
  const names = unzip(hwpx, ["-Z1", hwpx]).split("\n");
  const sections = names.filter((name) => SECTION.test(name)).sort();
  return sections.map((name) => unzip(hwpx, ["-p", hwpx, name]));
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_match, hex?: string, decimal?: string, named?: string) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return NAMED_ENTITIES[named ?? ""] ?? "";
  });
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(ATTRIBUTE)) attrs.set(m[1] ?? "", decodeEntities(m[2] ?? m[3] ?? ""));
  return attrs;
}

const INLINE_TEXT: ReadonlyMap<string, string> = new Map([
  ["hp:tab", "\t"],
  ["hp:lineBreak", "\n"],
]);

function appendText(element: XmlElement, text: string): void {
  if (text !== "") element.text = (element.text ?? "") + text;
}

function parseXml(xml: string): XmlElement {
  const document: XmlElement = { name: "", attrs: new Map(), text: null, children: [], parent: null };
  let current = document;
  for (const m of xml.replace(/\r\n?/g, "\n").matchAll(TOKEN)) {
    const [token, cdata, name, attrSource, selfClosing, text] = m;
    if (name !== undefined) {
      const attrs = parseAttributes(attrSource ?? "");
      const element: XmlElement = { name, attrs, text: null, children: [], parent: current };
      current.children.push(element);
      appendText(current, INLINE_TEXT.get(name) ?? "");
      if (selfClosing !== "/") current = element;
    } else if (token.startsWith("</")) {
      current = current.parent ?? document;
    } else if (cdata !== undefined) {
      appendText(current, cdata);
    } else if (text !== undefined) {
      appendText(current, decodeEntities(text));
    }
  }
  return document;
}

function* descendants(element: XmlElement, name: string): Generator<XmlElement> {
  if (element.name === name) yield element;
  for (const child of element.children) yield* descendants(child, name);
}

function children(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

function localName(name: string): string {
  return name.slice(name.indexOf(":") + 1);
}

function attribute(element: XmlElement, key: string): string {
  return element.attrs.get(key) ?? UNKNOWN;
}

function location(fieldBegin: XmlElement): string {
  const parts: string[] = [];
  for (let el: XmlElement | null = fieldBegin; el !== null; el = el.parent) {
    const local = localName(el.name);
    if (local === "tc") {
      const address = children(el, "hp:cellAddr")[0];
      if (address !== undefined) parts.push(`r${attribute(address, "rowAddr")}c${attribute(address, "colAddr")}`);
    } else if (local === "tbl") {
      parts.push(`표#${attribute(el, "id")}`);
    }
  }
  if (parts.length > 0) return parts.reverse().join(" ");
  for (let el: XmlElement | null = fieldBegin; el !== null; el = el.parent) {
    if (localName(el.name) === "p") return `본문 문단#${attribute(el, "id")}`;
  }
  return UNKNOWN;
}

function memoOf(fieldBegin: XmlElement): Memo {
  const params = new Map<string, string | null>();
  for (const group of children(fieldBegin, "hp:parameters")) {
    for (const param of children(group, "hp:stringParam")) params.set(param.attrs.get("name") ?? "", param.text);
  }
  const lines: string[] = [];
  for (const subList of children(fieldBegin, "hp:subList")) {
    for (const t of descendants(subList, "hp:t")) {
      for (const part of (t.text ?? "").split("\n")) {
        const line = part.trim();
        if (line !== "") lines.push(line);
      }
    }
  }
  return {
    id: params.get("ID") ?? null,
    author: params.get("Author") ?? null,
    when: params.get("CreateDateTime") ?? null,
    location: location(fieldBegin),
    lines,
  };
}

function memos(hwpx: string): Memo[] {
  const found: Memo[] = [];
  for (const xml of sectionXml(hwpx)) {
    for (const fieldBegin of descendants(parseXml(xml), "hp:fieldBegin")) {
      if (fieldBegin.attrs.get("type") === "MEMO") found.push(memoOf(fieldBegin));
    }
  }
  return found;
}

function matches(memo: Memo, options: Options): boolean {
  if (options.grep !== "" && !memo.lines.join("\n").includes(options.grep)) return false;
  if (options.author !== "" && options.author !== (memo.author ?? "")) return false;
  return true;
}

function format(memo: Memo, plain: boolean): string {
  const body = memo.lines.join("\n");
  if (plain) return `${body}\n\n`;
  const header = `[${memo.id ?? UNKNOWN}] ${memo.author || UNKNOWN} ${memo.when ?? ""} @ ${memo.location}`;
  return `${header}\n${body || "(empty body)"}\n\n`;
}

function main(): number {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "number") return options;

  const workdir = mkdtempSync(join(tmpdir(), "rhwp-memo-"));
  try {
    const selected = memos(toHwpx(options.file, workdir)).filter((memo) => matches(memo, options));
    process.stdout.write(selected.map((memo) => format(memo, options.plain)).join(""));
    process.stderr.write(`${selected.length} memos\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

process.exitCode = main();
