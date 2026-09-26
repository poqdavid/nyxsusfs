# Changelog

## [v1.0.0] - 2026-10-22

The first release of NyxSUSFS, a SuSFS companion module for KernelSU and
KernelSU-Next. It's config-compatible with ksu_module_susfs and keeps its own
config under `/data/adb/nyxsusfs`, so the two never clobber each other.

### ⚙️ Boot stages

* **One native binary.** The `post-fs-data`, `post-mount`, `service` and
  `boot-completed` stages run `bin/nyxsusfs`, a static arm64 binary written
  in Rust (`src/`) with no third-party crates. The `*.sh` stage files
  KernelSU runs just exec it.
* **SuSFS through `ksu_susfs` only:** sus path, sus mount, sus maps, sus
  kstat, open redirects and try-umount, with no direct kernel calls.
* **Extended hiding:** targeted and bulk path hiding for injected module
  files, root-shell PTYs, recovery leftovers, addon.d, `/data/local/tmp`,
  non-standard sdcard folders and more, plus custom-ROM scans and
  Zygisk-aware unmounting.
* **Bundled tooling:** ships sidex15's `ksu_susfs` and `sus_su`, and can
  update `ksu_susfs` from the manager's Action button or the WebUI.

### 🎨 WebUI

* **Material You design** in TypeScript (`webui/src/`), bundled into a
  single script, with light/dark themes, Material You colours and
  fullscreen.
* **Home:** four live counters (sus path, sus maps, sus mount and try
  unmount) that open into the full lists, plus a path-hiding self-test.
* **Paths and Settings:** edit every list and option the boot stages read.
* **Logs:** this boot's *Activity* (what NyxSUSFS did at each stage) and
  *Kernel* (what SuSFS wrote to the kernel log) logs, last 1,000 lines each.

### 📦 Install

* **Integrity check:** every file is fingerprinted at build time and checked
  before the module installs.
* **arm64 only:** the installer stops on any other CPU, because `ksu_susfs`
  is only built for arm64.
* Prop spoofing is a separate module,
  [NyxProps](https://github.com/poqdavid/nyxprops).
