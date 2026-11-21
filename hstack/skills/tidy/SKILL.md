---
name: tidy
description: Reorganize tangled Git history into cohesive reviewable commits while preserving the final tree. Use for splitting, folding, reordering, or rewording existing branch commits. Requires approval of the rewrite plan; not for committing working changes or automatically preparing every PR.
---

# Tidy

Turn incremental history such as `A -> A+B -> B` into direct logical changes such as `A -> B`. Preserve the final tree and intent, not the original commit boundaries. Accept optional `[base-ref] [head-ref]`, with HEAD as the default head.

## Inventory

From the target repository, run the helper at this skill's installed path:

```sh
bun <skill-dir>/scripts/history.ts prepare [base-ref] [head-ref]
```

It writes nothing but a backup ref under `refs/backup/tidy/`, and returns the status, the commit and file inventory, the merge commits, and the final diff stat as JSON. Keep the backup ref. With no base it takes the local branch that `origin/HEAD` names, then `main`, then `master`, and it never fetches. An empty range needs no rewrite.

The inventory is a map, not the evidence. Read the installed `git-surgeon` skill, and inspect tangled files and ambiguous hunks with its `hunks --commit`, `--full`, `--blame`, and `show`. Do not load the whole branch patch.

## Plan and approval

Present each proposed commit's subject, purpose, and files or hunks. Each commit:

- has one clear purpose and is understandable from its own diff and message
- carries the tests, docs, and configuration of the change they explain
- is small enough to review, and buildable when practical

Split independent concepts. Combine only a fixup or a supporting change with its concept. Do not squash everything unless the whole change is one small unit. Write imperative subjects in the repository's convention, and say why in a body when needed.

Wait for the plan to be accepted before changing history. A dirty worktree or index stops you first: ask how to handle the changes, and do not stage, commit, reset, or stash them, or rely on an automatic stash. When the head is not the current HEAD, the plan names the branch or worktree to rewrite. When the range has merges, the plan says how each is handled.

## Execute and prove

1. Recheck status and HEAD. If the history moved since the inventory, prepare again and revise the plan.
2. Use git-surgeon's `split`, `fold`, `move`, `squash`, `amend`, and `reword`. Use lower-level Git only for what they cannot express, and never write an interactive rebase by hand.
3. Compare the result with the backup:

   ```sh
   bun <skill-dir>/scripts/history.ts verify <backup-ref> [rewritten-head]
   ```

   Exit 0 means identical trees, 1 different trees, 2 an error. A difference needs the user's explicit approval.
4. Run the narrow formatters, linters, and tests that apply, keep unrelated formatting out, and verify the tree again afterwards.
5. Inspect the final commits, with `git range-diff` when it helps.

**Reply:** the final commits, the checks run, the risks left, and the backup ref (`git for-each-ref refs/backup/tidy` lists them). Never delete or replace the backup, force-push, or update a remote ref without an explicit request.
