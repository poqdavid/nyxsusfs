#!/system/bin/sh

MODDIR=${0%/*}
exec "$MODDIR/bin/nyxsusfs" stage boot-completed

mkdir -p /data/adb/ksu/nyxsusfs/logs
echo "nyxsusfs/boot-completed: [error] bin/nyxsusfs failed to exec" >> /data/adb/ksu/nyxsusfs/logs/susfs1.log
