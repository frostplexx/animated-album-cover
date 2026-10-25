{
  description = "Tiny api that provides animated album covers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        # node/npm for the app; python3 for the host-side extension-manifest-converter
        # pre-pass (invoked as `python3 emc.py`); esbuild available for bundling.
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_26 esbuild ];
        };
      });
}
