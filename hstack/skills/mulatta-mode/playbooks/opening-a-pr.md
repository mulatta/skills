### Opening a PR

**You own the description, and you open the PR.**

Run when a PR was asked for. A runtime may have loaded the git state already. Use it, and re-run a diff it truncated by path.

Work from a worktree or branch off trunk, and keep unrelated work out of it. Run the **deslop** skill over the diff before commit. Commit every pending in-scope change and report what you left out. Reshape existing commits through [tidy](../../tidy/SKILL.md) only when asked. Describe the diff as it stands after the commits, against the base the user named, otherwise `origin/HEAD`.

Title: at most 72 characters, in the repository's own subject convention. Body: the repository's PR template when it has one. Otherwise one short paragraph with no headings or lists that says what the PR does, then why before how. For one commit, expand its body slightly. For several, give the overall goal and do not list them. Show before and after for a UI or performance change. Mention testing only when a run verified it.

Push with `git push -u origin HEAD`, never by force. If the push fails, keep the draft and report the failure. Open the PR ready, from the terminal: `gh pr create --base <base-branch> --title <title> --body <body>`, or `tea pr create` with the same fields. No step needs a browser, so it runs the same on a headless machine. Base a follow-up on this branch, through `gh-stack` where it manages the stack. Opening a PR does not start a babysit.

**Reply:** the push outcome, the PR's URL, and what you left out of scope.
