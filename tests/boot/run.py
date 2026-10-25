#!/usr/bin/env python3
"""Boot-stage tests for bin/nyxsusfs.

Builds a fake Android root per scenario, installs the module and the given
binary into it, runs the four stage scripts in order inside a chroot with a
static busybox, and records what each stage did:

  * every call to an external tool (ksu_susfs, ksud, resetprop, dmesg, mount,
    umount, sleep, busybox chcon) - through logging stubs,
  * the files a stage writes (config, logs, stats, module.prop, disable,
    generated fake files, /mnt copies) with mode and owner.

The result is compared with tests/boot/expected/<scenario>.json. Run with
--update to rewrite those files after an intended change, and review the diff.

usage: sudo python3 tests/boot/run.py --binary PATH [--update] [scenario ...]

Needs root (chroot, mknod), chroot(8) and a statically linked busybox, and a
static host build of the binary, e.g.
  RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target x86_64-unknown-linux-gnu
"""
import argparse
import difflib
import hashlib
import json
import os
import shutil
import stat as st
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
EXPECTED = os.path.join(HERE, "expected")
STAGES = ["post-fs-data", "post-mount", "service", "boot-completed"]
WORK = None
BUSYBOX = None
CHROOT = None
MOCKED = {"dmesg", "mount", "umount", "sleep", "chcon"}

LOGLINE = r'''__nyx_log() { _l="$1"; shift; for _a in "$@"; do _l="$_l [$_a]"; done; printf '%s\n' "$_l" >> /calls.log; }'''

MOCKS = {
    "ksu_susfs": LOGLINE + r'''
__nyx_log ksu_susfs "$@"
case "$1 $2" in
"show version") [ -f /fixture/version ] && cat /fixture/version; exit 0 ;;
"show enabled_features") [ -f /fixture/features ] && cat /fixture/features; exit 0 ;;
"show variant") echo GKI; exit 0 ;;
esac
if [ -f /fixture/fail ] && grep -qxF "ksu_susfs $*" /fixture/fail; then
    echo "[-] mock failure: $*"
    exit 1
fi
exit 0
''',
    "ksud": LOGLINE + r'''
__nyx_log ksud "$@"
[ -f /fixture/fail ] && grep -qxF "ksud $*" /fixture/fail && exit 1
exit 0
''',
    "resetprop": LOGLINE + r'''
__nyx_log resetprop "$@"
[ "$1" = "-w" ] && exit 0
[ -f /fixture/props ] && grep "^$1=" /fixture/props | head -n 1 | cut -d= -f2-
exit 0
''',
    "getprop": LOGLINE + r'''
__nyx_log getprop "$@"
[ -f /fixture/props ] && grep "^$1=" /fixture/props | head -n 1 | cut -d= -f2-
exit 0
''',
    "pm": LOGLINE + r'''
__nyx_log pm "$@"
case "$1" in
path) [ -f "/fixture/pm_path_$2" ] && cat "/fixture/pm_path_$2" ;;
list) [ -f /fixture/pm_list3 ] && cat /fixture/pm_list3 ;;
esac
exit 0
''',
    "dmesg": LOGLINE + r'''
__nyx_log dmesg "$@"
n=$(cat /fixture/dmesg_count 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > /fixture/dmesg_count
[ -f /fixture/dmesg ] && cat /fixture/dmesg
i=1
while [ "$i" -le "$n" ]; do
    printf '[%5d.%06d] susfs: stage marker %d\n' $((100 + i)) "$i" "$i"
    i=$((i + 1))
done
''',
    "mount": LOGLINE + '\n__nyx_log mount "$@"\nexit 0\n',
    "umount": LOGLINE + '\n__nyx_log umount "$@"\nexit 0\n',
    "sleep": LOGLINE + '\n__nyx_log sleep "$@"\nexit 0\n',
    "chcon": LOGLINE + '\n__nyx_log chcon "$@"\nexit 0\n',
    "busybox": r'''case "$1" in
dmesg | mount | umount | sleep | chcon) _a=$1; shift; exec /data/adb/ksu/bin/$_a "$@" ;;
esac
exec /bin/busybox "$@"
''',
}

FEATURES_V2 = [
    "CONFIG_KSU_SUSFS_SUS_PATH", "CONFIG_KSU_SUSFS_SUS_MOUNT", "CONFIG_KSU_SUSFS_SUS_KSTAT",
    "CONFIG_KSU_SUSFS_SPOOF_UNAME", "CONFIG_KSU_SUSFS_ENABLE_LOG", "CONFIG_KSU_SUSFS_HIDE_KSU_SUSFS_SYMBOLS",
    "CONFIG_KSU_SUSFS_SPOOF_CMDLINE_OR_BOOTCONFIG", "CONFIG_KSU_SUSFS_OPEN_REDIRECT", "CONFIG_KSU_SUSFS_SUS_MAP",
]
FEATURES_V15 = [
    "CONFIG_KSU_SUSFS_SUS_PATH", "CONFIG_KSU_SUSFS_SUS_MOUNT", "CONFIG_KSU_SUSFS_AUTO_ADD_SUS_KSU_DEFAULT_MOUNT",
    "CONFIG_KSU_SUSFS_AUTO_ADD_SUS_BIND_MOUNT", "CONFIG_KSU_SUSFS_SUS_KSTAT", "CONFIG_KSU_SUSFS_TRY_UMOUNT",
    "CONFIG_KSU_SUSFS_AUTO_ADD_TRY_UMOUNT_FOR_BIND_MOUNT", "CONFIG_KSU_SUSFS_SPOOF_UNAME", "CONFIG_KSU_SUSFS_ENABLE_LOG",
    "CONFIG_KSU_SUSFS_HIDE_KSU_SUSFS_SYMBOLS", "CONFIG_KSU_SUSFS_SPOOF_CMDLINE_OR_BOOTCONFIG",
    "CONFIG_KSU_SUSFS_OPEN_REDIRECT", "CONFIG_KSU_SUSFS_SUS_SU", "CONFIG_KSU_SUSFS_SUS_MAP",
]

ALL_ON = {
    "hide_cusrom": "4", "hide_gapps": "1", "hide_revanced": "1", "hide_loops": "1",
    "hide_vendor_sepolicy": "1", "hide_compat_matrix": "1", "hide_injections": "1",
    "hide_custom_recovery": "1", "hide_suspicious_pty": "1", "hide_addon_d": "1",
    "hide_framework_res": "1", "hide_data_local_tmp": "1", "hide_nonstd_sdcard": "1",
    "hide_nonstd_sdcard_android": "1", "hide_lineage_strings": "1", "spoof_uname": "2",
    "spoof_cmdline": "1", "emulate_vold_app_data": "1", "auto_try_umount": "1",
    "skip_legit_mounts": "1", "force_hide_lsposed": "1", "hide_sus_mnts_for_all_or_non_su_procs": "2",
    "avc_log_spoofing": "1", "susfs_log": "1", "kernel_version": "'5.10.999-nyx'",
    "kernel_build": "'#1 SMP PREEMPT Mon Jan 1 00:00:00 UTC 2024'",
}

# name -> dict(version, features, config overrides, fixture tweaks)
SCENARIOS = {
    "default": {},
    "allon": {"config": ALL_ON},
    "allon-v15": {"version": "v1.5.12", "features": FEATURES_V15, "config": {**ALL_ON, "spoof_uname": "1", "emulate_vold_app_data": "2", "sus_su": "2"}},
    "v152": {"version": "v1.5.2", "features": FEATURES_V15[:6] + ["CONFIG_KSU_SUSFS_SUS_SU"], "config": {"sus_su": "0", "hide_cusrom": "1", "spoof_cmdline": "1", "auto_try_umount": "1", "hide_sus_mnts_for_all_or_non_su_procs": "1"}},
    "v15-susu-neg": {"version": "v1.5.5", "features": FEATURES_V15, "config": {"sus_su": "-1", "hide_cusrom": "2"}},
    "v15-susu-nofeat": {"version": "v1.5.9", "features": [f for f in FEATURES_V15 if f != "CONFIG_KSU_SUSFS_SUS_SU"], "config": {"sus_su": "2", "hide_cusrom": "3", "auto_try_umount": "1"}},
    "no-susfs": {"version": None, "features": [], "config": {"hide_cusrom": "5", "spoof_cmdline": "1", "auto_try_umount": "1", "force_hide_lsposed": "1", "hide_sus_mnts_for_all_or_non_su_procs": "1"}},
    "cusrom6-zygisk": {"config": {"hide_cusrom": "6", "skip_kernel_umount_zygisk": "1", "auto_try_umount": "1", "hide_injections": "1"}, "rezygisk": True, "meta_overlay": True},
    "zygisk-disabled": {"config": {"auto_try_umount": "1", "skip_kernel_umount_zygisk": "1"}, "rezygisk": "disable"},
    "kernel-auto-umount": {"features": FEATURES_V2 + ["CONFIG_KSU_SUSFS_AUTO_ADD_TRY_UMOUNT_FOR_BIND_MOUNT"], "config": {"auto_try_umount": "1", "hide_sus_mnts_for_all_or_non_su_procs": "1"}},
    "failures": {"config": {**ALL_ON, "hide_sus_mnts_for_all_or_non_su_procs": "1"}, "fail": [
        "ksu_susfs hide_sus_mnts_for_all_procs 1", "ksu_susfs hide_sus_mnts_for_all_procs 0",
        "ksu_susfs add_sus_path /data/local/tmp/frida-server", "ksu_susfs add_sus_map /system/framework/framework-res.apk",
        "ksud kernel umount add /data/adb/modules/modA/system/bin/tool --flags 2", "ksu_susfs add_open_redirect /system/etc/hosts /data/adb/nyxsusfs/hosts 2",
    ]},
    "bootconfig-miui": {"config": {"spoof_cmdline": "1", "hide_nonstd_sdcard": "1", "hide_sus_mnts_for_all_or_non_su_procs": "0"}, "bootconfig": True, "miui": True, "youtube_mounted": True, "mnt_vendor": True},
    "no-config": {"config": None, "lists": False},
    "odd-values": {"config": {"hide_sus_mnts_for_all_or_non_su_procs": "abc", "hide_cusrom": "'2'", "sus_su": "", "spoof_uname": "x", "emulate_vold_app_data": "2", "hide_loops": "0"}},
    "no-sdcard-wait": {"config": {"emulate_vold_app_data": "1"}, "no_android_data": True},
}

# Lists seeded into /data/adb/nyxsusfs (in addition to the module defaults).
LISTS = {
    "sus_path.txt": "# comment\n/data/adb/modules/foo\n/system/addon.d\n   /system/bin/install-recovery.sh   \n/storage/emulated/0/TWRP 2\n/data/never_there 3\n\n/data/adb/ksu\n",
    "sus_path_loop.txt": "#c\n/data/local/tmp/frida-server\n/dev/pts/7 1\n/storage/emulated/0/MyStuff",
    "sus_mount.txt": "# hide\n/debug_ramdisk\n/system/etc/hosts # inline comment drops the line\n  /data/adb/modules/modA/system  \n",
    "try_umount.txt": "/data/adb/modules/modA/system/bin/tool\n# x\n/system/etc/hosts\n",
    "sus_maps.txt": "/system/framework/framework-res.apk\n/data/adb/modules/modB/zygisk/arm64-v8a.so\n",
    "sus_open_redirect.txt": "# orig redirected stage [uid]\n/system/etc/hosts /data/adb/nyxsusfs/hosts 0\n/system/etc/hosts /data/adb/nyxsusfs/hosts2 0 5\n/vendor/etc/fstab.qcom /data/adb/nyxsusfs/fstab 1\n/missing/orig /data/adb/nyxsusfs/missing 1 3\n/system/etc/x /data/adb/nyxsusfs/x 2\n",
    "legit_mounts.txt": "/data/adb/modules/modA/system/bin/tool\n",
    "sus_kstat_statically.json": json.dumps([
        {"path": "/system/framework/services.jar", "ino": "1234", "dev": "64768", "nlink": "1", "size": "2048", "atime": "1700000000", "atime_nsec": "0", "mtime": "1700000000", "mtime_nsec": "0", "ctime": "1700000000", "ctime_nsec": "0", "blocks": "8", "blksize": "4096"},
        {"path": "/system/bin/app_process64", "ino": "77", "dev": "64768", "nlink": "1", "size": "100", "atime": "1", "atime_nsec": "2", "mtime": "3", "mtime_nsec": "4", "ctime": "5", "ctime_nsec": "6", "blocks": "7", "blksize": "4096", "ino_again": "x"},
        {"path": "", "ino": "1"},
    ], indent=2) + "\n",
}

DMESG = """[    0.000000] Booting Linux on physical CPU 0x0
[    1.234567] susfs: init
[    2.500000] ksu_susfs: something
[    3.000000] random driver line
[   12.345678] susfs: set SUS_MOUNT for /debug_ramdisk
[   13.000001] susfs_auto_add_sus_bind_mount: /system/etc/hosts
[   20.000000] SUSFS: upper-case line
"""

MOUNTINFO = """1 0 253:0 / / ro,relatime shared:1 - ext4 /dev/block/dm-0 ro
2000000001 1 0:55 / /debug_ramdisk rw,relatime shared:2 - tmpfs KSU rw
2000000002 1 0:56 /adb/modules/modA/system/bin/tool /system/bin/tool ro shared:3 - ext4 /dev/block/dm-5 ro
2000000003 1 0:57 / /data/adb/modules/modA/system rw shared:4 - overlay overlay rw
2000000004 1 0:58 / /system/etc/hosts rw shared:5 - ext4 magisk rw
45 1 0:59 / /vendor ro shared:6 - ext4 /dev/block/dm-1 ro
46 1 0:60 / /data/adb/modules/modA/system/bin/tool rw - tmpfs KSU rw
47 1 0:61 / /no/separator/line ro
"""



def write(path, content, mode=0o644, uid=0, gid=0):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    os.chmod(path, mode)
    os.chown(path, uid, gid)


def mkdir(path, mode=0o755):
    os.makedirs(path, exist_ok=True)
    os.chmod(path, mode)


def apply_config(base_text, overrides):
    lines = base_text.split("\n")
    for key, val in overrides.items():
        done = False
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={val}"
                done = True
                break
        if not done:
            if lines and lines[-1] == "":
                lines.insert(len(lines) - 1, f"{key}={val}")
            else:
                lines.append(f"{key}={val}")
    return "\n".join(lines)


def build_root(root, module_dir, binary, sc):
    assert root.startswith(WORK + "/"), root
    if os.path.exists(root):
        shutil.rmtree(root)
    # /bin: busybox + applet links, minus the stubbed ones.
    mkdir(f"{root}/bin")
    shutil.copy2(BUSYBOX, f"{root}/bin/busybox")
    applets = subprocess.run([BUSYBOX, "--list"], capture_output=True, text=True).stdout.split()
    for a in applets:
        if a in MOCKED or a == "busybox":
            continue
        os.symlink("busybox", f"{root}/bin/{a}")
    mkdir(f"{root}/dev")
    os.mknod(f"{root}/dev/null", 0o666 | st.S_IFCHR, os.makedev(1, 3))
    os.chmod(f"{root}/dev/null", 0o666)
    mkdir(f"{root}/dev/pts")
    mkdir(f"{root}/tmp", 0o1777)
    write(f"{root}/etc/passwd", "root:x:0:0:root:/:/bin/sh\nsystem:x:1000:1000::/:/bin/false\nshell:x:2000:2000::/:/bin/false\n")
    write(f"{root}/etc/group", "root:x:0:\nsystem:x:1000:\nshell:x:2000:\n")
    write(f"{root}/calls.log", "")
    # KernelSU bin dir: stubs.
    kbin = f"{root}/data/adb/ksu/bin"
    mkdir(kbin)
    for name, body in MOCKS.items():
        write(f"{kbin}/{name}", "#!/bin/sh\n" + body, 0o755)
    # Module.
    mod = f"{root}/data/adb/modules/nyxsusfs"
    # The module as installed: build outputs and the WebUI are left out, and
    # the binary under test goes to bin/nyxsusfs.
    shutil.copytree(module_dir, mod, symlinks=True,
                    ignore=shutil.ignore_patterns("*.sha256", "LICENSE", "NOTICE.md", "webroot", "bin", "tools", "customize.sh", "verify.sh"))
    mkdir(f"{mod}/bin")
    shutil.copy2(binary, f"{mod}/bin/nyxsusfs")
    # KernelSU's installer: set_perm_recursive $MODPATH 0 0 0755 0644, then
    # customize.sh makes bin/nyxsusfs executable.
    for dirpath, dirs, fnames in os.walk(mod):
        os.chmod(dirpath, 0o755)
        for f in fnames:
            os.chmod(os.path.join(dirpath, f), 0o644)
    os.chmod(f"{mod}/bin/nyxsusfs", 0o755)
    pdir = f"{root}/data/adb/nyxsusfs"
    mkdir(pdir)
    defaults = {f: open(os.path.join(module_dir, f)).read() for f in os.listdir(module_dir) if f.endswith(".txt") or f.endswith(".json")}
    if sc.get("lists", True):
        for f, text in {**defaults, **LISTS}.items():
            write(f"{pdir}/{f}", text)
    cfg = sc.get("config", {})
    if cfg is not None:
        write(f"{pdir}/config.sh", apply_config(open(os.path.join(module_dir, "config.sh")).read(), cfg))
    for f in os.listdir(mod):
        if f.endswith(".txt") or f.endswith(".json") or f == "config.sh":
            os.remove(f"{mod}/{f}")
    mkdir(f"{root}/data/adb/ksu/nyxsusfs")
    # Fixture answers.
    fx = f"{root}/fixture"
    mkdir(fx)
    version = sc.get("version", "v2.3.0")
    if version is not None:
        write(f"{fx}/version", version + "\n")
    write(f"{fx}/features", "\n".join(sc.get("features", FEATURES_V2)) + ("\n" if sc.get("features", FEATURES_V2) else ""))
    write(f"{fx}/dmesg", DMESG)
    write(f"{fx}/props", "ro.product.name=a15xnsxx\n" + ("ro.miui.ui.version.name=V14\n" if sc.get("miui") else ""))
    write(f"{fx}/pm_path_com.google.android.youtube", "package:/data/app/~~yt==/com.google.android.youtube-AA==/base.apk\npackage:/data/app/~~yt==/com.google.android.youtube-AA==/split_config.arm64_v8a.apk\n")
    write(f"{fx}/pm_path_com.google.android.apps.youtube.music", "package:/data/app/~~ym==/com.google.android.apps.youtube.music-BB==/base.apk\n")
    write(f"{fx}/pm_list3", "package:com.example.app\npackage:org.nyx.test\n")
    if sc.get("fail"):
        write(f"{fx}/fail", "\n".join(sc["fail"]) + "\n")
    # /proc
    write(f"{root}/proc/1/mountinfo", MOUNTINFO)
    write(f"{root}/proc/self/mounts", "/dev/block/dm-0 / ext4 ro 0 0\n" + ("tmpfs /data/app/~~yt==/com.google.android.youtube-AA==/base.apk tmpfs rw 0 0\n" if sc.get("youtube_mounted") else ""))
    if sc.get("bootconfig"):
        write(f"{root}/proc/cmdline", "console=ttyS0 root=/dev/dm-0\n")
        write(f"{root}/proc/bootconfig", 'androidboot.verifiedbootstate = "orange"\nandroidboot.warranty_bit = "1"\nandroidboot.hwname = "a15x"\nandroidboot.product.hardware.sku = "SM-A155F"\nandroidboot.other = "1"\n')
    else:
        write(f"{root}/proc/cmdline", "console=ttyS0 androidboot.verifiedbootstate=orange androidboot.warranty_bit=1 androidboot.hwname=a15x androidboot.product.hardware.sku=SM-A155F androidboot.keep=1\n")
    write(f"{root}/proc/version", "Linux version 5.10.209-android12-9 (build@host) #1 SMP PREEMPT\n")
    for d in ["loop0-8", "loop18-8", "loop3-8", "dm-0-8", "loopX-9"]:
        mkdir(f"{root}/proc/fs/jbd2/{d}")
    for d in ["loop0", "loop18", "loop3"]:
        mkdir(f"{root}/proc/fs/ext4/{d}")
    # /mnt
    mkdir(f"{root}/mnt")
    if sc.get("mnt_vendor"):
        mkdir(f"{root}/mnt/vendor")
    # Partitions.
    files = {
        "/system/app/LineageParts/LineageParts.apk": "apk",
        "/system/etc/permissions/org.lineageos.platform.xml": "xml",
        "/system/framework/lineage-sdk.jar": "jar",
        "/system/framework/framework-res.apk": "res",
        "/system/framework/services.jar": "svc",
        "/system/lib64/libcrdroid.so": "so",
        "/system/lib64/libplain.so": "so",
        "/system/etc/init/lineage-updater.rc": "service lineage_updater /system/bin/updater\n",
        "/system/etc/init/plain.rc": "service plain /system/bin/plain\n",
        "/system/etc/init/upper.rc": "# LineageOS bits\n",
        "/system/addon.d/50-lineage.sh": "#!/sbin/sh\n",
        "/system/bin/install-recovery.sh": "#!/system/bin/sh\n",
        "/system/bin/app_process64": "bin",
        "/system/etc/hosts": "127.0.0.1 localhost\n",
        "/system/etc/x": "x\n",
        "/system/etc/vintf/compatibility_matrix.device.xml": "<compatibility-matrix>\n  <hal>lineage.livedisplay</hal>\n  <hal>vendor.foo</hal>\n</compatibility-matrix>\n",
        "/system/etc/selinux/plat_sepolicy.cil": "(allow lineage_t self (file (read)))\n",
        "/system/etc/selinux/plat_file_contexts": "/system/bin/sh u:object_r:shell_exec:s0\n",
        "/system/etc/sysconfig/google-gapps.xml": "<x/>",
        "/system/app/OpenGapps/OpenGapps.apk": "apk",
        "/system/app/Gapps.XML": "uppercase",
        "/system/media/Lineage Sounds/ring.ogg": "ogg",
        "/system/media/bootanimation.zip": "zip",
        "/system/priv-app/LineageSettings/LineageSettings.apk": "apk",
        "/system/product/overlay/Pixel-framework-res.apk": "res",
        "/system/etc/ROM.EVOLUTION.txt": "upper",
        "/vendor/etc/selinux/vendor_sepolicy.cil": "(type vendor_t)\n(allow lineage_vendor self (file (read)))\n(type other_t)\n",
        "/vendor/etc/selinux/vendor_file_contexts": "/vendor/bin/x u:object_r:vendor_file:s0\n",
        "/vendor/etc/fstab.qcom": "/dev/block/by-name/system /system ext4 ro\n",
        "/vendor/bin/hw/android.hardware.lineage.livedisplay@2.0-service": "bin",
        "/vendor/lib64/libmatrixx.so": "so",
        "/vendor/etc/init/vendor.lineage.rc": "on boot\n",
        "/system_ext/etc/selinux/system_ext_sepolicy.cil": "(allow lineage_ext self (dir (search)))\n",
        "/system_ext/etc/selinux/system_ext_file_contexts": "/system_ext/x u:object_r:x:s0\n",
        "/system_ext/priv-app/EvolutionSettings/EvolutionSettings.apk": "apk",
        "/system_ext/framework/axion.odex": "odex",
        "/system_ext/framework/axion.vdex": "vdex",
        "/product/overlay/AxionOverlay.apk": "apk",
        "/product/etc/permissions/privapp-permissions-pixelos.xml": "xml",
        "/data/misc/lineage-stuff/state.txt": "x",
        "/data/misc/plain/file": "x",
        "/data/dalvik-cache/arm64/system@app@LineageParts.apk@classes.dex": "dex",
        "/data/resource-cache/lineage.overlay.idmap": "idmap",
        "/data/local/tmp/frida-server": "bin",
        "/data/local/tmp/magisk.log": "log",
        "/data/local/tmp/.hidden": "hidden",
        "/data/adb/modules/modA/system/bin/tool": "tool",
        "/data/adb/modules/modA/system/lib64/libmodA.so": "so",
        "/data/adb/modules/modA/module.prop": "id=modA\n",
        "/data/adb/modules/modB/zygisk/arm64-v8a.so": "so",
        "/data/adb/modules/modB/module.prop": "id=modB\n",
        "/data/adb/modules/modC/system/etc/with space.conf": "x",
    }
    for p, c in files.items():
        write(root + p, c)
    os.chmod(f"{root}/vendor/etc/selinux/vendor_sepolicy.cil", 0o600)
    os.chown(f"{root}/vendor/etc/selinux/vendor_sepolicy.cil", 1000, 1000)
    os.chmod(f"{root}/system/etc/init/lineage-updater.rc", 0o640)
    os.chown(f"{root}/system/etc/init/lineage-updater.rc", 0, 2000)
    os.symlink("libcrdroid.so", f"{root}/system/lib64/liblineage_link.so")
    mkdir(f"{root}/system/app/CrDroidEmptyDir")
    mkdir(f"{root}/system/app/crdroid.dir")
    mkdir(f"{root}/data/lineageos_updates")
    mkdir(f"{root}/data/system")
    mkdir(f"{root}/data/recovery")
    mkdir(f"{root}/data/local/tmp/sub dir")
    if sc.get("rezygisk"):
        mkdir(f"{root}/data/adb/modules/rezygisk")
        if sc["rezygisk"] == "disable":
            write(f"{root}/data/adb/modules/rezygisk/disable", "")
    if sc.get("meta_overlay"):
        write(f"{root}/data/adb/modules/meta-overlayfs/mnt/modX/system/bin/xtool", "x")
        mkdir(f"{root}/data/adb/modules/meta-overlayfs/mnt/modY")
    sd = f"{root}/storage/emulated/0"
    for d in ["Alarms", "DCIM", "Download", "Fox", "TWRP", "MyStuff", "Odd Folder", "MIUI", ".nomedia", "Android/media", "Android/obb", "Android/com.weird.app"]:
        mkdir(f"{sd}/{d}")
    if not sc.get("no_android_data"):
        mkdir(f"{sd}/Android/data")
    write(f"{sd}/notes.txt", "x")
    os.symlink("/storage/emulated/0", f"{root}/sdcard")
    for dirpath, dirs, fnames in os.walk(root):
        for n in fnames + dirs:
            p = os.path.join(dirpath, n)
            if not os.path.islink(p):
                os.utime(p, (1700000000, 1700000000))


STAT_SOURCES = ["/system/etc/hosts", "/vendor/etc/fstab.qcom"]


def normalizer(root):
    """Inode and ctime of stat()ed fixtures differ per root; name them."""
    subs = {}
    for p in STAT_SOURCES:
        s = os.stat(root + p)
        subs[f"[{s.st_ino}]"] = f"[INO:{p}]"
        subs[f"[{int(s.st_ctime)}]"] = "[CTIME]"
    def norm(line):
        for k, v in subs.items():
            line = line.replace(k, v)
        return line
    return norm


def procs_in(root):
    out = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            if os.readlink(f"/proc/{pid}/root") == root:
                out.append(pid)
        except OSError:
            pass
    return out


def normalize_file(rel, data):
    """File content as compared: only what the stages decide."""
    if rel.endswith(("/susfs.log", "/susfs1.log")):
        # Lines from the background hide_revanced thread interleave freely.
        return "\n".join(sorted(data.split("\n")))
    if rel.endswith("/susfs_stats.txt"):
        # try_umount= counts log lines the hide_revanced thread may not have
        # written yet when the stats are taken.
        return "\n".join("try_umount=<racy>" if l.startswith("try_umount=") else l for l in data.split("\n"))
    if rel.endswith("/module.prop"):
        # The release version changes every release; the stages don't set it.
        return "\n".join("version=<module.prop>" if l.startswith("version=") else "versionCode=<module.prop>" if l.startswith("versionCode=") else l
                         for l in data.split("\n"))
    if rel.endswith("/config.sh"):
        # Settings only; the comments are documentation.
        return "\n".join(l for l in data.split("\n") if l.strip() and not l.lstrip().startswith("#"))
    return data


def snapshot(root):
    """Everything a stage can have changed: path -> [mode, owner, content]."""
    snap = {}
    mod = "/data/adb/modules/nyxsusfs"
    watch = ["/data/adb/nyxsusfs", "/data/adb/ksu/nyxsusfs", f"{mod}/module.prop", f"{mod}/module.prop.nyxtmp", f"{mod}/disable",
             f"{mod}/sus_su_mode", f"{mod}/system", "/mnt", "/cmdline", "/bootconfig",
             "/vendor_sepolicy.cil", "/compatibility_matrix.device.xml", "/system_ext_sepolicy.cil"]
    for w in watch:
        top = root + w
        if not os.path.lexists(top):
            continue
        walk = [(top, [], [])] if not os.path.isdir(top) else os.walk(top)
        for dirpath, dirs, fnames in walk:
            if os.path.isdir(dirpath):
                entries = [os.path.join(dirpath, f) for f in fnames] + [os.path.join(dirpath, d) for d in dirs]
            else:
                entries = [dirpath]
            for p in entries:
                rel = p[len(root):]
                s = os.lstat(p)
                mode, owner = oct(s.st_mode & 0o7777), f"{s.st_uid}:{s.st_gid}"
                if st.S_ISREG(s.st_mode):
                    with open(p, "rb") as f:
                        data = f.read().decode("utf-8", "replace")
                    snap[rel] = [mode, owner, normalize_file(rel, data)]
                elif st.S_ISDIR(s.st_mode):
                    snap[rel] = [mode, owner, None]
    return snap


def run_scenario(name, module_dir, binary, sc):
    """Runs the four stages; returns one record per stage."""
    root = os.path.join(WORK, name)
    build_root(root, module_dir, binary, sc)
    norm = normalizer(root)
    pos = 0
    out = []
    prev = {}
    for stage in STAGES:
        env = {"PATH": "/bin", "HOME": "/", "KSU": "true", "NYX_NO_SLEEP": "1"}
        p = subprocess.run([CHROOT, root, "/bin/sh", f"/data/adb/modules/nyxsusfs/{stage}.sh"], env=env,
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=int(os.environ.get("STAGE_TIMEOUT", "120")))
        deadline = time.time() + 300
        while procs_in(root) and time.time() < deadline:
            time.sleep(0.05)
        with open(f"{root}/calls.log") as f:
            f.seek(pos)
            calls = f.read()
            pos = f.tell()
        files = snapshot(root)
        # Store what this stage changed, not the whole tree again.
        changed = {k: v for k, v in sorted(files.items()) if prev.get(k) != v}
        removed = sorted(k for k in prev if k not in files)
        prev = files
        out.append({
            "stage": stage,
            "exit": p.returncode,
            "calls": sorted(c for c in (norm(l) for l in calls.splitlines()) if not c.startswith(("getprop ", "pm "))),
            "changed": changed,
            "removed": removed,
        })
    shutil.rmtree(root, ignore_errors=True)
    return out


def describe(expected, actual):
    """Readable differences between two scenario records."""
    lines = []
    for e, a in zip(expected, actual):
        st_lines = []
        if e["exit"] != a["exit"]:
            st_lines.append(f"    exit code: expected {e['exit']}, got {a['exit']}")
        ce, ca = e["calls"], a["calls"]
        if ce != ca:
            for l in difflib.unified_diff(ce, ca, "expected", "actual", lineterm="", n=0):
                if l[:1] in "+-" and not l.startswith(("+++", "---")):
                    st_lines.append(f"    {l[0]} call {l[1:]}")
        for k in sorted(set(e["changed"]) | set(a["changed"])):
            x, y = e["changed"].get(k), a["changed"].get(k)
            if x == y:
                continue
            if x is None:
                st_lines.append(f"    + changes {k}")
            elif y is None:
                st_lines.append(f"    - no longer changes {k}")
            else:
                if x[:2] != y[:2]:
                    st_lines.append(f"    ~ {k}: mode/owner {x[0]} {x[1]} -> {y[0]} {y[1]}")
                if x[2] != y[2]:
                    st_lines.append(f"    ~ {k} content:")
                    d = difflib.unified_diff((x[2] or "").split("\n"), (y[2] or "").split("\n"), lineterm="", n=0)
                    st_lines.extend(f"        {l}" for l in list(d)[2:30])
        if e["removed"] != a["removed"]:
            st_lines.append(f"    removed: expected {e['removed']}, got {a['removed']}")
        if st_lines:
            lines.append(f"  [{e['stage']}]")
            lines.extend(st_lines)
    return lines


def find_tool(names, why):
    for n in names:
        path = shutil.which(n) or (n if os.path.isabs(n) and os.path.exists(n) else None)
        if path:
            return path
    sys.exit(f"run.py: {why} not found (looked for {', '.join(names)})")


def main():
    global WORK, BUSYBOX, CHROOT
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--binary", required=True, help="static host build of nyxsusfs")
    ap.add_argument("--module", default=os.path.join(REPO, "module"), help="module directory (default: the repo's module/)")
    ap.add_argument("--update", action="store_true", help="rewrite the expected files instead of comparing")
    ap.add_argument("scenarios", nargs="*", help="default: all")
    a = ap.parse_args()
    if os.geteuid() != 0:
        sys.exit("run.py: needs root (chroot, mknod) - run with sudo")
    BUSYBOX = find_tool(["busybox", "/bin/busybox", "/usr/bin/busybox"], "busybox")
    CHROOT = find_tool(["chroot", "/usr/sbin/chroot"], "chroot")
    if "statically linked" not in subprocess.run(["file", "-L", BUSYBOX], capture_output=True, text=True).stdout:
        sys.exit(f"run.py: {BUSYBOX} must be statically linked (Debian/Ubuntu: busybox-static)")
    names = a.scenarios or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit(f"run.py: unknown scenario(s): {', '.join(unknown)}")
    binary = os.path.abspath(a.binary)
    failed = 0
    with tempfile.TemporaryDirectory(prefix="nyxsusfs-boot-") as work:
        WORK = os.path.realpath(work)
        for n in names:
            t0 = time.time()
            actual = run_scenario(n, os.path.abspath(a.module), binary, SCENARIOS[n])
            path = os.path.join(EXPECTED, f"{n}.json")
            ncalls = sum(len(s["calls"]) for s in actual)
            if a.update:
                os.makedirs(EXPECTED, exist_ok=True)
                with open(path, "w") as f:
                    json.dump({"scenario": n, "stages": actual}, f, indent=1, ensure_ascii=False)
                    f.write("\n")
                print(f"WROTE {n:<20} ({ncalls} calls, {time.time() - t0:.1f}s)")
                continue
            if not os.path.exists(path):
                failed += 1
                print(f"FAIL  {n:<20} no expected file {os.path.relpath(path, REPO)} (run with --update)")
                continue
            with open(path) as f:
                expected = json.load(f)["stages"]
            diff = describe(expected, actual)
            if diff:
                failed += 1
                print(f"FAIL  {n:<20} ({ncalls} calls)")
                for l in diff[:120]:
                    print(l)
            else:
                print(f"PASS  {n:<20} ({ncalls} calls, {time.time() - t0:.1f}s)")
    if not a.update:
        print(f"== {len(names) - failed}/{len(names)} scenarios match tests/boot/expected/")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
