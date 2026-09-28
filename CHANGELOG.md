# Changelog

## [v1.2.0] - 2026-09-28

### ⚡ WebUI performance

The manager's `ksu.exec` holds the WebUI's main thread while it opens a fresh root shell for each command, so every shell read froze the page. Opening the WebUI took 21 of them, and every switch back to Home took 19.

* **One read on open.** Everything the four pages show, plus the night-mode check for the "System" theme, is now read through a single root shell. It used to take 21.
* **Instant tab switches.** Pages keep what they show instead of re-reading on every visit. The refresh button in the top bar re-reads the page you're on, and its icon spins while it does.
* **Stat cards** open their list straight away, from the same read the card numbers came from.
* **Paint first.** Switches, pickers, path editors and the refresh button update on screen before their shell call runs.
* **Binary update check** (on open and "Check now") now runs in the background through the manager's `spawn`, so the WebUI stays usable while it waits on the network. Managers without `spawn` use the previous blocking call.
* **Faster loading:** the WebUI's scripts load together instead of one wave of imports at a time, and the language files load in parallel.
* **Material You:** opening the WebUI no longer waits up to 1.2 s for a palette on managers that don't serve one.

### 🐛 Fixes

* **Settings could lose changes.** Toggling several settings in quick succession could write only the last one to `config.sh`, even though every switch showed as changed. Saves now happen one after another.

## [v1.1.2] - 2026-09-28

### 🐛 Fixes

* **WebUI double padding with fullscreen off.** On KernelSU, SukiSU-Ultra and ReSukiSU, the WebUI opened with an extra gap above the top bar and below the navigation bar. It only went away after toggling fullscreen on and off. These managers turn edge-to-edge off whenever fullscreen is turned off, so the manager and the WebUI both padded for the system bars. The WebUI now turns edge-to-edge back on and handles the bars itself, as it already did on KernelSU-Next.

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