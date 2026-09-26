#!/system/bin/sh

MODDIR=${0%/*}
exec "$MODDIR/bin/nyxsusfs" stage post-fs-data

mkdir -p /data/adb/ksu/nyxsusfs/logs
echo "nyxsusfs/post-fs-data: [error] bin/nyxsusfs failed to exec" >> /data/adb/ksu/nyxsusfs/logs/susfs1.log
