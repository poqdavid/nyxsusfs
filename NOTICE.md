# NyxSUSFS notices

NyxSUSFS
Copyright (C) 2026 poqdavid

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public
License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program (see `LICENSE`). If not, see
<https://www.gnu.org/licenses/>.

SPDX-License-Identifier: AGPL-3.0-only
Source code: <https://github.com/poqdavid/nyxsusfs>

## Code NyxSUSFS is derived from

- **ksu_module_susfs** by sidex15, AGPL-3.0
  <https://github.com/sidex15/ksu_module_susfs>
  NyxSUSFS grew out of this module. The boot-stage logic in `src/` (built
  into `bin/nyxsusfs`, which the `*.sh` stage files run) is derived from
  that module's boot scripts, and the installer (`customize.sh`), the
  binary download and update code in `action.sh` and `bin-update.sh`, and
  the SELinux rules in `sepolicy.rule` are derived from it too. NyxSUSFS also keeps
  its config layout and default lists (`config.sh`, `legit_mounts.txt` and
  the `sus_*` / `try_umount` files).
- **susfs4ksu** by simonpunk, GPL-3.0
  <https://gitlab.com/simonpunk/susfs4ksu>
  ksu_module_susfs builds on the sample module shipped with susfs4ksu; the
  permission cloning in `src/hide.rs` (`clone_perm`) comes from there. GPL-3.0 code
  may be combined with AGPL-3.0 code (section 13 of each license).

## Ideas reimplemented, not copied

- **BRENE** by rrr333nnn333, AGPL-3.0 — <https://github.com/rrr333nnn333/BRENE>:
  several targeted and bulk path-hiding features, their defaults, and the
  path-hiding self-test probe.
- **ReZygisk** by PerformanC, GPL-3.0 — <https://github.com/PerformanC/ReZygisk>:
  the Zygisk-aware unmounting and mount-source detection.

## Build-time dependencies

- `bin/nyxsusfs` is built from the Rust sources in `src/`. It has **no
  third-party crate dependencies** — only the Rust standard library — so no
  additional licenses are bundled on its account.
- `webroot/js/app.js` is bundled from the TypeScript sources in `webui/src/`
  by esbuild. TypeScript and esbuild are build tools only; the bundle
  contains no third-party code.

## Bundled third-party files

- `module/tools/ksu_susfs_arm64` and `module/tools/sus_su_arm64`: prebuilt
  binaries from **susfs4ksu-binaries** by sidex15 (AGPL-3.0,
  <https://github.com/sidex15/susfs4ksu-binaries>), built from **susfs4ksu**
  by simonpunk (GPL-3.0, <https://gitlab.com/simonpunk/susfs4ksu>). Their
  corresponding source is available from those repositories.
- The `tune` and `close` WebUI icons in `webui/src/core/icons.ts` (bundled
  into `module/webroot/js/app.js`) use path geometry from **Material Icons**
  by Google (Apache License 2.0,
  <https://github.com/google/material-design-icons>); see
  `module/LICENSE.material-icons`.
