#!/usr/bin/env sh
#
# check-ksu-susfs.sh <ksu_susfs binary>
#
# Runs a ksu_susfs build under qemu (as root, like on a phone) and checks it
# is a static arm64 executable, lists every command NyxSUSFS uses (the list
# in module/bin-update.sh) and reaches SuSFS through its magic numbers.
set -eu

BIN=${1:?usage: check-ksu-susfs.sh <ksu_susfs binary>}
HERE=$(cd "$(dirname "$0")" && pwd)

fail() {
    echo "check-ksu-susfs: $*" >&2
    exit 1
}

QEMU=${QEMU:-$(command -v qemu-aarch64-static || command -v qemu-aarch64 || true)}
[ -n "$QEMU" ] || fail "needs qemu-aarch64-static or qemu-aarch64 (qemu-user-static or qemu-user)"

readelf -h "$BIN" | grep -q 'Machine:.*AArch64' || fail "$BIN is not an arm64 binary"
if readelf -lW "$BIN" | grep -q 'INTERP'; then
    fail "$BIN is dynamically linked"
fi

NYX_BIN_UPDATE_LIB=1
. "$HERE/../module/bin-update.sh"

rc=0
help=$("$QEMU" "$BIN" 2>&1) || rc=$?
[ "$rc" -eq 234 ] || fail "running it without arguments exited $rc, expected 234 (help): $help"

missing=
for cmd in $NYX_SUSFS_CMDS; do
    printf '%s\n' "$help" | grep -qE "^ +${cmd}( |\$)" || missing="$missing $cmd"
done
[ -z "$missing" ] || fail "its help lacks:$missing"
nyx_bin_help_ok "$help" || fail "bin-update.sh would refuse it"

trace=$("$QEMU" -strace "$BIN" show version 2>&1) || true
printf '%s\n' "$trace" | grep -q 'reboot(3735928559,4210752250,349665,' || fail "show version does not reach SuSFS (reboot 0xdeadbeef, 0xfafafafa, 0x555e1)"

echo "check-ksu-susfs: $BIN ok ($(wc -c < "$BIN" | tr -d ' ') bytes, $(echo "$NYX_SUSFS_CMDS" | wc -w | tr -d ' ') commands)"
