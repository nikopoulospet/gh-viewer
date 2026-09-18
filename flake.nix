{
  description = "gh-viewer dev shell: nodejs, python3, firefox + chromium and their drivers, web-ext, librsvg";

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
              pkgs.geckodriver
              # The Chrome side: chromedriver must match chromium's major
              # version, so they are taken from the same nixpkgs revision.
              pkgs.chromium
              pkgs.chromedriver
              # rsvg-convert, for rasterising the icon Chrome will not take as SVG.
              pkgs.librsvg
            ];
          };
        }
      );
}
