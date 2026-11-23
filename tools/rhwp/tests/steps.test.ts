import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const FIXTURES = process.env.RHWP_FIXTURES;
const BIN = process.env.RHWP_BIN ?? "rhwp";
const SKILL = resolve(import.meta.dir, "..");
const FIXTURE_FILES = ["form-fixture.hwp", "memo-fixture.hwp", "sample.hwp", "sample.hwpx"];
const FIELD = "이곳을 마우스로 누르고 내용을 입력하세요.";
const LONG = "홍길동입니다 긴 이름 테스트 값입니다 홍길동입니다 긴 이름";
const PHONE = "010-2345-6789";
const TIMEOUT = 60_000;

type Done = { exit: number; stdout: string; stderr: string };
type Cell = { row: number; col: number; rowSpan?: number; colSpan?: number; text: string };
type Table = { index: number; rows: number; cols: number; cells: Cell[] };
type Field = { name: string; memo: string; value: string; fieldType: string };
type LastSaved = { product: string; version: string } | null;
type Delta = { path: string; dx: number; dy: number };
type DiffPage = { page: number; nodeCountA: number; nodeCountB: number; maxDisp: number; topDeltas: Delta[] };
type RenderDiff = { status: string; pageCountMismatch: boolean; pages: DiffPage[] };

const workdirs: string[] = [];
const check = test;

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
});

function work(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhwp-steps-"));
  workdirs.push(dir);
  for (const name of FIXTURE_FILES) cpSync(join(FIXTURES ?? "", name), join(dir, name));
  return dir;
}

function env(): Record<string, string | undefined> {
  if (!BIN.includes("/")) return process.env;
  return { ...process.env, PATH: `${dirname(resolve(BIN))}${delimiter}${process.env.PATH ?? ""}` };
}

function spawn(argv: string[], cwd: string, input?: string): Done {
  const done = Bun.spawnSync(argv, {
    cwd,
    env: env(),
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exit: done.exitCode ?? -1, stdout: done.stdout.toString(), stderr: done.stderr.toString() };
}

function rhwp(cwd: string, ...args: string[]): Done {
  return spawn([BIN, ...args], cwd);
}

function json<T>(cwd: string, ...args: string[]): T {
  return JSON.parse(rhwp(cwd, ...args).stdout) as T;
}

function occurrences(file: string, needle: string, encoding: "utf8" | "utf16le"): number {
  const bytes = readFileSync(file);
  const pattern = Buffer.from(needle, encoding);
  let count = 0;
  for (let at = bytes.indexOf(pattern); at >= 0; at = bytes.indexOf(pattern, at + 1)) count++;
  return count;
}

function traces(file: string): { cabso: number; edward: number } {
  const both = (needle: string) => occurrences(file, needle, "utf8") + occurrences(file, needle, "utf16le");
  return { cabso: both("cabso"), edward: both("edward") };
}

function tables(cwd: string, file: string): Table[] {
  return json<{ tables: Table[] }>(cwd, "export-tables", file, "--json").tables;
}

function cellLines(cwd: string, file: string): string[] {
  return tables(cwd, file).flatMap((t) => t.cells.map((c) => `${t.index}|${c.row}|${c.col}|${c.text}`));
}

function fields(cwd: string, file: string): Field[] {
  return json<{ fields: Field[] }>(cwd, "fields", file, "--json").fields;
}

function pageText(cwd: string, file: string): string {
  return json<{ pages: { text: string }[] }>(cwd, "export-text", file, "--json")
    .pages.map((p) => p.text)
    .join("\n");
}

function memoCount(cwd: string, file: string): number {
  return fields(cwd, file).filter((f) => f.fieldType === "Memo").length;
}

function cellText(cwd: string, file: string): string {
  return tables(cwd, file)[0]?.cells.find((c) => c.row === 0 && c.col === 1)?.text ?? "";
}

function setCell(cwd: string, text: string, output: string): Done {
  return rhwp(cwd, "edit", "set-cell", "form-fixture.hwp", "--table", "0", "--row", "0", "--col", "1", "--text", text, "-o", output, "--verify", "--json");
}

function capsuleWorkspace(): { dir: string; output: string; capsule: string } {
  const dir = work();
  expect(rhwp(dir, "harness", "init", "ws", "--json").exit).toBe(0);
  const plan = {
    planVersion: "1.0",
    input: join(dir, "form-fixture.hwp"),
    output: join(dir, "ws", "out.hwp"),
    steps: [{ action: "set_cell", table: 0, row: 0, col: 1, text: "홍길동" }],
  };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
  const wrapped = rhwp(dir, "harness", "wrap", "--plan", "@plan.json", "--dir", "ws", "--json");
  expect(wrapped.exit).toBe(0);
  const capsule = readdirSync(join(dir, "ws", "capsules")).find((n) => n.endsWith(".capsule.json"));
  if (capsule === undefined) throw new Error("harness wrap wrote no capsule");
  return { dir, output: plan.output, capsule: join(dir, "ws", "capsules", capsule) };
}

function phoneInBody(dir: string): void {
  const done = rhwp(dir, "edit", "replace-text", "form-fixture.hwp", "--find", "아래 표의", "--replace", `연락처 ${PHONE} 아래 표의`, "-o", "phone.hwp", "--json");
  expect(done.exit).toBe(0);
}

describe.skipIf(FIXTURES === undefined)("SKILL.md", () => {
  test("fixtures are present", () => {
    for (const name of FIXTURE_FILES) expect(existsSync(join(FIXTURES ?? "", name))).toBe(true);
  });

  test("rhwp is the version the steps were verified against", () => {
    const verified = (JSON.parse(readFileSync(join(SKILL, "scripts", "verified.json"), "utf8")) as { rhwp: string }).rhwp;
    expect(rhwp(SKILL, "--version").stdout.trim()).toBe(`rhwp v${verified}`);
  });

  describe("파악", () => {
    check("explore 가 누름틀로 센 것이 메모일 수 있다", () => {
      const dir = work();
      type Menu = { affordance: string; command: string; skill: string; confidence: string };
      const menu = json<{ menu: Menu[] }>(dir, "explore", "memo-fixture.hwp", "--json").menu;
      const formFill = menu.find((m) => m.affordance === "form-fill");
      expect(formFill?.confidence).toBe("high");
      expect(formFill?.skill).toBeString();
      expect(formFill?.command).toStartWith("rhwp ");
      const kinds = new Set(fields(dir, "memo-fixture.hwp").map((f) => f.fieldType));
      expect([...kinds]).toEqual(["Memo"]);
    }, TIMEOUT);

    check("word-count 는 표 밖 본문만 센다", () => {
      const dir = work();
      const counted = json<{ charCount: number }>(dir, "word-count", "sample.hwpx", "--json").charCount;
      const extracted = pageText(dir, "sample.hwpx").length;
      expect(counted * 2).toBeLessThan(extracted);
    }, TIMEOUT);

    check("page 가 빈 매치 수를 함께 보고한다", () => {
      const dir = work();
      type Match = { page?: number | null; paragraph: number; charOffset: number };
      const matches = json<{ matches: Match[] }>(dir, "search", "sample.hwpx", "의", "--json").matches;
      expect(matches.filter((m) => m.page == null).length).toBeGreaterThan(0);
      for (const m of matches) {
        expect(m.paragraph).toBeNumber();
        expect(m.charOffset).toBeNumber();
      }
    }, TIMEOUT);

  });

  describe("메모", () => {
    check("메모 본문·작성자·시각은 번들 스크립트로 읽는다", () => {
      const dir = work();
      const memos = fields(dir, "memo-fixture.hwp").filter((f) => f.fieldType === "Memo");
      expect(memos.length).toBeGreaterThan(0);
      for (const m of memos) expect([m.name, m.memo]).toEqual(["", ""]);

      const script = join(SKILL, "scripts", "extract_memos.ts");
      const listed = spawn([process.execPath, script, "memo-fixture.hwp"], dir);
      expect(listed.exit).toBe(0);
      const headers = [...listed.stdout.matchAll(/^\[memo\d+\] (\S+) (\S+) @ /gm)];
      expect(headers.length).toBe(memos.length);
      for (const h of headers) expect(h[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const bodies = spawn([process.execPath, script, "memo-fixture.hwp", "--plain"], dir)
        .stdout.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const text = pageText(dir, "memo-fixture.hwp");
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(text).not.toContain(body);
    }, TIMEOUT);

    check("메모 개수는 hwp5-inventory 의 MEMO_LIST 로 센다", () => {
      const dir = work();
      const records = rhwp(dir, "hwp5-inventory", "memo-fixture.hwp", "--format", "jsonl")
        .stdout.split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { tag_name: string });
      const memoList = records.filter((r) => r.tag_name === "MEMO_LIST").length;
      expect(memoList).toBeGreaterThan(0);
      expect(memoList).toBe(memoCount(dir, "memo-fixture.hwp"));
    }, TIMEOUT);

    check("메모를 쓰거나 지우는 요청은 한글에서 하도록 안내한다", () => {
      const dir = work();
      type Command = { name: string; subcommands?: { name: string; summary?: string }[] };
      const commands = json<{ commands: Command[] }>(dir, "capabilities").commands;
      const edit = commands.find((c) => c.name === "edit")?.subcommands ?? [];
      expect(edit.length).toBeGreaterThan(0);
      const memo = edit.filter((s) => /memo|메모|주석|comment|annot/i.test(`${s.name} ${s.summary ?? ""}`));
      expect(memo).toEqual([]);
    }, TIMEOUT);

    check("HWP5 를 HWPX 로 바꾼 뒤의 확인은 ir-diff 와 메모 개수 대조로 한다", () => {
      const dir = work();
      const exported = rhwp(dir, "export-hwpx", "memo-fixture.hwp", "m.hwpx", "--verify", "--json");
      expect(exported.exit).toBe(3);
      const verify = (JSON.parse(exported.stdout) as { verify: { diffCount: number } }).verify;
      expect(verify.diffCount).toBeGreaterThan(0);
      const diffs = exported.stderr.split("\n").filter((line) => line.includes("[차이]"));
      expect(diffs.length).toBe(verify.diffCount);
      for (const line of diffs) expect(line).toContain("parameters: expected=None actual=Some(");
      const ir = rhwp(dir, "ir-diff", "memo-fixture.hwp", "m.hwpx", "--json");
      expect(ir.exit).toBe(0);
      expect((JSON.parse(ir.stdout) as { identical: boolean }).identical).toBe(true);
    }, TIMEOUT);
  });

  describe("추출·변환", () => {
    check("추출 명령에는 늘 -o 를 준다", () => {
      for (const command of ["export-text", "export-markdown", "export-svg"]) {
        const dir = work();
        expect(rhwp(dir, command, "form-fixture.hwp").exit).toBe(0);
        expect(existsSync(join(dir, "output"))).toBe(true);
      }
      const dir = work();
      const firstLine = pageText(dir, "form-fixture.hwp").split("\n")[0] ?? "";
      expect(firstLine.length).toBeGreaterThan(0);
      expect(rhwp(dir, "export-text", "form-fixture.hwp").stdout).not.toContain(firstLine);
    }, TIMEOUT);

    check("병합 칸이 있는 표는 edit set-cell 로 칸마다 쓴다", () => {
      const dir = work();
      const merged = tables(dir, "sample.hwpx").find((t) =>
        t.cells.some((c) => ((c.rowSpan ?? 1) > 1 || (c.colSpan ?? 1) > 1) && c.text.includes("\n")),
      );
      if (merged === undefined) throw new Error("sample.hwpx has no merged multi-line cell");
      const table = String(merged.index);
      expect(rhwp(dir, "table-to-csv", "sample.hwpx", "--table", table, "-o", "t.csv", "--json").exit).toBe(0);
      const back = rhwp(dir, "csv-to-table", "sample.hwpx", "--csv", "t.csv", "--table", table, "--dry-run", "--json");
      expect(back.exit).toBe(2);
      const envelope = JSON.parse(back.stdout) as { changedCount: number; invalid: { reason: string }[] };
      expect(envelope.changedCount).toBe(0);
      expect(envelope.invalid.map((i) => i.reason)).toContain("controlCharacter");
    }, TIMEOUT);

    check("저장 이력(lastSavedWith)은 원본에서 읽는다", () => {
      const dir = work();
      const saved = (file: string) => json<{ lastSavedWith: LastSaved }>(dir, "info", file, "--json").lastSavedWith;
      expect(saved("memo-fixture.hwp")).toBeNull();
      expect(saved("sample.hwp")).not.toBeNull();
      expect(rhwp(dir, "export-hwpx", "memo-fixture.hwp", "a.hwpx", "--json").exit).toBe(0);
      expect(rhwp(dir, "export-hwpx", "sample.hwp", "b.hwpx", "--json").exit).toBe(0);
      expect(saved("a.hwpx")).not.toBeNull();
      expect(saved("a.hwpx")).toEqual(saved("b.hwpx"));
      expect(spawn(["unzip", "-l", "a.hwpx"], dir).stdout).toContain("META-INF/rhwp-hwp5-origin");
      expect(spawn(["unzip", "-p", "a.hwpx", "Contents/content.hpf"], dir).stdout).toMatch(/name="creator"[^>]*>rhwp/);
    }, TIMEOUT);
  });

  describe("채우기", () => {
    check("--dry-run 의 oldText 가 지금 칸 내용과 같은지 보고", () => {
      const dir = work();
      const dry = rhwp(dir, "edit", "set-cell", "form-fixture.hwp", "--table", "0", "--row", "0", "--col", "1", "--text", "홍길동", "--dry-run", "--json");
      expect(dry.exit).toBe(0);
      expect((JSON.parse(dry.stdout) as { oldText: string }).oldText).toBe(cellText(dir, "form-fixture.hwp"));
    }, TIMEOUT);

    check("정확히 한 칸만 바뀌었는지 본다", () => {
      const dir = work();
      const before = cellText(dir, "form-fixture.hwp");
      expect(setCell(dir, "홍길동", "out.hwp").exit).toBe(0);
      const a = new Set(cellLines(dir, "form-fixture.hwp"));
      const b = new Set(cellLines(dir, "out.hwp"));
      expect([...a].filter((line) => !b.has(line))).toEqual([`0|0|1|${before}`]);
      expect([...b].filter((line) => !a.has(line))).toEqual(["0|0|1|홍길동"]);
    }, TIMEOUT);

    check("overflow[] 가 차 있으면 그 칸을 그림으로 보고 쪽수가 그대로인지 본다", () => {
      const dir = work();
      const done = setCell(dir, LONG, "out.hwp");
      expect(done.exit).toBe(0);
      type Envelope = { overflow: { lines: number }[]; verify: { identical: boolean } };
      const envelope = JSON.parse(done.stdout) as Envelope;
      expect(envelope.overflow.length).toBeGreaterThan(0);
      expect(envelope.overflow[0]?.lines).toBeGreaterThan(1);
      expect(envelope.verify.identical).toBe(true);
      expect(tables(dir, "out.hwp")[0]?.cells.find((c) => c.row === 0 && c.col === 1)?.text).toBe(LONG);
      const pages = (file: string) => json<{ pageCount: number }>(dir, "info", file, "--json").pageCount;
      expect(pages("out.hwp")).toBe(pages("form-fixture.hwp"));
    }, TIMEOUT);

    check("누름틀 값은 fields --json 의 value 로 확인한다", () => {
      const dir = work();
      const filled = rhwp(dir, "edit", "fill-fields", "form-fixture.hwp", "--data", JSON.stringify({ [`${FIELD}[1]`]: "기획팀" }), "-o", "b.hwp", "--json");
      expect(filled.exit).toBe(0);
      expect(fields(dir, "b.hwp").filter((f) => f.name === FIELD)[1]?.value).toBe("기획팀");
      const verified = rhwp(dir, "verify", "b.hwp", "--expect-field", `${FIELD}[1]=기획팀`, "--json");
      expect(verified.exit).toBe(3);
      const expectations = (JSON.parse(verified.stdout) as { expectations: { actual: unknown }[] }).expectations;
      expect(expectations[0]?.actual).toBeNull();
    }, TIMEOUT);
  });

  describe("판정", () => {
    check("render-diff --json 으로 비교하고 아래 표로 가른다", () => {
      const dir = work();
      const self = rhwp(dir, "render-diff", "form-fixture.hwp", "form-fixture.hwp", "--json");
      expect(self.exit).toBe(0);

      const shapes: Record<string, string> = {};
      for (const [name, text] of [["short", "홍길동"], ["long", LONG]] as const) {
        expect(setCell(dir, text, `${name}.hwp`).exit).toBe(0);
        const diff = rhwp(dir, "render-diff", "form-fixture.hwp", `${name}.hwp`, "--json");
        expect(diff.exit).toBe(3);
        const report = JSON.parse(diff.stdout) as RenderDiff;
        expect(report.pageCountMismatch).toBe(false);
        const moved = report.pages.filter((p) => p.maxDisp > 0);
        expect(moved.map((p) => p.page)).toEqual([0]);
        const top = moved[0]?.topDeltas[0];
        expect(top?.path).toContain("/Cell1/");
        expect([top?.dx, top?.dy]).toEqual([0, 0]);
        const page = moved[0];
        shapes[name] = `${report.status} ${page?.nodeCountA === page?.nodeCountB ? "same" : "grew"}`;
      }
      expect(shapes).toEqual({ short: "OVER same", long: "STRUCT_MISMATCH grew" });
    }, TIMEOUT);

    check("export-svg 의 -p 는 0 기준이고 파일 이름은 1 기준이다", () => {
      const dir = work();
      const done = rhwp(dir, "export-svg", "sample.hwpx", "-p", "1", "-o", "svg", "--json");
      expect(done.exit).toBe(0);
      expect(readdirSync(join(dir, "svg"))).toEqual(["sample_002.svg"]);
      const keys = Object.keys(JSON.parse(done.stdout) as object);
      expect(keys).toContain("fontEnvironment");
      expect(keys).toContain("nativeFontSupply");
    }, TIMEOUT);
  });

  describe("보내기", () => {
    check("그다음 edit sanitize 를 사본에 적용한다", () => {
      const dir = work();
      phoneInBody(dir);
      const digits = PHONE.slice(4);
      expect(rhwp(dir, "edit", "sanitize", "phone.hwp", "-o", "s.hwp", "--json").exit).toBe(0);
      expect(rhwp(dir, "edit", "redact", "s.hwp", "-o", "wrong.hwp", "--json").exit).toBe(0);
      expect(rhwp(dir, "edit", "redact", "phone.hwp", "-o", "r.hwp", "--json").exit).toBe(0);
      expect(rhwp(dir, "edit", "sanitize", "r.hwp", "-o", "right.hwp", "--json").exit).toBe(0);
      expect(occurrences(join(dir, "wrong.hwp"), digits, "utf16le")).toBeGreaterThan(0);
      expect(occurrences(join(dir, "right.hwp"), digits, "utf16le")).toBe(0);
    }, TIMEOUT);

    check("다시 돌려 removedCount: 0 이 나오면 더 지울 것이 없다", () => {
      const dir = work();
      expect(rhwp(dir, "edit", "sanitize", "sample.hwp", "--dry-run", "--json").exit).toBe(2);
      const removed = (args: string[]) => json<{ removedCount: number }>(dir, "edit", "sanitize", ...args, "--json").removedCount;
      expect(removed(["sample.hwp", "-o", "s1.hwp"])).toBeGreaterThan(0);
      expect(removed(["s1.hwp", "-o", "s2.hwp"])).toBe(0);
    }, TIMEOUT);

    check("HWPX 원본을 .hwp 로 보내야 하면 한글에서 다른 이름으로 저장하게 한다", () => {
      const dir = work();
      expect(rhwp(dir, "convert", "sample.hwpx", "c.hwp", "--json").exit).toBe(0);
      const converted = traces(join(dir, "c.hwp"));
      expect(converted.cabso).toBeGreaterThan(0);
      expect(converted.edward).toBeGreaterThan(0);

      expect(rhwp(dir, "edit", "sanitize", "c.hwp", "-o", "cs.hwp", "--json").exit).toBe(0);
      const sanitized = traces(join(dir, "cs.hwp"));
      expect(sanitized.edward).toBe(0);
      expect(sanitized.cabso).toBeGreaterThan(0);

      expect(setCell(dir, "홍길동", "s.hwp").exit).toBe(0);
      expect(rhwp(dir, "edit", "sanitize", "sample.hwp", "-o", "ss.hwp", "--json").exit).toBe(0);
      expect(traces(join(dir, "s.hwp"))).toEqual({ cabso: 0, edward: 0 });
      expect(traces(join(dir, "ss.hwp"))).toEqual({ cabso: 0, edward: 0 });
    }, TIMEOUT);

    check("깨끗한지는 redact·search·export-text --json 으로 확인한다", () => {
      const dir = work();
      phoneInBody(dir);
      expect(rhwp(dir, "edit", "sanitize", "phone.hwp", "-o", "s.hwp", "--json").exit).toBe(0);
      const file = join(dir, "s.hwp");
      expect(occurrences(file, PHONE, "utf8")).toBe(0);
      expect(occurrences(file, PHONE, "utf16le")).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe("받은 문서 점검", () => {
    check("보안 검사의 판정은 clean 으로 읽는다", () => {
      const dir = work();
      const keys = (...args: string[]) => {
        const envelope = json<Record<string, unknown>>(dir, ...args, "form-fixture.hwp", "--json");
        expect(envelope.clean).toBeBoolean();
        return Object.keys(envelope);
      };
      const hidden = keys("inspect", "hidden-text");
      expect(hidden).toContain("hiddenCharCount");
      expect(hidden).not.toContain("findingCount");
      const injection = keys("inspect", "injection");
      expect(injection).toContain("signalCount");
      expect(injection).not.toContain("findingCount");
      for (const args of [["inspect", "unicode"], ["inspect", "watermark"], ["threat-scan"]]) {
        expect(keys(...args)).toContain("findingCount");
      }
    }, TIMEOUT);

    check("threat-scan 은 scanScopes 가 차 있을 때 검사한 것이다", () => {
      const dir = work();
      writeFileSync(join(dir, "junk.hwp"), "not a hwp file at all\n".repeat(20));
      const scanned = rhwp(dir, "threat-scan", "junk.hwp", "--json");
      expect(scanned.exit).toBe(0);
      const envelope = JSON.parse(scanned.stdout) as { clean: boolean; format: string; scanScopes: unknown[] };
      expect(envelope).toMatchObject({ clean: true, format: "unknown", scanScopes: [] });
      expect(rhwp(dir, "inspect", "hidden-text", "junk.hwp", "--json").exit).toBe(1);
    }, TIMEOUT);
  });

  describe("증빙", () => {
    check("배포한 파일의 sha256 을 캡슐의 receipt.outputSha256 과 대조한다", () => {
      const { dir, output, capsule } = capsuleWorkspace();
      appendFileSync(output, "x");
      expect(json<{ verdict: string }>(dir, "harness-status", "ws", "--json").verdict).toBe("ok");
      expect(json<{ reproducedRate: number }>(dir, "audit", "ws/capsules", "--json").reproducedRate).toBe(1);
      const shipped = createHash("sha256").update(readFileSync(output)).digest("hex");
      const receipt = (JSON.parse(readFileSync(capsule, "utf8")) as { receipt: { outputSha256: string } }).receipt;
      expect(receipt.outputSha256).not.toBe(shipped);
    }, TIMEOUT);

    check("rhwp 버전은 캡슐의 toolVersion 에서 옮겨 적는다", () => {
      const { dir, capsule } = capsuleWorkspace();
      expect(rhwp(dir, "audit-report", "ws/capsules", "-o", "report.json", "--json").exit).toBe(0);
      const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { toolVersions: { rhwp: string[] } };
      expect(report.toolVersions.rhwp).toEqual(["미기록"]);
      expect(readFileSync(capsule, "utf8")).toMatch(/"toolVersion":\s*"\d/);
    }, TIMEOUT);
  });
});

function prose(text: string): string {
  return text.replaceAll("`", "").replace(/\s+/g, " ");
}

test("every check names a step in the skill", () => {
  const references = join(SKILL, "references");
  const docs = [join(SKILL, "SKILL.md"), ...readdirSync(references).filter((n) => n.endsWith(".md")).map((n) => join(references, n))];
  const text = prose(docs.map((file) => readFileSync(file, "utf8")).join("\n"));
  const names = [...readFileSync(import.meta.path, "utf8").matchAll(/^\s+check\("([^"]+)"/gm)].map((m) => m[1] ?? "");
  expect(names.length).toBeGreaterThan(20);
  expect(names.filter((name) => !text.includes(prose(name)))).toEqual([]);
});
