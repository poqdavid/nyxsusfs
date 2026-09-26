# Tests

Four suites run in CI on every push and pull request (see
`.github/workflows/build.yml`). All of them run on a Linux machine; none
needs a phone.

| Suite | What it checks | Run it |
| --- | --- | --- |
| Boot stages | The four stages of `bin/nyxsusfs` in 17 device scenarios, plus its `priority-filter` command where a scenario asks: every `ksu_susfs` / `ksud` call and every file a step writes | `sudo python3 tests/boot/run.py --binary <static host build>` |
| WebUI | Every page, setting write, path-list save, theme, fullscreen and binary check, plus bridge behaviour and system-bar padding | `npm run test:webui` |
| Installer | `customize.sh` refuses unsupported CPUs, managers and SuSFS versions, then installs the bundled or upstream `ksu_susfs`; `bin-update.sh` checks and updates it | `python3 scripts/test-install.py` |
| ksu_susfs | The build is a static arm64 binary that lists every command NyxSUSFS uses and reaches SuSFS through its magic numbers (run under qemu) | `sudo sh scripts/check-ksu-susfs.sh module/tools/ksu_susfs_arm64` |

## ksu_susfs

CI builds `module/tools/ksu_susfs_arm64` from the susfs4ksu commit pinned in
`.github/workflows/build.yml`. To build and check it locally you need zig on
`PATH` (`pip install ziglang` provides `python3 -m ziglang`) and
`qemu-user-static`:

```sh
git clone --filter=blob:none --no-checkout https://gitlab.com/simonpunk/susfs4ksu.git susfs4ksu
git -C susfs4ksu checkout --detach <KSU_SUSFS_COMMIT from build.yml>
sh scripts/build-ksu-susfs.sh susfs4ksu module/tools
sudo sh scripts/check-ksu-susfs.sh module/tools/ksu_susfs_arm64
```

## Boot stages

`tests/boot/run.py` builds a fake Android root for each scenario (SuSFS
versions and features, ReZygisk present or disabled, every `hide_*` option,
custom-ROM files, failing calls, odd config values, a late `/sdcard`, app
data dirs for the priority uid filter),
installs `module/` and the binary into it, and runs the stage scripts in a
chroot with a static busybox. External tools are logging stubs. What each
stage did is compared with `tests/boot/expected/<scenario>.json`.

It needs root (chroot and mknod), a statically linked busybox
(Debian/Ubuntu: `busybox-static`) and a static host build:

```sh
RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target x86_64-unknown-linux-gnu
sudo python3 tests/boot/run.py --binary target/x86_64-unknown-linux-gnu/release/nyxsusfs
sudo python3 tests/boot/run.py --binary ... allon failures   # just these scenarios
```

## WebUI

`tests/webui/run.cjs` loads the built `module/webroot` in Chromium with a mock
KernelSU manager whose `exec` and `spawn` behave like the real bridge and
run each command for real. The device paths the WebUI reads (`/data/adb`,
`/proc/version`, `/proc/1/mountinfo`, `/storage`) are moved into a temporary
root seeded from `module/` and `tests/webui/fixtures/`, so the run doesn't
depend on the machine and needs no root.

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:webui
NYX_SH=mksh npm run test:webui   # the commands under mksh, as on Android
```

`NYX_CHROMIUM=/path/to/chrome` uses an existing Chromium; `NYX_DEBUG=1` logs
every command; `VERBOSE=1` lists passing checks too.

## When a change is intended

Both comparison suites take `--update` to rewrite their expected files:

```sh
sudo python3 tests/boot/run.py --binary ... --update
node tests/webui/run.cjs --update
```

Review the diff of `tests/*/expected/` before committing it: it should show
exactly the behaviour the change was meant to alter.
