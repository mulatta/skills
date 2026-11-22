---
name: recall
description: "Reconstruct your recent working context from your own session transcripts, live state, and the repository record, then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work. Also answers whether a correction was given in an earlier session."
disable-model-invocation: true
---

# Recall

**Before you start or resume work, you rebuild the user's recent working context and hand back a tight capsule of where things stand now and what to do next.**

Keep it tight and on-topic. Read only what the in-scope threads need, then stop.

Your context lives in two records. Your own session transcripts hold what you did and decided. The repository record holds what happened to the same work outside a session: commits, branches, PRs, issues, and the files a session left behind. Don't reconstruct a thread from transcripts alone when the repository can say where it ended.

Read transcripts from the files, never from a search index. Every line of a file is one record.

- Claude Code: `~/.claude/projects/<slug>/<uuid>.jsonl`, where `<slug>` is the workspace path with each "/" and "." turned into "-" (so `/Users/you/proj` becomes `-Users-you-proj`).
- Codex: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<uuid>.jsonl`. These are filed by date, not workspace; the first record carries the `cwd`.
- Pi: `~/.pi/agent/sessions/<slug>/<time>_<uuid>.jsonl`, where `<slug>` is the workspace path wrapped in "--" with each "/" turned into "-".

Find the turns the user typed with `bun scripts/user_turns.ts --workspace <name> --since <date> --grep <regex>`, not by grepping the files. `--grep` takes a JavaScript regex and matches without regard to case. It drops tool output, compaction summaries, injected instruction files, and subagent prompts, matches a workspace by path component (a glob such as `infra*` reaches a sibling worktree directory), and marks a turn already seen in an earlier session as `repeat`. Each row gives the harness, session id, date, and line in the file.

These are this machine's transcripts. Say so in the brief when the work could have continued on another.

1. Classify, then route. One specific prior chat to resume is the `session-pickup` playbook, not this. A human-readable summary of your work is a different task. Recall loads working context across recent sessions before you act. If the user already gave you a full state capsule (paths, branch, the change), use it and skip the mining.
2. Lock the scope before searching. Pin the window ("recent" is a real range, default the last 7 days), the topic if named, and the workspace (default the active one. Never read another project's transcripts without being asked). State the scope back. Never quietly turn "all" into "recent N".
3. Fan out across your transcripts. Spawn parallel subagents on a fast, cheap model, each taking a slice of the corpus. Tell every subagent to order candidates by real modification time (`ls -t`) and never by UUID name, run the script for the topic first and then read only the matching sessions and only their relevant regions, and skip the current session plus obvious noise (subagent, eval, and test sessions). A session resumed or forked into another file repeats the same user turns; count it once. Each returns the same schema, one block per session: topic, the user's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, branches, files), each citing the session UUID. For one or two sessions, skip the fan-out and search directly. The raw transcripts stay in the subagents. The main thread gets only their findings. Take the subagent model from the user's model rules when they name one for this role.
4. Sweep the repository record whenever the topic names a feature, file, subsystem, or bug: `git log` over the paths, and `gh` for the PRs and issues that mention it. Ask "what's the current state, what's been tried and didn't hold". Null results are findings. Skip this step only for pure activity recall with no named target ("what did I do this week"), where your own history and live state are the entire answer.
5. Verify against live state. Take the PRs, branches, and files that the mining and the sweep surfaced and check them with `git` and `gh`. When the answer hinges on what an agent actually did (the tools it ran, files it read, errors it hit), read the full transcript, not just a trimmed local copy.
6. Write the brief to the contract below. Group by thread. Stay on the named topic.

## Output contract

Lead with the capsule, then the thread status, then the problems, then the next move. Deeper detail goes below or gets cut.

- **Capsule.** At most 5 bullets. What this work is and where it stands overall.
- **Threads.** One line each, prefixed with exactly one status tag: `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or `[planned, not started]`. A thread with no tag is not done yet, so tag it.
- **Problems.** At most 5, the recurring ones. Include any fix that shipped and was reverted, so the next attempt starts where the last one failed.
- **Next move.** The single most useful next action, concrete.

An adjacent feature or ticket stays out unless it blocks this one. When the capsule and thread lines outgrow a screen, cut detail before you cut threads. Cite transcript findings by session UUID and repository findings by their source (commit, PR #, issue #), and sanitize private context before any public output.

## Prior-occurrence lookup

A caller such as [reflect](../reflect/SKILL.md) asks whether a correction was given before, in another session. Skip the brief. Run the script with patterns for the corrected behaviour, in each language the user writes in. Open each row at its line to confirm it is a correction, and return one line per independent session: harness, session id, date, and file line. A session whose rows are all `repeat` is not independent. State the window, the workspaces, and the pattern, and report none found as none found in that scope.

**Reply:** the brief, to the contract above; or the lookup lines, when that was the question.
