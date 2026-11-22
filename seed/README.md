# seed

seed is a small starting set of agent skills cut from hstack,
with the coding workflows left out. It keeps the parts that work for any
task: a mode with its principles and playbooks, recall of earlier sessions,
reflect on this session's lessons, and a decision log for long runs.

## Get started

1. Install bun. The scripts are TypeScript run by bun, with no runtime
   dependency.
1. Link each directory under [`skills/`](./skills) into your skill
   directory, for Claude Code `~/.claude/skills/<name>`, and
   [`agents/seed-agent.md`](./agents/seed-agent.md) into `~/.claude/agents/`.
   Codex and Pi read the same skills through `~/.agents/skills`. Keep the
   skills side by side: they read each other at `../<name>/SKILL.md`.
1. Add this line to your global instruction file (`~/.claude/CLAUDE.md`)
   so every reply follows `unslop` without asking:

   ```
   Prose follows the `unslop` skill, chat replies included. Read `~/.claude/skills/unslop/SKILL.md` before the first reply of a session.
   ```

1. Start work with `/seed-mode`.

Every skill opens only when you type its name. None starts on its own.

## What is in it

| Skill | Use it for |
|---|---|
| `/seed-mode` | Working with grounded claims, small changes, and verified work. Its playbooks resume a past session, pause safely, run unattended to a done condition, and write a new skill. |
| `/recall` | Rebuilding where your recent work stands from session transcripts and the repository. |
| `/reflect` | Turning corrections from this session into edits on your skills or instruction file. A correction seen in only one session waits in `reflect/candidates.md`. |
| `/show-me-your-work` | A TSV log of each decision in a long or unattended run. |
| `/unslop` | Cutting AI patterns from prose. |
| `/bro` | Restating the last reply in plain words. |
| `/in-your-own-words` | Restating what the agent thinks your goal is. |
| `/sharpen` | Rewriting a task prompt to ask for deeper work. |

The `principle-*` skills are the rules the mode cites. The mode opens them
when a step needs one.

## Growing it

Run `/reflect` at the end of a session that taught you something. Write a
new skill with the mode's Authoring a skill playbook, then check its links:

```
bun skills/seed-mode/scripts/check_links.ts skills
```

## License

MIT, in [`LICENSE`](./LICENSE). pstack and cursor-team-kit keep their own MIT
notices in [`licenses/`](./licenses).
