### Authoring or modifying a skill

**You own the skill's voice.**

1. Look for what exists first: this tree, the installed skills, and pstack upstream (`cursor/plugins`). Import an existing one unchanged in one commit, then adapt it in the next.
2. Name the sessions behind a new rule, through the **correct** or **reflect** skill. Leave out a rule that has none, or mark it unproven.
3. Pick the level per the **encode-lessons-in-structure** principle skill: a check, a playbook step, a principle, or a best-practices skill.
4. Write it in English with the harness's skill-authoring skill.
5. Validate the skill: frontmatter has `name` and `description`, a hidden skill has `agents/openai.yaml` with `allow_implicit_invocation: false`, and `bun scripts/check_links.ts` reports nothing. A commit that rewrites a file from upstream gives it a line in the **track-pstack** skill's `references/modified.tsv`.
6. Run it on a real case and check the result against a known answer. A claim about behaviour goes through [Eval](eval.md).
7. Commit one skill per commit. Never push.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, the evidence it rests on, key design decisions, validation notes.
