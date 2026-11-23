---
name: nix-best-practices
description: Nix and flake working rules. Use when reading or editing any .nix file, working in a flake, packaging software with Nix, or diagnosing a Nix build.
disable-model-invocation: true
---

# Nix best practices

The repository's own instruction file comes first where it speaks: formatter, build venue, and layout differ per repository. Without one, format with `nix fmt` when the flake exposes its own formatter (a `treefmt` wrapper may also run linters), otherwise with `flake-fmt`. Apply [principle-prove-it-works](../principle-prove-it-works/SKILL.md) to the result.

This file holds what applies to all Nix code. Read the reference for what you are editing as well:

| Editing | Read |
|------|---------|
| A package: a `callPackage` file or another derivation | [packages](references/packages.md) |
| A NixOS, home-manager, or nix-darwin module | [modules](references/modules.md) |
| A machine or fleet flake: hosts, shared base modules, inputs, secrets wiring, deployment | [infrastructure](references/infrastructure.md) |

## Writing the code

Each of these picks one of several valid forms, the one that keeps the file easy to diff, grep, and override.

| Rule | Summary |
|------|---------|
| A module that takes no argument is an attribute set | The module system accepts an attribute set, so neither `{ ... }:` nor `_:` is needed. `_:` is what statix's fix leaves, not the simplest form. A file called through `callPackage` or `import` with arguments, and an overlay, stay functions. |
| Plain over generated | Generate only one unit per item of an attribute set that already exists. A local `mk*` helper that returns a plain attribute set hides the value its caller sets, so write it out. A library helper that encodes a convention, such as `lib.cmakeBool` or `mkPackageOption`, is not that helper. |
| `let` holds what is used twice | A binding used once is written where it is used, unless its name explains a long expression. |
| Current nixpkgs idioms | No file-wide `with lib;`: write `lib.mkIf`, or `inherit (lib) mkIf mkOption;` in the `let`. `with` covers one list or one type. `finalAttrs` over `rec`, and `stdenv.hostPlatform.isDarwin` and `.system` over `stdenv.isDarwin` and `pkgs.system`. `with pkgs.lib;` over a module's options also recurses through `pkgs`. |

Examples: [patterns](references/patterns.md).

## Follow what the repository already does

| Rule | Summary |
|------|---------|
| Read before shaping | Lay out a new module, package, check, or output the way the nearest existing one is laid out: file split, where packages live, how modules are imported. |
| Read the flake it copies from | Open the reference the user or the instruction file names, and match it before writing. |
| No output the repository does not have | No `nixosModules`, `apps`, `perSystem`, or `checks` entry because it is common elsewhere. `meta.mainProgram` already makes a package runnable. |
| Ship the test with the change | A package's own checks, a module's VM or evaluation test, a machine's toplevel as a flake check. The reference for the kind says which. |
| Leave what was not asked about | Keep the existing settings, host entries, and source filters. |

## Fix it where it is wrong

| Rule | Summary |
|------|---------|
| Do not silence a guard | Fix the cause. Skip the one test that needs the network with `checkFlags` or `disabledTests`, not `doCheck = false`. Drop or bump the dependency that pulls in an insecure package, not `permittedInsecurePackages`. An older pin hides the fault too. |
| Option, then patch file, then substitution | A module option or a configuration change comes first. Then a patch file, which stops applying when upstream changes the code. Then `substituteInPlace --replace-fail`, never a plain `--replace` or `sed`, which pass silently when nothing matches. |
| Direct reference before overlay | A package only one environment needs is defined and referenced there. An overlay is for replacing a package everyone already gets. |
| Look for the fix on master and staging | Ask every branch whether it is fixed, and the tracked branch whether a bump brings the fix. [upstream-triage](../upstream-triage/SKILL.md) owns both. |
| A workaround names its way out | Its comment names the upstream issue or commit and the condition for removing it. After a nixpkgs bump or a local change, check that condition. Carrying it through a rebase needs its reason restated. |
| Check nixpkgs and the existing inputs first | Search both before writing a derivation or a module. |
| One-time cleanup is an action | Do it once by hand and say so. No migration script in every activation. |

## Working rules in this setup

These are the user's operating rules, not Nix practice. A repository's instruction file can change them.

| Rule | Summary |
|------|---------|
| Build only on request | Verify by evaluating the `.drvPath` of what changed, such as `config.system.build.toplevel.drvPath` or a package's `.drvPath`. Evaluating one option misses assertions and type errors elsewhere. A build "as a sanity check", per commit, or after each git step is not asked for. Name the build you would run, and wait. |
| Commits only means commits only | A request to reorder, split, or reword commits gets no evaluation and no build. |
| A CI failure is read, not reproduced | Diagnose from the CI log, through the `nixbot-cli` skill for nixbot. Reproducing it locally needs a request. |
| Check the builder before a Linux build | From macOS a Linux derivation needs a remote builder. If it is down, say so and do not start. |
| Never follow a build in the foreground | Start it in the background and wait for the notice. |
| Where a repository file and the user disagree | The user's word in this session wins. Name the line that says otherwise. |
| Secrets stay out of the store | Every user can read the Nix store, so a secret never goes in a Nix string or through `builtins.readFile`. Use the repository's secret mechanism. |

## Failures to expect

| Failure | What to do |
|------|---------|
| `is not tracked by Git` | `git add` the new file before evaluating, or `git add -N` when nothing may be staged. |
| A changed `version` or `rev` still builds the old source | Reset `hash`, `vendorHash`, and `cargoHash` to `lib.fakeHash` and fill in the reported `got:` hash. A fixed-output path already in the store is reused without fetching. |
| Linux builder unavailable | See "Check the builder before a Linux build". |
| `ignoring untrusted flake configuration setting` | The flake's own substituters and settings were dropped, so what only they cache builds from source. Stop and report it. |
| Import-from-derivation is disabled | The user's flakes set `allow-import-from-derivation = false`. Vendor the lock file and filter at build time. |
| A fixed-output fetch fails only on CI | Suspect a stale hash first: the local store can hold the old output, so the local build never fetched. Then the builder's network. Adding a substituter is not the fix. |
