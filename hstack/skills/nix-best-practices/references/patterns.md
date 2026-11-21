# Nix patterns

Code examples for each rule under "Writing the code" in `SKILL.md`.

## `lib.` is written out

```nix
config = lib.mkIf cfg.enable { ... };
home.packages = with pkgs; [ ripgrep fd ];
type = with lib.types; either (listOf str) str;
```

Not this:

```nix
hostOptions = with lib; {
  ipv4 = mkOption { type = types.str; };
};
meta = with lib; { license = licenses.mit; };
```

## No lambda without arguments

```nix
{
  clan.modules.rustic = ./rustic;
}
```

Not `{ ... }:` in front of it. A module that reads `config`, `lib`, or `pkgs` keeps its head: `{ config, lib, ... }:`.

## Dotted paths

```nix
systemd.services.qdrant.serviceConfig.DynamicUser = lib.mkForce false;
systemd.services.qdrant.serviceConfig.User = "qdrant";
systemd.services.qdrant.serviceConfig.Group = "qdrant";
```

Not gathered into `systemd.services.qdrant.serviceConfig = { ... };`. A nested set is for a namespace with many keys, such as `networking = { ... };` in a host's network file.

## Plain over generated

Generated, because the items already exist as an attribute set:

```nix
systemd.sockets = lib.mapAttrs' (
  name: port: lib.nameValuePair "proxy-${name}" { listenStreams = [ (toString port) ]; }
) cfg.proxies;
```

Written out, because there is one:

```nix
checks.devshell-default = self'.devShells.default;
```

Not a helper around a plain attribute set:

```nix
mkPolicy = name: paths: { inherit name paths; mode = "append"; };
```

Write the attribute set where it is used. A few lines needed in two places are written twice, not moved to a shared file.

## `let` holds what is used twice

```nix
let
  cfg = config.services.foo;
  aiPkgs = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system};
in
```

Not a binding for one use:

```nix
let
  fooSource = fetchFromGitHub { ... };
in
buildGoModule { src = fooSource; }
```

Write `src = fetchFromGitHub { ... };`.

## `finalAttrs`, not `rec`

```nix
buildGoModule (finalAttrs: {
  pname = "foo";
  version = "1.2.3";
  src = fetchFromGitHub {
    owner = "example";
    repo = "foo";
    tag = "v${finalAttrs.version}";
    hash = "sha256-...";
  };
})
```

A package that refers to none of its own attributes stays a plain attribute set.

## Platform through `stdenv.hostPlatform`

```nix
home.packages = lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.colima ];
trek = self.packages.${pkgs.stdenv.hostPlatform.system}.trek;
```

Not `pkgs.stdenv.isDarwin` or `self.packages.${pkgs.system}`.
