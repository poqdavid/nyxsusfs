#!/system/bin/sh
# Manager "Action" button: check the susfs userspace binary and offer to
# update it. All the network, hash and install logic lives in
# bin-update.sh, which the WebUI runs too.

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

echo "[-] Checking susfs binary cloud connection"
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

susfs_binary_msg=$(nyx_bin_commit_msg)
if [ -n "$susfs_binary_msg" ]; then
    printf '[-] Latest susfs binary message:\n\n%s\n\n' "$susfs_binary_msg"
else
    echo "[-] Could not fetch the latest binary's commit message (continuing)"
fi

echo "[-] Downloading susfs binary from the internet"
if nyx_bin_apply; then
    echo "[-] Update complete"
    echo "[!] Reboot for the new binary to be used by the boot scripts"
    exit 0
else
    echo "[!] ${NYX_DETAIL}"
    exit 1
fi
