#!/bin/sh

if [ -d /data/adb/modules/susfs4ksu ]; then
    echo "nyxsusfs/uninstall: ksu_module_susfs is installed, leaving the shared susfs binaries in place"
else
    rm -f /data/adb/ksu/bin/ksu_susfs
    rm -f /data/adb/ksu/bin/sus_su
    rm -f /data/adb/ksu/bin/sus_su_drv_path
fi

rm -rf /data/adb/ksu/nyxsusfs
