{
  description = "hstack: agent skills for Claude Code, Codex, and Pi";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      inherit (nixpkgs) lib;

      eachSystem = lib.genAttrs systems;

      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });

      treefmtEval = eachSystem (
        system:
        treefmt-nix.lib.evalModule pkgsFor.${system} {
          projectRootFile = "flake.nix";
          programs = {
            deadnix.enable = true;
            nixfmt.enable = true;
            shellcheck.enable = true;
            statix.enable = true;
          };
        }
      );

      nodeModulesFor = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        pkgs.buildNpmPackage {
          pname = "skills-node-modules";
          version = "0.1.0";
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json
              ./package-lock.json
            ];
          };
          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          inherit (pkgs.importNpmLock) npmConfigHook;
          dontNpmBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r node_modules $out/node_modules
            runHook postInstall
          '';
        }
      );

      runInRepo =
        system: name: command:
        let
          pkgs = pkgsFor.${system};
        in
        pkgs.runCommand name
          {
            nativeBuildInputs = [
              pkgs.bun
              pkgs.git
            ];
          }
          ''
            cp -r ${self} repo
            chmod -R u+w repo
            cd repo
            ln -s ${nodeModulesFor.${system}}/node_modules node_modules
            export HOME=$TMPDIR
            ${command}
            touch $out
          '';
    in
    {
      checks = eachSystem (system: {
        formatting = treefmtEval.${system}.config.build.check self;
        typecheck = runInRepo system "typecheck" "bun node_modules/typescript/bin/tsc --noEmit";
        tests = runInRepo system "tests" "bun test hstack/skills/*/tests";
        links =
          runInRepo system "links"
            "bun hstack/skills/mulatta-mode/scripts/check_links.ts hstack/skills";
      });

      devShells = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.bun
              pkgs.gh
              pkgs.shellcheck
            ];
            shellHook = ''
              ln -sfnT ${nodeModulesFor.${system}}/node_modules node_modules
            '';
          };
        }
      );

      formatter = eachSystem (system: treefmtEval.${system}.config.build.wrapper);
    };
}
