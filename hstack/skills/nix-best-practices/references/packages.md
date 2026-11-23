# Packages

Rules for a derivation: a `callPackage` file under `pkgs/` or `packages/`, or a package defined inline. Rows marked (nixpkgs) are required when contributing to nixpkgs and optional in a personal flake.

| Rule | Summary |
|------|---------|
| What current models already write | `finalAttrs`, `tag` with an SRI `hash`, `meta.mainProgram`, an install check (`versionCheckHook` runs `--version`, `pythonImportsCheck` imports a Python module), and one skipped test with a comment saying why. Check they are there. |
| Structured attributes on a new package (nixpkgs) | `__structuredAttrs = true;`: nixpkgs documentation requires it on every new top-level package and nixpkgs-vet checks it. Add `strictDeps = true;` too, which keeps build and runtime inputs apart for cross-compilation. |
| `meta` is complete | `description`, `homepage`, `changelog` pointing at the release notes for `finalAttrs.version`, the exact `license`, `mainProgram`, and `maintainers` (nixpkgs). `passthru` comes before `meta`. |
| One place to update | Version and hashes live in the derivation, so `passthru.updateScript = nix-update-script { };` can bump them. A repository with its own updater, such as per-package `nix-update-args` files or an `update.py`, uses that instead. |
| Tests run once | Unit tests run in `checkPhase`, tests of the installed result in `installCheckPhase` or `passthru.tests`. A check that compiles the package again builds it twice on CI. |
| Source build before prebuilt binary | Where upstream builds from source, patch the source build. No `-bin` package where a source build works. |
| Look for a hook before writing one | Before setting a build environment variable or writing a phase by hand, search the locked nixpkgs: `doc/hooks/`, `pkgs/build-support/`, and the release notes in `doc/release-notes/`. Hooks change after a model's training, such as `installAgentSkills`, or `cargoSetupHook` linking zstd and openssl from nixpkgs. Find the locked source with `nix eval --raw --impure --expr '(builtins.getFlake (toString ./.)).inputs.nixpkgs.outPath'`. |
| A patch carries its source | A fetched patch uses `fetchpatch2` with a `name` and the upstream PR or commit URL in a comment. A local patch file says where it was sent upstream. |
| Overrides stay outside nixpkgs | Inside nixpkgs, a new `overrideAttrs` of another package is rejected because it hides from updates. A personal flake overriding a package for itself is fine. |
| Removal leaves a trail (nixpkgs) | A removed package becomes a dated `throw` alias in `pkgs/top-level/aliases.nix`, with the reason in the commit body. |

```nix
{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
  nix-update-script,
}:
buildGoModule (finalAttrs: {
  pname = "pastebin-lite";
  version = "1.3.0";

  src = fetchFromGitHub {
    owner = "acme-tools";
    repo = "pastebin-lite";
    tag = "v${finalAttrs.version}";
    hash = "sha256-...";
  };

  vendorHash = "sha256-...";

  __structuredAttrs = true;
  strictDeps = true;

  # TestWebhookDelivery reaches the internet, which the sandbox blocks.
  checkFlags = [ "-skip=^TestWebhookDelivery$" ];

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Small pastebin server with a CLI client";
    homepage = "https://github.com/acme-tools/pastebin-lite";
    changelog = "https://github.com/acme-tools/pastebin-lite/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.mit;
    mainProgram = "pastebin-lite";
  };
})
```
