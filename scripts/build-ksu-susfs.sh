#!/usr/bin/env sh
#
# build-ksu-susfs.sh <susfs4ksu checkout> <out-dir>
#
# Builds simonpunk's ksu_susfs as a static arm64 binary with zig, without
# changing its source, and writes <out-dir>/ksu_susfs_arm64 plus
# <out-dir>/ksu_susfs.commit (the last commit of the prebuilt binary the
# checkout carries, which bin-update.sh compares against).
set -eu

SRC=${1:?usage: build-ksu-susfs.sh <susfs4ksu checkout> <out-dir>}
OUT=${2:?usage: build-ksu-susfs.sh <susfs4ksu checkout> <out-dir>}
[ -d "$SRC/ksu_susfs/jni" ] || {
    echo "build-ksu-susfs: '$SRC/ksu_susfs/jni' not found" >&2
    exit 1
}
mkdir -p "$OUT"
SRC=$(cd "$SRC" && pwd)
OUT=$(cd "$OUT" && pwd)

# The source includes <android/log.h> without using it, and names a few
# struct stat fields the bionic way; musl only needs these shims.
mkdir -p "$OUT/shim/android"
: > "$OUT/shim/android/log.h"

cd "$SRC/ksu_susfs/jni"
zig cc -target aarch64-linux-musl -O2 -fstack-protector-strong -Wall -ffunction-sections -fdata-sections \
    -include limits.h \
    -Dst_atime_nsec=st_atim.tv_nsec -Dst_mtime_nsec=st_mtim.tv_nsec -Dst_ctime_nsec=st_ctim.tv_nsec \
    -Dst_atimensec=st_atim.tv_nsec -Dst_mtimensec=st_mtim.tv_nsec -Dst_ctimensec=st_ctim.tv_nsec \
    -I includes -I "$OUT/shim" ./*.c features/*.c \
    -static -s -Wl,--gc-sections -o "$OUT/ksu_susfs_arm64"
rm -rf "$OUT/shim"

git -C "$SRC" log -1 --format=%H HEAD -- ksu_module_susfs/tools/ksu_susfs_arm64 > "$OUT/ksu_susfs.commit"
echo "build-ksu-susfs: $OUT/ksu_susfs_arm64 from $(git -C "$SRC" rev-parse HEAD), prebuilt commit $(cat "$OUT/ksu_susfs.commit")"
