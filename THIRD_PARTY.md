# Third-party information

The runtime theme uses the browser platform without external UI libraries, web fonts or remote icon services. Interface illustrations, CSS and SVG charts are provided under this repository's MIT license. System fonts and emoji come from the visitor's device. No Microsoft proprietary artwork is included.

Country/region SVG flags in `public/flags` are vendored from [flag-icons 7.5.0](https://github.com/lipis/flag-icons/tree/v7.5.0/flags/4x3), copyright (c) 2013 Panayiotis Lipiridis, under the MIT license. All 249 ISO 3166-1 alpha-2 codes and seven additional two-letter codes supplied by that version are included. Flags are served locally and retain their original 4:3 artwork without cropping; no flag-icons CSS or JavaScript ships at runtime. The full license and pinned archive checksum are in `THIRD_PARTY_NOTICES.txt`, which is included in every release archive.

To reproduce the vendored assets and code registry, download `https://registry.npmjs.org/flag-icons/-/flag-icons-7.5.0.tgz` and run `python scripts/import-flags.py <archive-path>`. The importer checks the pinned SHA-256 before writing selected SVG files and the registry. Build tests check that source and packaged flags exactly match the registry.

Build and test tools (not shipped in `theme.tar.gz`):

| Tool | License | Purpose |
| --- | --- | --- |
| TypeScript | Apache-2.0 | Static type checking |
| esbuild | MIT | Module bundling |
| tsx | MIT | TypeScript unit tests |
| Playwright | Apache-2.0 | Browser regression checks and preview capture |
| Prettier | MIT | Source formatting |

Exact tool versions and transitive dependency integrity are recorded in `package-lock.json`. Tool license files are available in `node_modules` after `npm ci`.
