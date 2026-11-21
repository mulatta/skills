---
name: track-pstack
description: "Follow pstack upstream by hand: show what it changed since the revision this tree was last compared with, apply what the user picks, and bring in a skill this tree left out when a task needs it. Use for /track-pstack, \"sync pstack\", \"what changed upstream\", or \"does pstack have something for X\"."
disable-model-invocation: true
---

# Track pstack

This tree carries the part of pstack (`cursor/plugins`, subtree `pstack`) that is in use and leaves the rest upstream until a task needs it. Nothing comes in on its own. Show the user what upstream changed, and apply what they pick. The tools are `git` and `gh`.

## The record

Three files in `references/`:

- `revision`: the upstream commit this tree was last compared with.
- `dropped.tsv`: upstream paths left out, with what each does and why it is out.
- `modified.tsv`: upstream files rewritten here, with why. `git log -- <file>` has the detail.

A line is `path<TAB>reason`. The path is upstream's, relative to `pstack/`, and one ending in `/` is a directory. So a list is a set of pathspecs: `cut -f1 references/modified.tsv | sed 's#^#pstack/#'` selects its paths in the commands below, and `sed 's#^#:(exclude)pstack/#'` leaves them out. Read a reason with `rg -F '<path>' references/`, and change one by editing its line.

Four names differ here: `skills/poteto-mode` is `skills/mulatta-mode`, `skills/poteto-help` is `skills/mulatta-help`, `skills/setup-pstack` is `skills/hstack-setup`, and `agents/poteto-agent.md` is `agents/mulatta-agent.md`.

## Rules

- **Keep upstream's text.** Where it assumes a tool that is not here, supply the tool first: package it, or write the CLI. A file rewritten for a missing tool takes every later upstream change by hand.
- **Leave out what is not needed now.** Delete it and give its path a line in `dropped.tsv`.
- **Rewrite only for the user's rules or a Cursor name.** Give the file a line in `modified.tsv` in the same commit. Upstream maps the Cursor names in `pstack/docs/harness/claude-code.md`.

## What upstream changed

`U` is a clone of `https://github.com/cursor/plugins.git`, kept at `${XDG_CACHE_HOME:-~/.cache}/track-pstack/cursor-plugins` and fetched first. `R` is the recorded revision, and `H` is `git -C $U rev-parse origin/HEAD`.

1. `git -C $U log --oneline $R..$H -- pstack` lists the commits. `gh pr view <n> -R cursor/plugins` gives the reasons for one.
2. `git -C $U diff --no-prefix --relative=pstack $R $H -- pstack/skills pstack/agents <pathspecs>` shows the changes. Leave out `modified.tsv` and `dropped.tsv` to see the files that are upstream's as shipped. Select `modified.tsv` to see the ones rewritten here. Select `dropped.tsv` with `--stat` to see what moved in what is left out.
3. Present the three groups and wait for the user's picks. For a rule upstream removed, or added over one written here, say what the user's sessions show (the **correct** skill reads them).
4. Apply a pick by piping its diff into `git apply -p0`. Under `skills/poteto-mode`, diff with `--relative=pstack/skills/poteto-mode` and apply with `--directory=skills/mulatta-mode`. A patch that does not apply means the file was rewritten here: settle it by hand and give it a line in `modified.tsv`. A change the user declines in a file that was upstream's as shipped also makes it a rewritten file.
5. Write `$H` to `references/revision`, run `bun ../mulatta-mode/scripts/check_links.ts`, and commit. The message names each pick and each change declined.

## Bringing in what was left out

When a task needs something this tree lacks, look in `dropped.tsv`, then in `git -C $U ls-tree --name-only $R pstack/skills/`. Bring a path in as upstream ships it at the recorded revision, with `git -C $U archive $R pstack/<path> | tar -x --strip-components=1` at the root of this tree. Delete its line and commit that alone. The link check then names every skill and script it calls that is not here. Adapt it in later commits.

**Reply:** the upstream commits read, what came in as shipped, each rewritten file and what was decided, each change declined, and the new revision.
