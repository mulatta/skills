# hstack

hstack is [pstack](https://github.com/cursor/plugins/tree/main/pstack) as I
changed it to run with Claude Code, Codex, and Pi. One mode,
`mulatta-mode`, holds the triggers, the principles, and the playbooks, and
calls the other skills when a step needs them.

## Get started

1. Install bun and `gh`. The scripts are TypeScript run by bun, with no
   runtime dependency.
1. For review panels across vendors and for autopilot, install a tool that
   starts agents in managed terminals. I use `hc` from
   [herdr-core](https://github.com/herdrdev/herdr-core). Without one, the
   mode reports those seats as missing instead of filling them.
1. Link each directory under [`skills/`](./skills) into your skill
   directory, for Claude Code `~/.claude/skills/<name>`, and each file under
   [`agents/`](./agents) into `~/.claude/agents/`. Codex and Pi read the same
   skills through `~/.agents/skills`.
1. Run `/hstack-setup` to pick a model and an effort for each role.
1. Start work that needs rigor with `/mulatta-mode`. Ask `/mulatta-help` when
   you are unsure which skill fits.

## How it differs from pstack

- It runs on Claude Code, Codex, and Pi instead of Cursor. Each skill that
  depended on a Cursor-only tool either uses a tool that exists here or is
  left out, and
  [`dropped.tsv`](./skills/track-pstack/references/dropped.tsv) lists what is
  out and why.
- The mode carries my own rules: which skill each trigger opens, when a
  build may start, how PRs open and merge, and how subagents start.
  [`modified.tsv`](./skills/track-pstack/references/modified.tsv) records
  every upstream file I rewrote and why.
- It adds `tidy` for history rewrites, `upstream-triage` for third-party
  failures, `nix-best-practices`, `recall` over all three harnesses'
  transcripts, and `deslop` from cursor-team-kit.

## Following upstream

[`track-pstack`](./skills/track-pstack/SKILL.md) records the upstream
revision last compared with. I read what upstream changed since then and
pick what to apply by hand.

## Checks

From the repository root, `nix flake check` runs the type check, the tests,
the link check, and the format check. `nix develop` opens a shell with bun,
`gh`, and shellcheck, and links `node_modules` from `package-lock.json`.

## License

MIT for my work, in [`LICENSE`](./LICENSE). pstack and cursor-team-kit keep
their own MIT notices in [`licenses/`](./licenses).
