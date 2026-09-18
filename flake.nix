{
  description = "gh-viewer dev shell: nodejs, python3, firefox, chromium, drivers, web-ext";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ]
      (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.python3
              pkgs.firefox
              pkgs.web-ext
              pkgs.chromium
              pkgs.chromedriver
              pkgs.geckodriver
            ];
          };
        }
      );
}
