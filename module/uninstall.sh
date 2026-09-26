#!/bin/sh

if [ -d /data/adb/modules/susfs4ksu ]; then
    echo "nyxsusfs/uninstall: ksu_module_susfs is installed, leaving the shared susfs binary in place"
else
    rm -f /data/adb/ksu/bin/ksu_susfs
fi

rm -rf /data/adb/ksu/nyxsusfs
