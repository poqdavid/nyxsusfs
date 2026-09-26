#!/system/bin/sh
# NyxSUSFS - susfs userspace binary update.

SUSFS_BIN=${SUSFS_BIN:-/data/adb/ksu/bin/ksu_susfs}
KSU_BIN_DIR=${KSU_BIN_DIR:-/data/adb/ksu/bin}
NYX_TMPDIR=${NYX_TMPDIR:-/data/adb/ksu/nyxsusfs}
BASE_URL="https://raw.githubusercontent.com/sidex15/susfs4ksu-binaries/universal-binary/ksu_susfs_arm64"
API_URL="https://api.github.com/repos/sidex15/susfs4ksu-binaries/commits?sha=universal-binary&path=main.c&page=1&per_page=1"

download() { busybox wget -T 10 --no-check-certificate -qO - "$1"; }
if command -v curl > /dev/null 2>&1; then
    download() { curl --connect-timeout 10 -Ls "$1"; }
fi

net_check() {
    if command -v curl > /dev/null 2>&1; then
        curl -s --max-time 5 --head "$1" > /dev/null 2>&1
    else
        busybox wget --no-check-certificate --timeout=5 --spider -q "$1" > /dev/null 2>&1
    fi
}

nyx_bin_local_hash() {
    [ -f "$SUSFS_BIN" ] || return 1
    sha256sum "$SUSFS_BIN" 2> /dev/null | awk '{print $1}'
}

nyx_bin_remote_hash() {
    download "$BASE_URL" 2> /dev/null | sha256sum 2> /dev/null | awk '{print $1}'
}

nyx_bin_commit_msg() {
    download "$API_URL" 2> /dev/null \
        | grep '"message":' \
        | head -n 1 \
        | sed 's/.*"message": "\(.*\)".*/\1/; s/\\n/ /g; s/\\r/ /g' \
        | tr -d '\n\r' \
        | cut -c1-200
}

nyx_bin_check() {
    NYX_STATUS=error
    NYX_LOCAL=
    NYX_REMOTE=
    NYX_DETAIL=

    if ! net_check "$BASE_URL"; then
        NYX_STATUS=offline
        NYX_DETAIL="No connection to the binary host"
        return 1
    fi

    NYX_REMOTE=$(nyx_bin_remote_hash)
    if [ -z "$NYX_REMOTE" ]; then
        NYX_STATUS=error
        NYX_DETAIL="Host reachable but the published binary could not be fetched"
        return 1
    fi

    if [ ! -f "$SUSFS_BIN" ]; then
        NYX_STATUS=missing
        NYX_DETAIL="No susfs binary installed at $SUSFS_BIN"
        return 0
    fi

    NYX_LOCAL=$(nyx_bin_local_hash)
    if [ -z "$NYX_LOCAL" ]; then
        NYX_STATUS=error
        NYX_DETAIL="Could not hash the installed binary"
        return 1
    fi

    if [ "$NYX_LOCAL" = "$NYX_REMOTE" ]; then
        NYX_STATUS=uptodate
        NYX_DETAIL="Installed binary matches the published one"
    else
        NYX_STATUS=differs
        NYX_DETAIL="Installed binary differs from the published one"
    fi
    return 0
}

nyx_bin_apply() {
    NYX_STATUS=failed
    NYX_DETAIL=

    mkdir -p "$NYX_TMPDIR" 2> /dev/null
    _tmp="${NYX_TMPDIR}/ksu_susfs_remote"

    if ! download "$BASE_URL" > "$_tmp" 2> /dev/null || [ ! -s "$_tmp" ]; then
        rm -f "$_tmp"
        NYX_DETAIL="Download failed or returned an empty file, keeping the current binary"
        return 1
    fi

    chmod 755 "$_tmp"
    if ! "$_tmp" > /dev/null 2>&1; then
        rm -f "$_tmp"
        NYX_DETAIL="Downloaded binary did not run, keeping the current one"
        return 1
    fi

    if ! cp -f "$_tmp" "${KSU_BIN_DIR}/ksu_susfs" 2> /dev/null; then
        rm -f "$_tmp"
        NYX_DETAIL="Could not write ${KSU_BIN_DIR}/ksu_susfs"
        return 1
    fi
    chmod 755 "${KSU_BIN_DIR}/ksu_susfs"
    rm -f "$_tmp"

    NYX_STATUS=installed
    NYX_DETAIL="Installed. Reboot for the boot scripts to use it."
    return 0
}

nyx_bin_emit() {
    echo "status=${NYX_STATUS}"
    echo "local=${NYX_LOCAL}"
    echo "remote=${NYX_REMOTE}"
    echo "detail=${NYX_DETAIL}"
    echo "message=${NYX_MESSAGE}"
}

nyx_bin_main() {
    NYX_MESSAGE=
    case "$1" in
        check)
            nyx_bin_check
            case "$NYX_STATUS" in
                differs | missing) NYX_MESSAGE=$(nyx_bin_commit_msg) ;;
            esac
            ;;
        apply)
            nyx_bin_apply
            ;;
        *)
            NYX_STATUS=error
            NYX_DETAIL="usage: bin-update.sh check|apply"
            nyx_bin_emit
            return 2
            ;;
    esac

    nyx_bin_emit
    return 0
}

[ "${NYX_BIN_UPDATE_LIB:-0}" = "1" ] || nyx_bin_main "$@"
