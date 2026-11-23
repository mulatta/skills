# Modules

Rules for NixOS, home-manager, and nix-darwin modules. The three share the module system, so most rules apply to all of them. The sections after the table hold what differs.

| Rule | Summary |
|------|---------|
| What current models already write | `mkEnableOption`, `mkPackageOption`, a `settings` option typed by `pkgs.formats.<format> { }`, an `example` on options, a secret passed as a file path or systemd credential instead of a string, and `mkRenamedOptionModule` for a renamed option. Check they are there. |
| `settings` is freeform | Type `settings` as a submodule with `freeformType = format.type`, and declare typed options only for the keys the module itself reads. Thirty documented upstream keys are not thirty options, and `extraConfig` strings go away. |
| Options say what they default to | Every option has a `type` and a `description`. A default computed from other values or from `pkgs` gets `defaultText = lib.literalExpression "..."`, or the manual shows a store path or nothing. |
| A changed default does not move existing users | Gate it on the state version (`system.stateVersion`, `home.stateVersion`) so existing installs keep the old value, and say so in the option description and the ecosystem's change log. Inside nixpkgs, NixOS modules declare a `stateRevision` option with `utils.mkStateRevisionOption` rather than reading `system.stateVersion` directly. |
| Renames and removals stay in the module | `mkRenamedOptionModule` for a pure rename, `mkRemovedOptionModule` with a message that names the replacement. They go in the owning module's `imports`, not a central rename file. |
| Warnings for degraded, assertions for impossible | A config that still works but is worse gets a `warnings` entry. An `assertions` entry is for a config that cannot work, because it fails evaluation for every user who has it. |
| A test comes with the module | NixOS: a `runTest` VM test, or an evaluation test when the unit cannot run in a VM. home-manager: an NMT test that asserts the generated files. nix-darwin: a test that builds the config and greps the generated plist or activation script. Cover the disabled and null-package branches. |
| Interpolation into `Exec*` is escaped | A value interpolated into `ExecStart` or another `Exec*` line goes through `utils.escapeSystemdExecArg` or `utils.escapeSystemdExecArgs`. |
| `meta.maintainers` on a new module (nixpkgs, home-manager) | Leave it out of a personal flake. |

## NixOS

- A secret arrives through `LoadCredential` or `ImportCredential` and is read from `$CREDENTIALS_DIRECTORY`, or through a `*File` option.
- Incompatible changes in nixpkgs get a release note in `nixos/doc/manual/release-notes/`.

## home-manager

- `package` is `lib.mkPackageOption pkgs "name" { nullable = true; }`, and every use is guarded with `cfg.package != null`, so a user can manage the program elsewhere.
- A new module or a changed behavior gets a news entry, created with the repository's `create-news-entry`.
- Config paths differ per platform: check where the program reads its file on Darwin before assuming `xdg.configFile`.
- A maintainer entry goes in its own first commit.

## nix-darwin

- A port of a NixOS module says "Based off" with the NixOS path at the top and stays diffable against it.
- Services are `launchd.daemons` or `launchd.agents` with `command`, which waits for the Nix store to mount with `wait4path`.
- A new `system.defaults` option registers in the defaults writer. Check option semantics against the macOS man page and encode them in types and assertions.
- A changed default bumps `maxStateVersion` and gets a CHANGELOG entry.
