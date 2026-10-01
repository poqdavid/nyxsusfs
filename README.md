# NyxSUSFS

[![KernelSU](https://img.shields.io/badge/KernelSU-Supported-green)](https://kernelsu.org/) [![KernelSU-Next](https://img.shields.io/badge/KernelSU--Next-Supported-green)](https://github.com/KernelSU-Next/KernelSU-Next) [![SUSFS](https://img.shields.io/badge/SUSFS-Integrated-orange)](https://gitlab.com/simonpunk/susfs4ksu) [![WebUI](https://img.shields.io/badge/WebUI-Material_You-blueviolet)](#-webui) [![Build](https://github.com/poqdavid/nyxsusfs/actions/workflows/build.yml/badge.svg)](https://github.com/poqdavid/nyxsusfs/actions/workflows/build.yml) [![Telegram](https://img.shields.io/badge/Join-Support_Chat-blue?logo=telegram&style=flat-square)](https://t.me/poqdavidchat) [![Telegram](https://img.shields.io/badge/Join-Build_Notification-blue?logo=telegram&style=flat-square)](https://t.me/nyxreleases)

A modern **SuSFS** companion module for **KernelSU / KernelSU-Next** with a **Material You** WebUI. Config-compatible with `ksu_module_susfs`, but with its own persistent config directory so the two never clobber each other.

---

## ✨ Features

- 🥷 **SuSFS integration**: drives the SUSFS kernel interface for sus path, sus mount, sus maps, sus kstat, open redirects and try-umount
- 🎨 **Material You WebUI**: full Material 3 design with light/dark support; the main screen surfaces four live stats — **sus path**, **sus maps**, **sus mount** and **try unmount** — that expand into detail lists
- 🧩 **Prop spoofing lives in [NyxProps](https://github.com/poqdavid/nyxprops)**: the prop presets moved to their own module in v1.1.0, so each can be installed and updated on its own
- 🔁 **Config-compatible**: reads the same configuration as `ksu_module_susfs`, so existing setups carry over
- 📂 **Separate config directory**: keeps its own persistent state under `/data/adb/nyxsusfs`, independent of `ksu_module_susfs`
- 🧰 **Bundled tooling**: ships the `ksu_susfs` / `sus_su` helpers
- 🩹 **Extended coverage**: extra targeted and bulk path hiding (injected module files, root-shell PTYs, recovery leftovers, addon.d, `/data/local/tmp` and more), reimplementing ideas from BRENE

---

## 📋 Requirements

- A kernel patched with **[SUSFS](https://gitlab.com/simonpunk/susfs4ksu)** (`susfs4ksu`)
- **[KernelSU](https://kernelsu.org/)** or **[KernelSU-Next](https://github.com/KernelSU-Next/KernelSU-Next)** installed and working

---

## 📥 Installation

1. 📦 Download the latest `nyxsusfs-*.zip` from the [**Releases**](https://github.com/poqdavid/nyxsusfs/releases) page
2. 🧩 Open your **KernelSU / KernelSU-Next** manager → **Modules** → **Install from storage**, and select the zip
3. 🔄 **Reboot**
4. ⚙️ Open the module's **WebUI** from the manager to review status and configure

> [!NOTE]
> Upgrading from **v1.0.0**? Prop spoofing moved to **[NyxProps](https://github.com/poqdavid/nyxprops)**. Install it alongside NyxSUSFS to keep your prop presets working.

---

## 🖥️ WebUI

The home screen shows four live counters — **sus path**, **sus maps**, **sus mount** and **try unmount** — each of which expands into the full list of active entries. Everything else (paths, settings, logs, about) lives in its own section, with light and dark themes following the Material You palette.

---

## 🔗 Additional Resources

- 🥷 [SUSFS (susfs4ksu)](https://gitlab.com/simonpunk/susfs4ksu)
- 🧩 [ksu_module_susfs](https://github.com/sidex15/ksu_module_susfs)
- ⚡ [Kernel Flasher](https://github.com/fatalcoder524/KernelFlasher)
- 📖 [KernelSU Installation Guide](https://kernelsu.org/guide/installation.html)

---

## 💬 Support

If you encounter any issues or need help, feel free to:

- 🐛 Open an issue in this repository
- 💬 Reach out to me directly

---

## ⚠️ Disclaimer

Flashing kernel-level modules always carries a risk of boot loops or an unbootable device. Please make sure to:

- 💾 Back up your data
- 🧠 Understand the risks before proceeding

**🚨 Proceed at your own risk!**

---

## 📱 Contacts

[![Telegram](https://img.shields.io/badge/Telegram-poqdavid-blue?logo=telegram)](https://t.me/poqdavid)

---

## 🌟 Special Thanks

**These amazing people and projects help make this project possible! ❤️**

| 🔧 **Project**          | 👨‍💻 **Developer** | 🔗 **Link**                                                              |
| ---------------------- | ----------------- | ------------------------------------------------------------------------ |
| **KernelSU**           | tiann             | [GitHub](https://github.com/tiann/KernelSU)                              |
| **KernelSU-Next**      | rifsxd            | [GitHub](https://github.com/KernelSU-Next/KernelSU-Next)                 |
| **SUSFS**              | simonpunk         | [GitLab](https://gitlab.com/simonpunk/susfs4ksu)                         |
| **ksu_module_susfs**   | sidex15           | [GitHub](https://github.com/sidex15/ksu_module_susfs)                    |
| **BRENE**              | rrr333nnn333      | [GitHub](https://github.com/rrr333nnn333/BRENE)                          |
| **ReZygisk**           | PerformanC        | [GitHub](https://github.com/PerformanC/ReZygisk)                         |
| **Magisk**             | topjohnwu         | [GitHub](https://github.com/topjohnwu/Magisk)                            |

*NyxSUSFS grew out of ksu_module_susfs, and several hiding features reimplement ideas from BRENE. See [NOTICE.md](NOTICE.md) for what comes from where.*

*If you have contributed and are not listed here, please remind me!* 🙏

---

## 📄 License

NyxSUSFS is released under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`), the same license as ksu_module_susfs, which it is derived from. [NOTICE.md](NOTICE.md) lists the projects it builds on and the licenses of the bundled binaries.

---

## 💝 Donations

Any and all donations are appreciated!

<br/>**BTC Legacy:** 1Q2JQG3iCLZPT2iJfDLow1oQVGKmxheoAh
<br/>**BTC Segwit:** bc1q8gurls0wjkfe43ygmrqmu2pzmyjetnrvgws9sr
<br/>**BCH:** qrks52smlqw7d8700d77uqvmve03d4knzvd2vghaqz
<br/>**ETH:** 0x7218779242a8425879B09969431c20F5eC1a192D
