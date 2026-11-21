---
name: hstack-setup
description: Configure which models hstack uses per role and at what reasoning budget. Detects the models this harness can start and writes the role lines every hstack skill reads. Use for /hstack-setup, "configure hstack models", "hstack budget", or changing hstack's model choices.
disable-model-invocation: true
---

# Setup hstack

Write `~/.claude/rules/models.md`, the file that sets hstack's model and effort per role.

## Steps

### 1. Detect available models

Enumerate the models and efforts you can pass to a subagent in this session. The subagent tool's schema is the dependable source. A model from another vendor is available when a harness that runs it is installed on this machine and can be started in a managed terminal. Confirm such a model from that harness's own model list. If you cannot detect any, ask the user to paste the models they have access to. Never write a model you have not confirmed is available. The alias `inherit-parent` is always valid even though it is not a detected model.

### 2. Load current state

The default role-to-model mapping is the shape shown in step 5 below. If `~/.claude/rules/models.md` already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5 has no skill that reads it. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask with the harness's question tool where it has one, in plain text otherwise. Offer these three options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the defaults.

- `large (xhigh reasoning)`
- `medium (high reasoning)`
- `small (medium reasoning)`

**(b) Apply it.** Build the working table from the defaults, and on a re-run keep any role whose model or list the user changed. Each role has a target effort, which is its default's effort moved by the budget. `large` keeps it, `medium` lowers it one step, and `small` lowers it two steps, on the ladder `xhigh` > `high` > `medium` > `low`. No role runs above `xhigh`, and a target at the bottom of the ladder stays there. The budget does not move the panel roles (`arena runners`, `arena cross-judge pool`, `interrogate reviewers`). Every panel entry stays at `high`, because a panel's cost is set by how many seats it has, and a seat at low effort is its weakest judge. Set the effort of every other role to its target. So `medium` turns `inherit-parent xhigh` into `inherit-parent high` and `sonnet high` into `sonnet medium`, and `small` turns them into `inherit-parent medium` and `sonnet low`. If the harness cannot run a model at the target, use the highest effort it can at or below the target, else mark the role as needing a choice.

**(c) Show the roles and confirm.** Show every role with its model and effort, marking any model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent`, which runs the role on the parent session's model. For panel roles (`arena runners`, `interrogate reviewers`) the value is a list, and one subagent runs per entry, so the list length sets the count. A panel exists to seat different vendors, so say so when a list holds one vendor. `arena cross-judge pool` is also a list, but Arena runs one judge. It takes the first entry from a vendor other than the parent's, so order it by preference. Fable and the other Claude models are one vendor. `swarm workers` is the model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every model written must be in the detected set and at `xhigh` or below. `inherit-parent` always passes. If a chosen model is not available, stop and ask again.

### 5. Write the file

Write `~/.claude/rules/models.md` with no frontmatter: the comment lines, a `# budget` line with the chosen label and the effort that label names, and one line per role. Overwrite the whole file so re-runs stay idempotent. Never put the role lines in the global instruction file. Shape, at the `large` defaults:

```
# hstack model configuration. One line per role: the model its subagents run on, then the effort. `/hstack-setup` writes this file.
# `inherit-parent` in place of a model is the parent model: omit the model and pass the effort. A role with no line runs on the parent model.
# Several entries on one line is a panel, one seat per entry, and its point is that the seats come from different vendors. A seat this harness cannot run starts in a managed terminal on the harness that can. It is never swapped for the parent model, which would leave the panel with one vendor. A panel seat stays at high whatever the budget: the other vendor's seat is the judge, and at low effort it is the weakest one.
# `swarm workers` names a cheap model, not a vendor. Where this harness cannot run it, the workers run on the parent model at low effort.
# budget: large (xhigh)
feature, refactoring: inherit-parent xhigh
bug-fix: inherit-parent xhigh
perf-issue: inherit-parent xhigh
hillclimb: inherit-parent xhigh
judgment and prose: inherit-parent xhigh
arena runners: opus high, gpt-6.2-astra high
arena cross-judge pool: opus high, gpt-6.2-astra high
interrogate reviewers: opus high, gpt-6.2-astra high
swarm workers: sonnet high
```

### 6. Confirm

Tell the user the file was written and that it applies to new sessions. Re-running this skill updates it. When the file is tracked in a repository, commit the change there.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, read [create-verification-skill](../create-verification-skill/SKILL.md) and follow it. On no, move on without pushing.
