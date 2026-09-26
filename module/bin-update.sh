#!/system/bin/sh

SUSFS_BIN=${SUSFS_BIN:-/data/adb/ksu/bin/ksu_susfs}
NYX_TMPDIR=${NYX_TMPDIR:-/data/adb/ksu/nyxsusfs}
NYX_BIN_RECORD=${NYX_TMPDIR}/ksu_susfs.commit
NYX_SUSFS_BRANCH=gki-android14-6.1
NYX_SUSFS_FILE=ksu_module_susfs/tools/ksu_susfs_arm64
BASE_URL=${NYX_BIN_URL:-"https://gitlab.com/simonpunk/susfs4ksu/-/raw/${NYX_SUSFS_BRANCH}/${NYX_SUSFS_FILE}"}
API_URL=${NYX_BIN_API:-"https://gitlab.com/api/v4/projects/simonpunk%2Fsusfs4ksu/repository/commits?ref_name=${NYX_SUSFS_BRANCH}&path=${NYX_SUSFS_FILE}&per_page=1"}
NYX_SUSFS_CMDS="add_open_redirect add_sus_kstat add_sus_kstat_statically add_sus_map add_sus_path add_sus_path_loop enable_avc_log_spoofing enable_log hide_sus_mnts_for_non_su_procs set_cmdline_or_bootconfig set_priority_uid_filter set_uname show update_sus_kstat"

download() { busybox wget -T 10 --no-check-certificate -qO - "$1"; }
if command -v curl > /dev/null 2>&1; then
    download() { curl --connect-timeout 10 -fLs "$1"; }
fi

net_check() {
    if command -v curl > /dev/null 2>&1; then
        curl -s --max-time 5 --head "$1" > /dev/null 2>&1
    else
        busybox wget --no-check-certificate --timeout=5 --spider -q "$1" > /dev/null 2>&1
    fi
}

nyx_sha256() {
    sha256sum "$1" 2> /dev/null | awk '{print $1}'
}

nyx_bin_remote() {
    NYX_REMOTE=
    NYX_MESSAGE=
    _json=$(download "$API_URL" 2> /dev/null) || return 1
    NYX_REMOTE=$(printf '%s' "$_json" | grep -oE '"id": *"[0-9a-f]{40}"' | head -n 1 | cut -d'"' -f4)
    NYX_MESSAGE=$(printf '%s' "$_json" | grep -oE '"title": *"([^"\\]|\\.)*"' | head -n 1 | sed 's/^"title": *"//; s/"$//; s/\\"/"/g; s/\\\\/\\/g' | cut -c1-200)
    [ -n "$NYX_REMOTE" ]
}

nyx_bin_help_ok() {
    for _cmd in $NYX_SUSFS_CMDS; do
        printf '%s\n' "$1" | grep -qE "^ +${_cmd}( |\$)" || return 1
    done
}

nyx_bin_works() {
    nyx_bin_help_ok "$("$1" 2>&1)"
}

nyx_bin_record() {
    mkdir -p "$NYX_TMPDIR" 2> /dev/null
    {
        echo "commit=$1"
        echo "sha256=$(nyx_sha256 "$SUSFS_BIN")"
    } > "$NYX_BIN_RECORD"
}

nyx_bin_local() {
    [ -f "$NYX_BIN_RECORD" ] || return 1
    _sha=$(sed -n 's/^sha256=//p' "$NYX_BIN_RECORD")
    [ -n "$_sha" ] && [ "$_sha" = "$(nyx_sha256 "$SUSFS_BIN")" ] || return 1
    sed -n 's/^commit=//p' "$NYX_BIN_RECORD"
}

nyx_bin_install() {
    cp -f "$1" "$SUSFS_BIN" 2> /dev/null || return 1
    chmod 755 "$SUSFS_BIN"
    nyx_bin_record "$2"
}

nyx_bin_check() {
    NYX_STATUS=error
    NYX_LOCAL=
    NYX_REMOTE=
    NYX_DETAIL=
    NYX_MESSAGE=

    if ! net_check "$BASE_URL"; then
        NYX_STATUS=offline
        NYX_DETAIL="No connection to simonpunk's susfs4ksu"
        return 1
    fi

    if ! nyx_bin_remote; then
        NYX_DETAIL="Could not read the latest ksu_susfs commit"
        return 1
    fi

    if [ ! -f "$SUSFS_BIN" ]; then
        NYX_STATUS=missing
        NYX_DETAIL="No susfs binary installed at $SUSFS_BIN"
        return 0
    fi

    NYX_LOCAL=$(nyx_bin_local)
    if [ "$NYX_LOCAL" = "$NYX_REMOTE" ]; then
        NYX_STATUS=uptodate
        NYX_DETAIL="Installed binary matches simonpunk's latest ksu_susfs"
    elif [ -n "$NYX_LOCAL" ]; then
        NYX_STATUS=differs
        NYX_DETAIL="simonpunk published a newer ksu_susfs"
    else
        NYX_STATUS=differs
        NYX_DETAIL="The installed binary was not installed by NyxSUSFS"
    fi
    return 0
}

nyx_bin_apply() {
    NYX_STATUS=failed
    NYX_DETAIL=

    mkdir -p "$NYX_TMPDIR" 2> /dev/null
    _tmp="${NYX_TMPDIR}/ksu_susfs_remote"
    nyx_bin_remote

    if ! download "$BASE_URL" > "$_tmp" 2> /dev/null || [ ! -s "$_tmp" ]; then
        rm -f "$_tmp"
        NYX_DETAIL="Download failed or returned an empty file, keeping the current binary"
        return 1
    fi

    chmod 755 "$_tmp"
    if ! nyx_bin_works "$_tmp"; then
        rm -f "$_tmp"
        NYX_DETAIL="The downloaded binary did not run or lacks commands NyxSUSFS uses, keeping the current one"
        return 1
    fi

    if ! nyx_bin_install "$_tmp" "$NYX_REMOTE"; then
        rm -f "$_tmp"
        NYX_DETAIL="Could not write $SUSFS_BIN"
        return 1
    fi
    rm -f "$_tmp"

    NYX_STATUS=installed
    NYX_DETAIL="Installed. Reboot for the boot stages to use it."
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
    case "$1" in
        check)
            nyx_bin_check
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
