#!/system/bin/sh

NYX_MODDIR=${MODDIR:-${0%/*}}
[ -f "${NYX_MODDIR}/bin-update.sh" ] || NYX_MODDIR=/data/adb/modules/nyxsusfs

if [ ! -f "${NYX_MODDIR}/bin-update.sh" ]; then
    echo "[!] bin-update.sh not found, cannot check the binary"
    exit 1
fi

NYX_BIN_UPDATE_LIB=1
. "${NYX_MODDIR}/bin-update.sh"

echo "***************************************"
echo "  NyxSUSFS - userspace tool update"
echo "***************************************"

echo "[-] Checking simonpunk's susfs4ksu for a newer ksu_susfs"
nyx_bin_check

case "$NYX_STATUS" in
    offline)
        echo "[!] No internet connection"
        exit 1
        ;;
    error)
        echo "[!] ${NYX_DETAIL}"
        exit 1
        ;;
    uptodate)
        echo "[-] Already up to date"
        exit 0
        ;;
    missing)
        echo "[!] ${NYX_DETAIL}"
        ;;
    differs)
        echo "[-] ${NYX_DETAIL}"
        ;;
esac

if [ -n "$NYX_MESSAGE" ]; then
    printf '[-] Latest ksu_susfs change:\n\n%s\n\n' "$NYX_MESSAGE"
fi

echo "[-] Downloading ksu_susfs"
if nyx_bin_apply; then
    echo "[-] Update complete"
    echo "[!] Reboot for the boot stages to use the new binary"
    exit 0
else
    echo "[!] ${NYX_DETAIL}"
    exit 1
fi
