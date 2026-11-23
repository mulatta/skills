import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const SKILL = resolve(import.meta.dir, "..");
const COMMAND = [process.execPath, join(SKILL, "scripts/extract_memos.ts")];
const HAS_RHWP = Bun.which("rhwp") !== null;

type Done = { exitCode: number; stdout: string; stderr: string };

function run(args: string[]): Done {
  const done = Bun.spawnSync([...COMMAND, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: done.exitCode ?? -1,
    stdout: done.stdout.toString(),
    stderr: done.stderr.toString(),
  };
}

type Entry = { name: string; text: string; deflate: boolean };

function zip(entries: Entry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.text, "utf8");
    const data = e.deflate ? deflateRawSync(raw) : raw;
    const crc = Bun.hash.crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(e.deflate ? 8 : 0, 8);
    head.writeUInt32LE(0x00210000, 10);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, name, data);
    centrals.push(central, name);
    offset += head.length + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const NS =
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" ' +
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"';

function memo(params: Record<string, string>, body: string, type = "MEMO"): string {
  const ps = Object.entries(params)
    .map(([k, v]) => `<hp:stringParam name="${k}">${v}</hp:stringParam>`)
    .join("");
  return (
    `<hp:ctrl><hp:fieldBegin id="1" type="${type}" name="">` +
    `<hp:parameters cnt="3" name=""><hp:integerParam name="Prop">0</hp:integerParam>${ps}</hp:parameters>` +
    `<hp:subList id="">${body}</hp:subList></hp:fieldBegin></hp:ctrl>`
  );
}

function para(id: string | null, inner: string): string {
  const attr = id === null ? "" : ` id="${id}"`;
  return `<hp:p${attr} paraPrIDRef="0"><hp:run charPrIDRef="0">${inner}</hp:run></hp:p>`;
}

function cell(row: number | null, col: number, inner: string): string {
  const addr = row === null ? "" : `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/>`;
  return `<hp:tc name=""><hp:subList id="">${inner}</hp:subList>${addr}</hp:tc>`;
}

const SECTION0 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\r\n<hs:sec ${NS}>` +
  para(
    "3",
    memo(
      { ID: "m1", Author: "김&amp;이", CreateDateTime: "2026-01-02T03:04:05Z" },
      para("0", "<hp:t>  첫 줄 &lt;표&gt; &#xAC00;&#44032; </hp:t>") +
        para("1", "<hp:t><![CDATA[둘<째>]]> 줄<!-- note --> 끝</hp:t><hp:t>   </hp:t>") +
        para("2", "<hp:t>앞<hp:tab/>뒤</hp:t>") +
        para("3", "<hp:t>위<hp:lineBreak/>아래</hp:t>"),
    ),
  ) +
  para(null, memo({ ID: "m2", Author: "" }, para("0", "<hp:t>\t\r\n</hp:t>"))) +
  para(
    "4",
    `<hp:ctrl><hp:tbl id="7"><hp:tr>` +
      cell(
        2,
        0,
        para(
          "5",
          `<hp:ctrl><hp:tbl id="8"><hp:tr>` +
            cell(0, 1, para("6", memo({ ID: "m3", Author: "박", Author2: "x" }, para("0", "<hp:t>중첩 표</hp:t>")))) +
            cell(null, 2, para("7", memo({ Author: "최" }, para("0", "<hp:t>주소 없는 칸</hp:t>")))) +
            `</hp:tr></hp:tbl></hp:ctrl>`,
        ),
      ) +
      `</hp:tr></hp:tbl></hp:ctrl>`,
  ) +
  para("8", memo({ ID: "skip", Author: "누름틀" }, para("0", "<hp:t>누름틀</hp:t>"), "CLICK_HERE")) +
  para(
    "9",
    `<hp:ctrl><hp10:fieldBegin type="MEMO"><hp10:subList><hp:t>다른 이름공간</hp:t></hp10:subList></hp10:fieldBegin></hp:ctrl>`,
  ) +
  memo({ ID: "m5", Author: "박", CreateDateTime: "2026-02-03T00:00:00Z" }, para("0", "<hp:t>문단 밖</hp:t>")) +
  `</hs:sec>`;

const SECTION = (n: number, author: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>` +
  para(String(n), memo({ ID: `s${n}`, Author: author }, para("0", `<hp:t>구역 ${n}</hp:t>`))) +
  `</hs:sec>`;

const CRAFTED_OUT = [
  "[m1] 김&이 2026-01-02T03:04:05Z @ 본문 문단#3",
  "첫 줄 <표> 가가",
  "둘<째> 줄 끝",
  "앞\t뒤",
  "위",
  "아래",
  "",
  "[m2] ?  @ 본문 문단#?",
  "(empty body)",
  "",
  "[m3] 박  @ 표#7 r2c0 표#8 r0c1",
  "중첩 표",
  "",
  "[?] 최  @ 표#7 r2c0 표#8",
  "주소 없는 칸",
  "",
  "[m5] 박 2026-02-03T00:00:00Z @ ?",
  "문단 밖",
  "",
  "[s1] 박  @ 본문 문단#1",
  "구역 1",
  "",
  "[s10] 이  @ 본문 문단#10",
  "구역 10",
  "",
  "[s2] 박  @ 본문 문단#2",
  "구역 2",
  "",
  "",
].join("\n");

describe("extract_memos", () => {
  let temp: string;
  let crafted: string;

  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), "extract-memos-test-"));
    crafted = join(temp, "crafted.hwpx");
    writeFileSync(
      crafted,
      zip([
        { name: "mimetype", text: "application/hwp+zip", deflate: false },
        { name: "Contents/section2.xml", text: SECTION(2, "박"), deflate: true },
        { name: "Contents/section0.xml", text: SECTION0, deflate: false },
        { name: "Contents/section10.xml", text: SECTION(10, "이"), deflate: true },
        { name: "Contents/section1.xml", text: SECTION(1, "박"), deflate: true },
        { name: "Contents/Section3.xml", text: SECTION(3, "대문자"), deflate: true },
        { name: "Contents/sub/section4.xml", text: SECTION(4, "하위"), deflate: true },
        { name: "Contents/header.xml", text: SECTION(5, "머리"), deflate: true },
      ]),
    );
  });

  afterAll(() => {
    rmSync(temp, { recursive: true, force: true });
  });

  test("an hwpx is read directly, sections in name order", () => {
    const done = run([crafted]);
    expect(done.stderr).toBe("8 memos\n");
    expect(done.stdout).toBe(CRAFTED_OUT);
    expect(done.exitCode).toBe(0);
  });

  test("filters by author and body, and prints bodies alone", () => {
    const byAuthor = run([crafted, "--author", "박", "--plain"]);
    expect(byAuthor.stdout).toBe("중첩 표\n\n문단 밖\n\n구역 1\n\n구역 2\n\n");
    expect(byAuthor.stderr).toBe("4 memos\n");

    const emptyAuthor = run([crafted, "--author="]);
    expect(emptyAuthor.stdout).toBe(CRAFTED_OUT);

    const byBody = run([crafted, "--grep", "구역 1"]);
    expect(byBody.stdout).toBe("[s1] 박  @ 본문 문단#1\n구역 1\n\n[s10] 이  @ 본문 문단#10\n구역 10\n\n");
    expect(byBody.stderr).toBe("2 memos\n");

    const multiline = run([crafted, "--grep", "가가\n둘", "--plain"]);
    expect(multiline.stdout).toBe("첫 줄 <표> 가가\n둘<째> 줄 끝\n앞\t뒤\n위\n아래\n\n");
  });

  test("a missing file argument is a usage error", () => {
    const done = run([]);
    expect(done.exitCode).toBe(2);
    expect(done.stdout).toBe("");
    expect(done.stderr).toStartWith("usage: ");
    expect(done.stderr).toContain("FILE");
  });

  test("an unknown flag is a usage error", () => {
    const done = run([crafted, "--nope"]);
    expect(done.exitCode).toBe(2);
    expect(done.stdout).toBe("");
    expect(done.stderr).toStartWith("usage: ");
    expect(done.stderr).toContain("--nope");
  });

  test("a second file is a usage error", () => {
    const done = run([crafted, crafted]);
    expect(done.exitCode).toBe(2);
    expect(done.stderr).toStartWith("usage: ");
  });

  test("help lists the options", () => {
    const done = run(["--help"]);
    expect(done.exitCode).toBe(0);
    for (const flag of ["--grep", "--author", "--plain"]) expect(done.stdout).toContain(flag);
  });

  test("a file that is not a zip archive exits 1 naming it", () => {
    const notZip = join(temp, "broken.hwpx");
    writeFileSync(notZip, "not a zip archive");
    const done = run([notZip]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toBe("");
    expect(done.stderr).toContain(notZip);
    expect(done.stderr).not.toMatch(/\d+ memos/);
  });

  describe.skipIf(!HAS_RHWP)("with rhwp", () => {
    test("a failed conversion exits 1 with rhwp's message", () => {
      const done = run([join(temp, "없는 파일.hwp")]);
      expect(done.exitCode).toBe(1);
      expect(done.stdout).toBe("");
      expect(done.stderr).toStartWith("export-hwpx failed (exit 1): 오류: ");
      expect(done.stderr).toContain("없는 파일.hwp");
      expect(done.stderr).not.toMatch(/\d+ memos/);
    });
  });
});
