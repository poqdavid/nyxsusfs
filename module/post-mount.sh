#!/system/bin/sh

MODDIR=${0%/*}
exec "$MODDIR/bin/nyxsusfs" stage post-mount

mkdir -p /data/adb/ksu/nyxsusfs/logs
echo "nyxsusfs/post-mount: [error] bin/nyxsusfs failed to exec" >> /data/adb/ksu/nyxsusfs/logs/susfs1.log
