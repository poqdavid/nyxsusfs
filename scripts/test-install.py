#!/usr/bin/env python3
"""Installer and binary-update checks.

customize.sh runs with KernelSU's ui_print/abort stubbed, and every /data path
in it moved under a temporary directory, so the test never reads or writes the
machine's own /data. InstallChecks stops at the first real install step (the
missing KernelSU bin directory) to check the refusals; FullInstall runs the
whole installer on a fake device with stub ksu_susfs binaries and a stub curl
standing in for simonpunk's GitLab; BinaryUpdate drives bin-update.sh the way
the WebUI and the Action button do.
"""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PASSED_CHECKS = "does not exist, installation aborted."
CMDS = re.search(r'^NYX_SUSFS_CMDS="([^"]+)"', (ROOT / "module/bin-update.sh").read_text(), re.M).group(1).split()
BUNDLED_COMMIT = "a" * 40
REMOTE_COMMIT = "b" * 40
NOT_SUPPORTED = "[-] CMD: '0x555e1', SUSFS operation not supported, please enable it in kernel"
SHIM = 'ui_print() { printf "%s\\n" "$*"; }; abort() { printf "%s\\n" "$*"; exit 1; }; . "$0"'


def install(arch=None, abi=None, ksu=True):
    with tempfile.TemporaryDirectory(prefix="nyx-install-") as tmp:
        tmp = Path(tmp)
        script = (ROOT / "module/customize.sh").read_text()
        script = script.replace("/data/adb/", f"{tmp}/data/adb/").replace("/data/data/", f"{tmp}/data/data/")
        (tmp / "customize.sh").write_text(script)
        (tmp / "modpath").mkdir()
        (tmp / "bin").mkdir()
        if abi is not None:
            getprop = tmp / "bin/getprop"
            getprop.write_text(f'#!/bin/sh\n[ "$1" = ro.product.cpu.abi ] && echo {abi}\n')
            getprop.chmod(0o755)
        env = {"PATH": f"{tmp}/bin:/usr/bin:/bin", "MODPATH": str(tmp / "modpath"), "TMPDIR": str(tmp)}
        if ksu:
            env["KSU"] = "true"
        if arch is not None:
            env["ARCH"] = arch
        run = subprocess.run(["sh", "-c", SHIM, str(tmp / "customize.sh")], env=env, capture_output=True, text=True, timeout=30)
        return run.returncode, run.stdout + run.stderr


def stub_susfs(name, version=None, cmds=CMDS, version_works=True):
    """A stand-in for a ksu_susfs build: `show version` answers like the real
    tool (the version, or the kernel's refusal), and running it without
    arguments prints the help and exits 234."""
    help_lines = "".join(f"    {c} <args>\\n" for c in cmds)
    if version is None or not version_works:
        show = f'echo "{NOT_SUPPORTED}"; exit 126'
    else:
        show = f"echo {version}; exit 0"
    return (
        "#!/bin/sh\n"
        f"# {name}\n"
        f'[ "$1 $2" = "show version" ] && {{ {show}; }}\n'
        f'[ -z "$1" ] && {{ printf "usage: ksu_susfs <CMD>\\n{help_lines}"; exit 234; }}\n'
        "exit 0\n"
    )


CURL = r'''#!/bin/sh
for a; do url=$a; done
echo "$*" >> "$NYX_FIX/curl.log"
[ "$(cat "$NYX_FIX/net")" = online ] || exit 7
case "$*" in *--head*) exit 0 ;; esac
case "$url" in
*/repository/commits*) printf '[{"id":"%s","short_id":"bbbbbbb","title":"ksu_susfs: \\"quoted\\" fix","message":"x"}]' "$(cat "$NYX_FIX/remote_commit")" ;;
*/-/raw/*) [ -f "$NYX_FIX/remote_fail" ] && exit 22; cat "$NYX_FIX/remote_bin" ;;
*) exit 22 ;;
esac
'''


class Device:
    """A fake phone for one installer run: /data under a temp dir, the
    module files in MODPATH, a zip carrying tools/, and stubs on PATH."""

    def __init__(self, tmp, version="v2.3.0", net="offline", remote=None, remote_commit=REMOTE_COMMIT, remote_fail=False):
        self.tmp = tmp = Path(tmp)
        self.fix = tmp / "fix"
        self.fix.mkdir()
        (self.fix / "net").write_text(net)
        (self.fix / "remote_commit").write_text(remote_commit)
        (self.fix / "curl.log").write_text("")
        if remote is not None:
            (self.fix / "remote_bin").write_text(remote)
        if remote_fail:
            (self.fix / "remote_fail").write_text("")
        self.bin_dir = tmp / "data/adb/ksu/bin"
        self.bin_dir.mkdir(parents=True)
        self.state = tmp / "data/adb/ksu/nyxsusfs"
        self.pdir = tmp / "data/adb/nyxsusfs"
        mod = tmp / "modpath"
        shutil.copytree(ROOT / "module", mod, ignore=shutil.ignore_patterns("webroot", "tools", "verify.sh", "*.sha256"))
        (mod / "bin").mkdir(exist_ok=True)
        (mod / "bin/nyxsusfs").write_text("")
        with zipfile.ZipFile(tmp / "module.zip", "w") as z:
            z.writestr("tools/ksu_susfs_arm64", stub_susfs("bundled", version))
            z.writestr("tools/ksu_susfs.commit", BUNDLED_COMMIT + "\n")
        (tmp / "bin").mkdir()
        (tmp / "bin/curl").write_text(CURL)
        (tmp / "bin/curl").chmod(0o755)
        moved = lambda text: text.replace("/data/adb/", f"{tmp}/data/adb/").replace("/data/data/", f"{tmp}/data/data/")
        script = moved((ROOT / "module/customize.sh").read_text())
        (tmp / "customize.sh").write_text(script)
        (mod / "customize.sh").write_text(script)
        (mod / "bin-update.sh").write_text(moved((ROOT / "module/bin-update.sh").read_text()))
        self.env = {
            "PATH": f"{tmp}/bin:/usr/bin:/bin", "MODPATH": str(mod), "TMPDIR": str(tmp), "ZIPFILE": str(tmp / "module.zip"),
            "KSU": "true", "ARCH": "arm64", "KSU_KERNEL_VER_CODE": "12345", "NYX_FIX": str(self.fix),
        }

    def install(self):
        run = subprocess.run(["sh", "-c", SHIM, str(self.tmp / "customize.sh")], env=self.env, capture_output=True, text=True, timeout=60)
        return run.returncode, run.stdout + run.stderr

    def bin_update(self, stage):
        run = subprocess.run(["sh", str(self.tmp / "modpath/bin-update.sh"), stage], env=self.env, capture_output=True, text=True, timeout=60)
        return dict(line.split("=", 1) for line in run.stdout.splitlines() if "=" in line)

    def installed(self):
        p = self.bin_dir / "ksu_susfs"
        return p.read_text() if p.exists() else None

    def record(self):
        p = self.state / "ksu_susfs.commit"
        return dict(line.split("=", 1) for line in p.read_text().splitlines()) if p.exists() else None

    def downloaded(self):
        return any("/-/raw/" in line and "--head" not in line for line in (self.fix / "curl.log").read_text().splitlines())


class InstallChecks(unittest.TestCase):
    def assert_passed(self, out):
        self.assertIn(PASSED_CHECKS, out)
        self.assertNotIn("needs an arm64 device", out)

    def assert_refused(self, out, shown):
        self.assertIn(f"needs an arm64 device (this one is '{shown}')", out)
        self.assertNotIn(PASSED_CHECKS, out)

    def test_arm64_passes(self):
        self.assert_passed(install(arch="arm64")[1])

    def test_other_cpus_are_refused(self):
        for arch in ["arm", "x86", "x64", "riscv64"]:
            with self.subTest(arch=arch):
                code, out = install(arch=arch)
                self.assertNotEqual(code, 0)
                self.assert_refused(out, arch)

    def test_getprop_is_the_fallback(self):
        self.assert_passed(install(abi="arm64-v8a")[1])
        for abi in ["armeabi-v7a", "x86_64", "x86"]:
            with self.subTest(abi=abi):
                self.assert_refused(install(abi=abi)[1], abi)

    def test_unknown_cpu_is_refused(self):
        self.assert_refused(install()[1], "unknown")

    def test_needs_kernelsu(self):
        code, out = install(arch="arm64", ksu=False)
        self.assertNotEqual(code, 0)
        self.assertIn("for KernelSU / KernelSU-Next only", out)
        self.assertNotIn(PASSED_CHECKS, out)


class FullInstall(unittest.TestCase):
    def device(self, **kw):
        tmp = tempfile.TemporaryDirectory(prefix="nyx-full-")
        self.addCleanup(tmp.cleanup)
        return Device(tmp.name, **kw)

    def assert_installed(self, d, code, out, which, commit):
        self.assertEqual(code, 0, out)
        self.assertIn("[-] Done.", out)
        self.assertIn(f"# {which}\n", d.installed())
        self.assertEqual(d.record()["commit"], commit)
        self.assertEqual(sorted(p.name for p in d.bin_dir.iterdir()), ["ksu_susfs"])
        self.assertTrue((d.pdir / "config.sh").is_file())

    def test_old_susfs_is_refused(self):
        for version in ["v2.0.0", "v1.5.12", "v1.5.2"]:
            with self.subTest(version=version):
                d = self.device(version=version)
                code, out = d.install()
                self.assertNotEqual(code, 0)
                self.assertIn(f"needs SuSFS v2.1.0 or newer (this kernel has {version})", out)
                self.assertIsNone(d.installed())

    def test_no_susfs_is_refused(self):
        d = self.device(version=None)
        code, out = d.install()
        self.assertNotEqual(code, 0)
        self.assertIn("this kernel has no SuSFS", out)
        self.assertNotIn(NOT_SUPPORTED, out)
        self.assertIsNone(d.installed())

    def test_unreadable_version_is_refused(self):
        d = self.device(version="vX.Y")
        code, out = d.install()
        self.assertNotEqual(code, 0)
        self.assertIn("Could not read the susfs version 'vX.Y'", out)

    def test_v21_offline_installs_the_bundled_binary(self):
        d = self.device(version="v2.1.0")
        code, out = d.install()
        self.assert_installed(d, code, out, "bundled", BUNDLED_COMMIT)
        self.assertFalse(d.downloaded())

    def test_online_and_current_keeps_the_bundled_binary(self):
        d = self.device(net="online", remote_commit=BUNDLED_COMMIT, remote=stub_susfs("remote", "v2.3.0"))
        code, out = d.install()
        self.assert_installed(d, code, out, "bundled", BUNDLED_COMMIT)
        self.assertFalse(d.downloaded())

    def test_newer_upstream_binary_is_installed(self):
        d = self.device(net="online", remote=stub_susfs("remote", "v2.3.0"))
        code, out = d.install()
        self.assert_installed(d, code, out, "remote", REMOTE_COMMIT)
        self.assertIn('Newer ksu_susfs published: ksu_susfs: "quoted" fix', out)

    def test_upstream_binary_missing_a_command_is_refused(self):
        d = self.device(net="online", remote=stub_susfs("remote", "v2.3.0", cmds=[c for c in CMDS if c != "add_sus_map"]))
        code, out = d.install()
        self.assert_installed(d, code, out, "bundled", BUNDLED_COMMIT)
        self.assertIn("lacks commands NyxSUSFS uses", out)

    def test_failed_download_falls_back(self):
        d = self.device(net="online", remote_fail=True)
        code, out = d.install()
        self.assert_installed(d, code, out, "bundled", BUNDLED_COMMIT)
        self.assertIn("Download failed", out)

    def test_upstream_binary_that_cannot_reach_susfs_falls_back(self):
        d = self.device(net="online", remote=stub_susfs("remote", "v2.3.0", version_works=False))
        code, out = d.install()
        self.assert_installed(d, code, out, "bundled", BUNDLED_COMMIT)
        self.assertIn("falling back to the bundled one", out)


class BinaryUpdate(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="nyx-binupd-")
        self.addCleanup(tmp.cleanup)
        self.d = Device(tmp.name, net="online", remote_commit=BUNDLED_COMMIT, remote=stub_susfs("remote", "v2.3.0"))
        code, out = self.d.install()
        self.assertEqual(code, 0, out)

    def test_up_to_date(self):
        r = self.d.bin_update("check")
        self.assertEqual(r["status"], "uptodate", r)
        self.assertEqual((r["local"], r["remote"]), (BUNDLED_COMMIT, BUNDLED_COMMIT))

    def test_newer_upstream_then_apply(self):
        (self.d.fix / "remote_commit").write_text(REMOTE_COMMIT)
        r = self.d.bin_update("check")
        self.assertEqual((r["status"], r["detail"]), ("differs", "simonpunk published a newer ksu_susfs"), r)
        self.assertEqual(r["message"], 'ksu_susfs: "quoted" fix')
        r = self.d.bin_update("apply")
        self.assertEqual(r["status"], "installed", r)
        self.assertIn("# remote\n", self.d.installed())
        self.assertEqual(self.d.bin_update("check")["status"], "uptodate")

    def test_binary_replaced_by_another_module(self):
        (self.d.bin_dir / "ksu_susfs").write_text(stub_susfs("someone else's", "v2.3.0"))
        r = self.d.bin_update("check")
        self.assertEqual((r["status"], r["detail"]), ("differs", "The installed binary was not installed by NyxSUSFS"), r)

    def test_missing_and_offline(self):
        (self.d.bin_dir / "ksu_susfs").unlink()
        self.assertEqual(self.d.bin_update("check")["status"], "missing")
        (self.d.fix / "net").write_text("offline")
        self.assertEqual(self.d.bin_update("check")["status"], "offline")

    def test_apply_refuses_a_broken_download(self):
        (self.d.fix / "remote_bin").write_text("<html>not a binary</html>")
        r = self.d.bin_update("apply")
        self.assertEqual(r["status"], "failed", r)
        self.assertIn("# bundled\n", self.d.installed())


if __name__ == "__main__":
    unittest.main()
