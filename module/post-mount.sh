#!/bin/sh
MODDIR=${0%/*}
SUSFS_BIN=/data/adb/ksu/bin/ksu_susfs
. ${MODDIR}/utils.sh
PERSISTENT_DIR=/data/adb/nyxsusfs
tmpfolder=/data/adb/ksu/nyxsusfs
logfile="$tmpfolder/logs/susfs.log"
logfile1="$tmpfolder/logs/susfs1.log"

[ -w /mnt ] && mntfolder=/mnt/nyxsusfs
[ -w /mnt/vendor ] && mntfolder=/mnt/vendor/nyxsusfs

post_fs_data=0
[ -f $tmpfolder/logs/boot_stage_time.sh ] && . $tmpfolder/logs/boot_stage_time.sh

if grep -v "#" "$PERSISTENT_DIR/sus_mount.txt" > /dev/null; then
    grep -v "#" "$PERSISTENT_DIR/sus_mount.txt" | while read -r i; do
        [ -z "$i" ] || { ${SUSFS_BIN} add_sus_mount "$i" && echo "[sus_mount]: nyxsusfs/post-mount $i" >> "$logfile1"; }
    done
fi

if grep -v "#" "$PERSISTENT_DIR/try_umount.txt" > /dev/null; then
    grep -v "#" "$PERSISTENT_DIR/try_umount.txt" | while read -r i; do
        [ -z "$i" ] || { ${SUSFS_BIN} add_try_umount "$i" 1 && echo "[try_umount]: nyxsusfs/post-mount $i" >> "$logfile1"; }
    done
fi

dmesg_snapshot=$(dmesg)
echo "$dmesg_snapshot" | sed -n "/^\[ *$post_fs_data/,\$p" | grep -iE "susfs_auto_add|ksu_susfs|susfs:" >> $logfile
endmsg=$(echo "$dmesg_snapshot" | grep -E '^\[ *[0-9]' | cut -d']' -f1 | sed 's/^\[ *//' | cut -d' ' -f1 | tail -n 1)
echo "post_mount=$endmsg" >> $tmpfolder/logs/boot_stage_time.sh
