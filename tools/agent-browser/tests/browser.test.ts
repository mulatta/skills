import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const ENDPOINT = process.env.AGENT_BROWSER_TEST_CDP ?? "";
const COMMAND = ["agent-browser"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function hostname(endpoint: string): string | null {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host.replace(/^\[(.*)\]$/, "$1") || null;
  } catch {
    return null;
  }
}

async function targets(): Promise<Set<string>> {
  const response = await fetch(`${ENDPOINT}/json/list`, { signal: AbortSignal.timeout(5000) });
  const items = (await response.json()) as { id: string; type: string }[];
  return new Set(items.filter((item) => item.type === "page").map((item) => item.id));
}

function spawn(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const done = Bun.spawnSync([...COMMAND, ...args], { stdout: "pipe", stderr: "pipe", timeout: 45_000 });
  if (done.exitedDueToTimeout) throw new Error(`agent-browser ${args.join(" ")} timed out after 45 seconds`);
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() };
}

describe.skipIf(!ENDPOINT)("agent-browser against a disposable browser", () => {
  test(
    "batch, pin and disconnect",
    async () => {
      if (!LOOPBACK.has(hostname(ENDPOINT) ?? "")) {
        throw new Error("Integration tests require a disposable loopback browser");
      }
      const session = `skill-test-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const cli = (args: string[], ok = true): Record<string, unknown> => {
        const result = spawn(["--session", session, "--json", ...args]);
        const data = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(data.success, JSON.stringify(data)).toBe(ok);
        expect(result.exitCode === 0, JSON.stringify(data)).toBe(ok);
        return data;
      };

      const before = await targets();
      cli(["--pin-tab", "connect", ENDPOINT]);
      const owned = new Set([...(await targets())].filter((id) => !before.has(id)));
      expect(owned.size).toBe(1);
      const target = [...owned][0] ?? "";

      try {
        const html = `<title>Fixture</title><label>DOI<input id="doi"></label>
<button onclick="document.querySelector('#result').textContent='Found'">Search</button>
<p id="result"></p>`;
        cli(["open", `data:text/html;charset=utf-8,${encodeURIComponent(html)}`]);
        const snapshot = cli(["snapshot", "-i"]);
        expect(JSON.stringify(snapshot)).toContain("Search");
        const result = spawn([
          "--session",
          session,
          "batch",
          "--bail",
          'fill "#doi" "10.1234/example"',
          'click "button"',
          'wait --text "Found"',
          "snapshot",
        ]);
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toContain("Found");
        cli(["tab", "close", target]);
        expect((await targets()).has(target)).toBe(false);
        cli(["get", "url"], false);
        cli(["tab", "new", "about:blank"]);
        for (const id of await targets()) if (!before.has(id)) owned.add(id);
      } finally {
        try {
          const live = await targets();
          for (const id of owned) if (live.has(id)) cli(["tab", "close", id]);
        } finally {
          cli(["close"]);
        }
        const after = await targets();
        expect([...before].every((id) => after.has(id))).toBe(true);
      }
    },
    5 * 60_000,
  );
});
