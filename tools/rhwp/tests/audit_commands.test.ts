import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SKILL = resolve(import.meta.dir, "..");
const COMMAND = [process.execPath, "scripts/audit_commands.ts"];
const HAS_RHWP = Bun.which("rhwp") !== null;

type Done = { exitCode: number; stdout: string; stderr: string };

function run(root: string, args: string[], env?: Record<string, string>): Done {
  const done = Bun.spawnSync([...COMMAND, ...args], {
    cwd: root,
    env: env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: done.exitCode ?? -1,
    stdout: done.stdout.toString(),
    stderr: done.stderr.toString(),
  };
}

const SKILL_MD = `# 시험 스킬

본문에 rhwp nosuch 라고만 쓰면 호출이 아니다. \`rhwp missing-inline --json\` 은 호출이다.

\`\`\`bash
rhwp export-text <파일.hwp> -o out/ --json
rhwp export-text <파일.hwp> --bogus-flag -p 0
rhwp edit set-cell <파일.hwp> --table 1 --row 0 --col 0 --text x --verify --json
rhwp edit no-such-sub <파일.hwp>
rhwp edit set-cell <작업장>/a.hwp --table 1 --made-up   # --not-checked
rhwp export-text a.hwp --json && rhwp export-text b.hwp --also-bogus
rhwp capabilities --search x --json | rhwp export-text --piped-away
x=$(rhwp export-text a.hwp --json) ; rhwp nope
\`\`\`
`;

const REF_MD = `# 참고

\`\`\`
rhwp inspect not-a-real-inspector a.hwp
rhwp help
rhwp --version
\`\`\`
`;

const FINDINGS = [
  { file: "SKILL.md", line: 2, kind: "unknown-flag", detail: "export-text --bogus-flag" },
  { file: "SKILL.md", line: 4, kind: "unknown-subcommand", detail: "edit no-such-sub" },
  { file: "SKILL.md", line: 5, kind: "unknown-flag", detail: "edit set-cell --made-up" },
  { file: "SKILL.md", line: 7, kind: "unknown-flag", detail: "export-text --piped-away" },
  { file: "SKILL.md", line: 10, kind: "unknown-command", detail: "missing-inline" },
  { file: "zz_ref.md", line: 1, kind: "unknown-subcommand", detail: "inspect not-a-real-inspector" },
];

describe("audit_commands", () => {
  let temp: string;
  let root: string;

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "audit-commands-test-"));
    root = join(temp, "rhwp");
    const scripts = dirname(COMMAND[COMMAND.length - 1] ?? "");
    cpSync(join(SKILL, scripts), join(root, scripts), { recursive: true });
    mkdirSync(join(root, "references"));
    writeFileSync(join(root, "SKILL.md"), SKILL_MD);
    writeFileSync(join(root, "references/zz_ref.md"), REF_MD);
    writeFileSync(join(root, "references/aa_clean.md"), "`rhwp export-text a.hwp --json`\n");
    writeFileSync(join(root, "references/notes.txt"), "`rhwp nonexistent`\n");
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });

  test("without rhwp on PATH it skips cleanly", () => {
    const runner = Bun.which(COMMAND[0] ?? "") ?? "";
    const empty = join(temp, "empty-bin");
    mkdirSync(empty);
    const done = Bun.spawnSync([runner, ...COMMAND.slice(1)], {
      cwd: root,
      env: { ...process.env, PATH: empty },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(done.exitCode).toBe(0);
    expect(done.stdout.toString()).toBe("");
    expect(done.stderr.toString()).toBe("rhwp not found; skipping\n");
  });

  test("an unknown argument is a usage error", () => {
    const done = run(root, ["--bogus"]);
    expect(done.exitCode).toBe(2);
    expect(done.stdout).toBe("");
    expect(done.stderr).toStartWith("usage: ");
    expect(done.stderr).toContain("--bogus");
  });

  test("a positional argument is a usage error", () => {
    const done = run(root, ["SKILL.md"]);
    expect(done.exitCode).toBe(2);
    expect(done.stderr).toContain("SKILL.md");
  });

  test("help names the json flag", () => {
    const done = run(root, ["-h"]);
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toStartWith("usage: ");
    expect(done.stdout).toContain("--json");
  });

  describe.skipIf(!HAS_RHWP)("with rhwp", () => {
    const version = (): string => Bun.spawnSync(["rhwp", "--version"]).stdout.toString().trim();

    test("reports each stale command, subcommand and flag", () => {
      const done = run(root, []);
      expect(done.exitCode).toBe(1);
      expect(done.stdout).toBe(
        FINDINGS.map((f) => `${f.file}:${f.line}  ${f.kind}  ${f.detail}\n`).join(""),
      );
      expect(done.stderr).toBe(`\n${version()} / 3 documents / 3 passes / 6 findings\n`);
    });

    test("json carries the same findings", () => {
      const done = run(root, ["--json"]);
      expect(done.exitCode).toBe(1);
      expect(done.stderr).toBe("");
      expect(JSON.parse(done.stdout)).toEqual({
        version: version(),
        passes: 3,
        findingCount: 6,
        findings: FINDINGS,
      });
    });

    test("a clean tree exits zero", () => {
      writeFileSync(join(root, "SKILL.md"), "```\nrhwp edit set-cell a.hwp --verify --dry-run\n```\n");
      rmSync(join(root, "references/zz_ref.md"));
      const done = run(root, ["--json"]);
      expect(done.exitCode).toBe(0);
      expect(JSON.parse(done.stdout)).toEqual({ version: version(), passes: 3, findingCount: 0, findings: [] });
    });
  });
});
