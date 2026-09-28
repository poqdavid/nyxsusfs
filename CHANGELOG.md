# Changelog

## [v1.1.1] - 2026-09-28

### ⚖️ License

* **Relicensed to AGPL-3.0-only.** NyxSUSFS grew out of ksu_module_susfs, which is AGPL-3.0, so it now carries the same license. Earlier releases were labelled GPL-3.0.
* **Notices:** added `NOTICE.md`, which credits the projects NyxSUSFS builds on and gives the licenses and source locations of the bundled binaries. `LICENSE` and `NOTICE.md` now ship inside the module zip.
* **About screen:** now shows the copyright, the license, the no-warranty notice and where to find the source. The credits no longer describe the boot scripts as written from scratch.

## [v1.1.0] - 2026-09-28

### ✂️ Split

* **Prop spoofing moved to NyxProps**, a separate module. NyxSUSFS no longer applies prop presets or ships resetprop-rs, and the WebUI's Props tab and "Property spoofing" settings are gone. Install [NyxProps](https://github.com/poqdavid/nyxprops) to keep prop spoofing.
* **Home Verification** keeps the path-hiding self-test and SELinux. The verified boot state, bootloader, dm-verity and security patch rows moved to NyxProps.
* **Config:** `prop_tool`, `repeat_enabled`, `repeat_min_interval`, `hide_compact`, `avb_version` and `vbmeta_size` are no longer used. Leftover lines in an existing config are ignored.

### 🐛 Fixes

* **README:** the install step pointed at the old repo name.

## [v1.0.0] - 2026-09-27

### 📝 Notes

Hey everyone, super excited to finally push the first official release of **nyxsusfs**! 

### 📖 Documentation

* **README:** Published `README.md` with installation prerequisites, key features, and troubleshooting steps.

### 🛠️ Dev Notes

Thank you for testing the initial build! please report any bugs/problems in the GitHub Issues tab.