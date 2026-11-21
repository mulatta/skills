---
name: upstream-triage
description: Investigate upstream package bugs, missing features, compatibility problems, and lifecycle failures before proposing workarounds or patches. Use whenever diagnosing a third-party tool or dependency, including restart, upgrade, packaging, and runtime issues. Check the exact installed source, upstream issues and PRs, and the latest default branch; distinguish proposed fixes from merged and released fixes.
---

# Upstream Triage

Before proposing a workaround or patch for a third-party package problem, check
whether upstream already reports, fixes, or documents it. Do this proactively;
do not wait for the user to ask about issues or PRs.

## Establish two baselines

1. Identify the executable/package actually in use and its version. Distinguish
   the configured package from the running process: a daemon can still use an
   older executable or Python environment after a package update.
2. Find the authoritative repository from package metadata, source URLs, and
   lockfiles. Check owner, fork, monorepo component, release tag, commit, and
   downstream patches. A display version alone is not enough. For Nix, record
   the source revision and relevant overrides as well as the store path.
3. Inspect documentation and code at that exact revision. Do not substitute
   current documentation for release documentation.
4. Discover the upstream default branch rather than assuming `main` or `master`.
   Resolve its current commit and inspect the same behavior there separately.
   Use a separate checkout/worktree or remote file reads; do not disturb the
   user's checkout or replace the release baseline with `FETCH_HEAD`.

## Search upstream evidence

- Search both issues and PRs, including open, closed, and merged results.
- Start with the exact error and command, then use symptom synonyms, subsystem
  names, and function/protocol names found in the source. Search beyond titles.
- For a downstream fork, check the fork for packaging-specific changes and the
  canonical upstream for product behavior. Follow linked issues, PRs, and fixes.
- Read the relevant bodies and maintainer discussion, not just search snippets
  or bot summaries. Inspect the diff and tests when the proposed fix matters.
- Record current status and scope. Closed does not mean fixed; merged does not
  mean released. Verify whether the fixing commit is included in the installed
  revision, latest default branch, and a released version before claiming so.
- If a fix was rebased, squashed, reverted, or ported to another implementation,
  inspect the resulting code. A historical TypeScript fix is not proof that a
  Rust implementation has the same behavior.
- Bound the search. If nothing relevant appears, say which repository and terms
  were searched and that no matching report was found; do not claim none exists.

## Compare and report

Keep these conclusions separate:

- **Installed version:** verified behavior and code/documentation references.
- **Latest upstream:** current behavior at a named commit; meaningful differences.
- **Related issues/PRs:** links, status at lookup time, scope, and release inclusion
  when verified. Distinguish maintainer claims, tests, and local reproduction.
- **Recommendation:** upgrade to a verified release, use an existing workaround,
  investigate/backport a pending fix, or propose a narrowly scoped upstream change.
  It is a finding for the caller, who decides what to do with it.

Do not present internal flags or hypothetical APIs as supported public commands.
Mark unknowns explicitly, including unverified runtime behavior and release bounds.
If upstream is inaccessible, state that limitation and continue with local evidence.

## Safety

This is investigation, not permission to upgrade, patch, restart, kill processes,
change configuration, open issues, comment, or push. Keep running sessions intact.
Use read-only diagnostics; isolate any authorized reproduction with temporary
state directories and sockets. Do not expose credentials, private logs, or user
session contents in searches or upstream reports.
