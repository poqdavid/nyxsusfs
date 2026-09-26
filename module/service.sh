#!/system/bin/sh

MODDIR=${0%/*}
exec "$MODDIR/bin/nyxsusfs" stage service

mkdir -p /data/adb/ksu/nyxsusfs/logs
echo "nyxsusfs/service: [error] bin/nyxsusfs failed to exec" >> /data/adb/ksu/nyxsusfs/logs/susfs1.log
