import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const COMMAND = [process.execPath, resolve(import.meta.dir, "../scripts/check_links.ts")];

type Done = { exitCode: number; stdout: string; stderr: string };

function run(roots: string[], command: string[] = COMMAND): Done {
  const done = Bun.spawnSync([...command, ...roots], { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: done.exitCode,
    stdout: done.stdout.toString(),
    stderr: done.stderr.toString(),
  };
}

describe("check_links", () => {
  let temp: string;
  let root: string;

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "check-links-"));
    root = join(temp, "skills");
    for (const sub of ["modes/reader", "modes/reader/scripts", "standards/prose"]) {
      mkdirSync(join(root, sub), { recursive: true });
    }
    writeFileSync(join(root, "standards/prose/SKILL.md"), "# Prose\n");
    writeFileSync(join(root, "modes/reader/scripts/audit.py"), "");
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });

  function writeMode(body: string): void {
    writeFileSync(join(root, "modes/reader/SKILL.md"), body);
  }

  function installed(): string[] {
    const home = join(root, "checker/scripts");
    mkdirSync(home, { recursive: true });
    const source = COMMAND[COMMAND.length - 1] ?? "";
    const copy = join(home, basename(source));
    copyFileSync(source, copy);
    return [...COMMAND.slice(0, -1), copy];
  }

  test("a resolving tree exits zero", () => {
    writeMode(
      "Apply [prose](../../standards/prose/SKILL.md).\n" +
        "Audit with `python3 -I scripts/audit.py <file>`.\n" +
        "See [the site](https://example.invalid/x) and [a part](#later).\n",
    );
    const done = run([root]);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
    expect(done.stdout).toContain("0 unresolved");
  });

  test("a dangling markdown link is reported with its line", () => {
    writeMode("# Reader\n\nApply [prose](../../standards/gone/SKILL.md).\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("SKILL.md:3: ../../standards/gone/SKILL.md");
  });

  test("a named script that was not copied is reported", () => {
    writeMode("Audit with `python3 -I scripts/missing.py <file>`.\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("scripts/missing.py");
  });

  test("a named TypeScript script that was not copied is reported", () => {
    writeFileSync(join(root, "modes/reader/scripts/audit.ts"), "");
    writeMode("Audit with `bun scripts/audit.ts <file>` or `bun scripts/missing.ts`.\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("SKILL.md:1: scripts/missing.ts");
    expect(done.stdout).toContain("1 unresolved");
  });

  test("a link with an anchor checks only the file", () => {
    writeMode("Apply [rule 7](../../standards/prose/SKILL.md#rule-7).\n");
    expect(run([root]).exitCode).toBe(0);
  });

  test("an absolute link cannot resolve inside a copy", () => {
    writeMode("Apply [prose](/standards/prose/SKILL.md).\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("/standards/prose/SKILL.md");
  });

  test("evals are not checked", () => {
    const evals = join(root, "modes/reader/evals");
    mkdirSync(evals);
    writeFileSync(join(evals, "README.md"), "Copy [gone](../../../gone/SKILL.md).\n");
    writeMode("# Reader\n");
    expect(run([root]).exitCode).toBe(0);
  });

  test("installed dependencies are not checked", () => {
    const pkg = join(root, "modes/reader/scripts/node_modules/commander");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "Readme.md"), "See [docs](./docs/options.md).\n");
    writeMode("# Reader\n");
    const done = run([root]);
    expect(done.exitCode, done.stdout).toBe(0);
  });

  test("a home path is not a tree reference", () => {
    writeMode("Recipes live in `~/.agent-browser/login.json`.\n");
    expect(run([root]).exitCode).toBe(0);
  });

  test("a json path is not read as a js path", () => {
    writeFileSync(join(root, "modes/reader/scripts/allow.json"), "{}");
    writeMode("Verified flags sit in `scripts/allow.json`.\n");
    expect(run([root]).exitCode).toBe(0);
  });

  test("the allowances beside the checker apply to any tree", () => {
    const command = installed();
    const script = command[command.length - 1] ?? "";
    writeFileSync(
      join(script, "../check_links_allow.txt"),
      "# cited, not run\nother/project/audit.py\n",
    );
    writeMode("The idea came from `other/project/audit.py`.\n");
    const done = run([root], command);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
  });

  test("without a tree named it checks the tree it sits in", () => {
    const command = installed();
    writeMode("Apply [prose](../../standards/gone/SKILL.md).\n");
    const done = run([], command);
    expect(done.exitCode, done.stdout + done.stderr).toBe(1);
    expect(done.stdout).toContain("../../standards/gone/SKILL.md");
  });

  test("a skill named in bold must exist", () => {
    writeMode(
      "Across a boundary, run **shape-first**. Prose goes through the **prose** skill.\n" +
        "Apply the **tidy-types** principle skill and the `prose` skill.\n" +
        "**You own this.** Do **not** skip it; a **prose** pass is cheap.\n",
    );
    mkdirSync(join(root, "principle-tidy-types"));
    writeFileSync(join(root, "principle-tidy-types/SKILL.md"), "# T\n");
    mkdirSync(join(root, "prose"));
    writeFileSync(join(root, "prose/SKILL.md"), "# P\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("SKILL.md:1: **shape-first**");
    expect(done.stdout).toContain("1 unresolved");
  });

  test("a skill named in backticks must exist", () => {
    writeMode("Then hand it to the `gone` skill.\n");
    const done = run([root]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("`gone` skill");
  });

  test("trees installed side by side resolve into each other", () => {
    const beside = join(temp, "beside");
    mkdirSync(join(beside, "commit"), { recursive: true });
    writeFileSync(
      join(beside, "commit/SKILL.md"),
      "Write the message per [prose](../standards/prose/SKILL.md).\n",
    );
    writeMode("Record it with [commit](../../commit/SKILL.md) and **commit**.\n");
    const alone = run([root]);
    expect(alone.exitCode).toBe(1);
    expect(alone.stdout).toContain("../../commit/SKILL.md");
    const done = run([root, beside]);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
    expect(done.stdout).toContain("0 unresolved");
  });

  test("an unknown option is a usage error", () => {
    const done = run(["--strict", root]);
    expect(done.exitCode).toBe(2);
    expect(done.stderr).toContain("usage:");
    expect(done.stdout).toBe("");
  });

  test("a tree that sits under an evals directory is still checked", () => {
    const nested = join(temp, "evals/copy");
    mkdirSync(join(nested, "reader"), { recursive: true });
    writeFileSync(join(nested, "reader/SKILL.md"), "Apply [prose](../gone/SKILL.md).\n");
    const done = run([nested]);
    expect(done.exitCode).toBe(1);
    expect(done.stdout).toContain("SKILL.md:1: ../gone/SKILL.md");
  });

  test("a missing root reports error", () => {
    const done = run([join(temp, "nope")]);
    expect(done.exitCode).toBe(2);
    expect(done.stderr).toContain("not a directory");
  });
});
