---
name: nix-best-practices
description: Nix and flake working rules. Use when reading or editing any .nix file, working in a flake, packaging software with Nix, or diagnosing a Nix build.
disable-model-invocation: true
---

# Nix best practices

The repository's own instruction file comes first where it speaks: formatter, build venue, and layout differ per repository. Without one, format with `nix fmt` when the flake exposes its own formatter (a `treefmt` wrapper may also run linters), otherwise with `flake-fmt`. Apply [principle-prove-it-works](../principle-prove-it-works/SKILL.md) to the result, with evaluation as the proof unless a build was asked for.

## Building

| Rule | Summary |
|------|---------|
| Build only on request | Verify a change with `nix eval` of the option or attribute it touches. Name the build you would run, and wait. |
| Commits only means commits only | A request to reorder, split, or reword commits gets no evaluation and no build. |
| A CI failure is read, not reproduced | Diagnose from the CI log, through the `nixbot-cli` skill for nixbot. Reproducing it locally needs a request. |
| Check the builder before a Linux build | From macOS a Linux derivation needs a remote builder. If it is down, say so and do not start. |
| Never follow a build in the foreground | Start it in the background and wait for the notice. |
| Where a repository file and the user disagree | The user's word in this session wins. Name the line that says otherwise. |

## Follow what the repository already does

| Rule | Summary |
|------|---------|
| Read before shaping | Lay out a new module, package, check, or output the way the nearest existing one is laid out. |
| Read the flake it copies from | Open the reference the user or the instruction file names, and match it before writing. |
| No output the repository does not have | No `nixosModules`, `apps`, `perSystem`, or `checks` entry because it is common elsewhere. |
| Tests go in `checkPhase` | Not in a separate check derivation. |
| Leave what was not asked about | Keep the existing settings, host entries, and source filters. |

## Writing the code

| Rule | Summary |
|------|---------|
| `lib.` is written out | `lib.mkIf`, `lib.types.str`. `with` covers one list or one type, never a file or an attribute set. |
| No lambda without arguments | A module that uses no argument is a plain attribute set, not `{ ... }:`. |
| Dotted paths | Repeat `systemd.services.foo.serviceConfig.User = ...;` and do not gather the lines into a block. Leave statix W20. |
| Plain over generated | Write it out. Generate only one unit per item of an attribute set that already exists. No `mk*` helper that returns a plain attribute set. |
| `let` holds what is used twice | Short aliases and values used more than once. A binding used once is written where it is used. |
| `finalAttrs`, not `rec` | A package that refers to its own attributes takes `finalAttrs`. |
| Platform through `stdenv.hostPlatform` | `stdenv.hostPlatform.isDarwin` and `stdenv.hostPlatform.system`, not `stdenv.isDarwin` or `pkgs.system`. |

Examples: [patterns](references/patterns.md).

## Fix it where it is wrong

| Rule | Summary |
|------|---------|
| Do not silence a guard | Fix the cause. `permittedInsecurePackages`, `doCheck = false`, and an older pin hide it. |
| Option before patch | A module option or a configuration change beats `postPatch` and `substituteInPlace`. |
| Direct reference before overlay | An overlay is for replacing a package everyone already gets. |
| Source build before prebuilt binary | Where upstream builds from source, patch the source build. |
| Look for the fix on master and staging | Ask every branch whether it is fixed, and the tracked branch whether a bump brings the fix. [upstream-triage](../upstream-triage/SKILL.md) owns both. |
| Recheck a workaround when its cause is gone | A local change can retire one too. Carrying it through a rebase needs its reason restated. |
| Check nixpkgs and the existing inputs first | Search both before writing a derivation. |
| One-time cleanup is an action | Do it once by hand and say so. No migration script in every activation. |

## Failures to expect

| Failure | What to do |
|------|---------|
| `is not tracked by Git` | `git add` the new file before evaluating. |
| Linux builder unavailable | See "Check the builder before a Linux build". |
| `ignoring untrusted flake configuration setting` | Stop and report it. Everything would build from source. |
| Import-from-derivation is disabled | Vendor the lock file and filter at build time. |
| A fixed-output fetch fails only on CI | Suspect the builder's network before the package. |

Hash discovery with `lib.fakeHash` and the reported `got:` hash is the normal workflow.
