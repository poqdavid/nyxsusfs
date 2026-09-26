#!/bin/sh

PATH=/data/adb/ksu/bin:$PATH
kernel_version='default'
kernel_build='default'

nyx_prop_tool_init() {
    _pref=${1:-${prop_tool:-magisk}}
    NYX_RP_BIN=
    NYX_RP_MODE=magisk

    _rsdir=${MODDIR:-/data/adb/modules/nyxsusfs}/bin
    _rs=

    case "$_pref" in
        magisk)
            NYX_RP_MODE=magisk
            return 0
            ;;
        rs | auto)
            _abi=$(getprop ro.product.cpu.abi 2> /dev/null)
            case "$_abi" in
                arm64* | aarch64*) _rs="$_rsdir/resetprop-arm64-v8a" ;;
                armeabi* | armv*) _rs="$_rsdir/resetprop-armeabi-v7a" ;;
                x86_64*) _rs="$_rsdir/resetprop-x86_64" ;;
                x86*) _rs="$_rsdir/resetprop-x86" ;;
                *) _rs= ;;
            esac
            if [ -n "$_rs" ] && [ -x "$_rs" ] && "$_rs" -h > /dev/null 2>&1; then
                NYX_RP_BIN="$_rs"
                NYX_RP_MODE=rs
                return 0
            fi

            if [ "$_pref" = "rs" ]; then
                nyx_tag_log prop_tool_warn "prop_tool=rs but no working resetprop-rs for abi '$_abi' at $_rsdir; falling back to magisk resetprop"
            fi
            NYX_RP_MODE=magisk
            return 0
            ;;
        *)
            nyx_tag_log prop_error "unknown prop_tool '$_pref', using magisk resetprop"
            NYX_RP_MODE=magisk
            return 0
            ;;
    esac
}

nyx_rp_get() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" "$1" 2> /dev/null
    else
        resetprop "$1" 2> /dev/null
    fi
}

nyx_rp_dump() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" 2> /dev/null
    else
        resetprop 2> /dev/null
    fi
}

nyx_rp_context() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" -Z "$1" 2> /dev/null
    else
        resetprop -Z "$1" 2> /dev/null
    fi
}

nyx_rp_set() {
    _n=$1
    shift
    _v=$*
    if [ -n "$NYX_RP_BIN" ]; then
        case "$_n" in
            ro.*) "$NYX_RP_BIN" --init "$_n" "$_v" > /dev/null 2>&1 ;;
            persist.*) "$NYX_RP_BIN" --stealth "$_n" "$_v" > /dev/null 2>&1 ;;
            *) "$NYX_RP_BIN" --stealth "$_n" "$_v" > /dev/null 2>&1 ;;
        esac
    else
        resetprop -n "$_n" "$_v" > /dev/null 2>&1
    fi
}

nyx_rp_delete() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" --nuke "$1" > /dev/null 2>&1
    else
        resetprop -d "$1" > /dev/null 2>&1
    fi
}

nyx_rp_needs_rebuild() {
    [ -z "$NYX_RP_BIN" ]
}

susfs_clone_perm() {
    TO=$1
    FROM=$2
    if [ -z "${TO}" ] || [ -z "${FROM}" ]; then
        return
    fi
    CLONED_PERM_STRING=$(stat -c "%a %U %G" "${FROM}")
    set -- ${CLONED_PERM_STRING}
    chmod "$1" "${TO}"
    chown "$2":"$3" "${TO}"
    busybox chcon --reference="${FROM}" "${TO}"
}

susfs_hexpatch_props() {
    TARGET_PROP_NAME=$1
    SPOOFED_PROP_NAME=$2
    SPOOFED_PROP_VALUE=$3
    if [ -z "${TARGET_PROP_NAME}" ] || [ -z "${SPOOFED_PROP_NAME}" ] || [ -z "${SPOOFED_PROP_VALUE}" ]; then
        return 1
    fi
    if [ "${#TARGET_PROP_NAME}" != "${#SPOOFED_PROP_NAME}" ]; then
        return 1
    fi
    resetprop -n "${TARGET_PROP_NAME}" "${SPOOFED_PROP_VALUE}"
    magiskboot hexpatch "/dev/__properties__/$(resetprop -Z "${TARGET_PROP_NAME}")" \
        "$(printf '%s' "${TARGET_PROP_NAME}" | xxd -p | tr '[:lower:]' '[:upper:]')" \
        "$(printf '%s' "${SPOOFED_PROP_NAME}" | xxd -p | tr '[:lower:]' '[:upper:]')"
}

spoof_uname() {
    [ -z "$kernel_version" ] && kernel_version='default'
    [ -z "$kernel_build" ] && kernel_build='default'
    ${SUSFS_BIN} set_uname "$kernel_version" "$kernel_build"
}

nyx_mktemp() {
    if command -v mktemp > /dev/null 2>&1; then
        mktemp 2> /dev/null && return 0
    fi
    for _d in "${TMPF_DIR:-}" /data/local/tmp /data/adb; do
        [ -n "$_d" ] && [ -d "$_d" ] && [ -w "$_d" ] || continue
        _f="$_d/.nyx.$$.$(date +%s 2> /dev/null).tmp"
        : > "$_f" 2> /dev/null && {
            echo "$_f"
            return 0
        }
    done
    echo ""
}

nyx_tag_log() {
    local TAG=$1
    local TARGET=$2
    [ -n "$logfile1" ] && echo "[${TAG}]: nyxsusfs ${TARGET}" >> "$logfile1"
}

nyx_note_touched() {
    [ -n "$1" ] || return 0
    _ctx=$(nyx_rp_context "$1")
    [ -n "$_ctx" ] || return 0
    case "
${NYX_TOUCHED_CONTEXTS}" in
        *"
${_ctx}
"*) return 0 ;;
        *) NYX_TOUCHED_CONTEXTS="${NYX_TOUCHED_CONTEXTS}${_ctx}
" ;;
    esac
}

nyx_rebuild_touched_areas() {
    _strategy=${1:-area}

    case "$_strategy" in
        off)
            return 0
            ;;
        global)
            nyx_rebuild_global
            return 0
            ;;
        area)
            ;;
        *)
            nyx_tag_log prop_error "unknown hide_compact strategy '$_strategy', skipping rebuild"
            return 0
            ;;
    esac

    [ -n "$NYX_TOUCHED_CONTEXTS" ] || return 0

    set -f
    printf '%s' "$NYX_TOUCHED_CONTEXTS" | while IFS= read -r _ctx; do
        [ -n "$_ctx" ] || continue

        _rep=$(resetprop -Z 2> /dev/null | grep -F "[$_ctx]" | sed -n 's/^\[\([^]]*\)\]:.*/\1/p' | head -n 1)
        if [ -z "$_rep" ]; then
            nyx_tag_log prop_rebuild_warn "no surviving prop in $_ctx to scope a rebuild"
            continue
        fi
        _out=$(resetprop -Z "$_rep" -c 2>&1)
        case "$_out" in
            *"failed to rebuild"* | *"corrupted"*)
                nyx_tag_log prop_rebuild_warn "$_ctx: $(echo "$_out" | grep -iE 'failed to rebuild|corrupted' | head -n 1)"
                ;;
            *)
                nyx_tag_log prop_rebuild "$_ctx"
                ;;
        esac
    done
    set +f
    return 0
}

nyx_rebuild_global() {
    _out=$(resetprop -c --force 2>&1)
    case "$_out" in
        *"failed to rebuild"* | *"corrupted"*)
            nyx_tag_log prop_rebuild_warn "global rebuild hit an unparseable area (harmless for our props): $(echo "$_out" | grep -iE 'failed to rebuild|corrupted' | head -n 1)"
            ;;
    esac
    nyx_tag_log prop_rebuild "global"
}

nyx_resolve_avb_version() {
    [ -z "${avb_version:-}" ] && avb_version=auto
    if [ "$avb_version" = "auto" ]; then
        avb_version=$(nyx_rp_get ro.boot.avb_version)
        [ -z "$avb_version" ] && avb_version=$(nyx_rp_get ro.boot.vbmeta.avb_version)
        [ -z "$avb_version" ] && avb_version=1.2
    fi
}

nyx_resolve_prop_dates() {
    yyyy_mm=$(date +%Y-%m 2> /dev/null)
    case "$yyyy_mm" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]) security_patch="${yyyy_mm}-01" ;;
        *)
            yyyy_mm=''
            security_patch=''
            ;;
    esac
}

nyx_prop_exists() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" 2> /dev/null | grep -Fq "[$1]: "
    else
        resetprop 2> /dev/null | grep -Fq "[$1]: "
    fi
}

nyx_apply_prop_rule() {
    _mode=$1
    _name=$2
    shift 2
    case "$_mode" in
        contains)
            if [ $# -lt 2 ]; then
                nyx_tag_log prop_error "contains needs <prop> <needle> <value>: '$_name'"
                return 0
            fi
            _needle=$1
            shift
            _value="$*"
            case "$(nyx_rp_get "$_name")" in
                *"$_needle"*)
                    nyx_rp_set "$_name" "$_value" && {
                        nyx_tag_log prop "$_name=$_value"
                        nyx_note_touched "$_name"
                    }
                    ;;
            esac
            ;;
        clear)
            if [ -n "$(nyx_rp_get "$_name")" ]; then
                nyx_rp_set "$_name" "" && {
                    nyx_tag_log prop "$_name=(cleared)"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        delete)
            if nyx_prop_exists "$_name"; then
                nyx_note_touched "$_name"
                nyx_rp_delete "$_name" && nyx_tag_log prop "$_name=(deleted)"
            fi
            ;;
        delete_matching)
            _dm_tmp=$(nyx_mktemp)
            nyx_rp_dump | sed -n 's/^\[\([^]]*\)\]: .*/\1/p' | grep -E "$_name" | while IFS= read -r _match; do
                [ -n "$_match" ] || continue
                if [ -n "$_dm_tmp" ]; then
                    _mctx=$(nyx_rp_context "$_match")
                    [ -n "$_mctx" ] && echo "$_mctx" >> "$_dm_tmp"
                fi
                nyx_rp_delete "$_match" && nyx_tag_log prop "$_match=(deleted)"
            done
            if [ -n "$_dm_tmp" ] && [ -s "$_dm_tmp" ]; then
                while IFS= read -r _mctx; do
                    [ -n "$_mctx" ] || continue
                    case "
${NYX_TOUCHED_CONTEXTS}" in
                        *"
${_mctx}
"*) ;;
                        *) NYX_TOUCHED_CONTEXTS="${NYX_TOUCHED_CONTEXTS}${_mctx}
" ;;
                    esac
                done < "$_dm_tmp"
            fi
            [ -n "$_dm_tmp" ] && rm -f "$_dm_tmp"
            ;;
        missing)
            _value="$*"
            if [ -z "$(nyx_rp_get "$_name")" ]; then
                nyx_rp_set "$_name" "$_value" && {
                    nyx_tag_log prop "$_name=$_value"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        replace)
            if [ $# -lt 1 ]; then
                nyx_tag_log prop_error "replace needs <prop> <needle> [value]: '$_name'"
                return 0
            fi
            _needle=$1
            shift
            _repl="$*"
            if [ -z "$_needle" ]; then
                nyx_tag_log prop_error "replace with an empty needle would not terminate: '$_name'"
                return 0
            fi
            _cur=$(nyx_rp_get "$_name")

            [ -z "$_cur" ] && return 0
            case "$_cur" in
                *"$_needle"*) ;;
                *) return 0 ;;
            esac

            _rest=$_cur
            _out=''
            while :; do
                case "$_rest" in
                    *"$_needle"*) ;;
                    *) break ;;
                esac
                _out="${_out}${_rest%%"$_needle"*}${_repl}"
                _rest=${_rest#*"$_needle"}
            done
            _new="${_out}${_rest}"
            if [ "$_new" != "$_cur" ]; then
                nyx_rp_set "$_name" "$_new" && {
                    nyx_tag_log prop "$_name=$_new"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        reset)
            _value="$*"
            _cur=$(nyx_rp_get "$_name")
            if [ -n "$_cur" ] && [ "$_cur" != "$_value" ]; then
                nyx_rp_set "$_name" "$_value" && {
                    nyx_tag_log prop "$_name=$_value"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        missing_match)
            _value="$*"
            _cur=$(nyx_rp_get "$_name")
            if [ -z "$_cur" ] || [ "$_cur" != "$_value" ]; then
                nyx_rp_set "$_name" "$_value" && {
                    nyx_tag_log prop "$_name=$_value"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        same_as)
            if [ $# -lt 1 ]; then
                nyx_tag_log prop_error "same_as needs <prop> <source-prop>: '$_name'"
                return 0
            fi
            _src=$1
            _sval=$(nyx_rp_get "$_src")
            if [ -n "$_sval" ] && [ -n "$(nyx_rp_get "$_name")" ]; then
                nyx_rp_set "$_name" "$_sval" && {
                    nyx_tag_log prop "$_name=$_sval"
                    nyx_note_touched "$_name"
                }
            fi
            ;;
        *)
            nyx_tag_log prop_error "unknown mode '$_mode' for '$_name'"
            ;;
    esac
}

nyx_apply_prop_presets() {
    _dir=$1
    _want_stage=${2:-service}

    NYX_TOUCHED_CONTEXTS=
    if [ ! -d "$_dir" ]; then
        nyx_tag_log prop_error "props directory '$_dir' not found, no props applied"
        return 0
    fi

    _dev_sdk=$(nyx_rp_get ro.build.version.sdk)
    case "$_dev_sdk" in
        '' | *[!0-9]*) _dev_sdk='' ;;
    esac
    for _preset in "$_dir"/*.prop; do
        [ -f "$_preset" ] || continue
        _pfile=$(basename "$_preset")

        _stage=$(sed -n 's/^#[[:space:]]*stage:[[:space:]]*\([A-Za-z-]*\).*/\1/p' "$_preset" | head -n 1)
        [ -z "$_stage" ] && _stage=service

        [ "$_stage" = "$_want_stage" ] || continue

        _enabled=$(sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_preset" | head -n 1)

        [ -z "$_enabled" ] && _enabled=1
        if [ "$_enabled" != "1" ]; then
            nyx_tag_log prop_preset_skipped "$_pfile"
            continue
        fi

        _min_sdk=$(sed -n 's/^#[[:space:]]*min_sdk:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_preset" | head -n 1)
        _max_sdk=$(sed -n 's/^#[[:space:]]*max_sdk:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_preset" | head -n 1)
        if [ -n "$_min_sdk" ] || [ -n "$_max_sdk" ]; then
            if [ -z "$_dev_sdk" ]; then
                nyx_tag_log prop_preset_skipped "$_pfile (ro.build.version.sdk unreadable)"
                continue
            fi
            if [ -n "$_min_sdk" ] && [ "$_dev_sdk" -lt "$_min_sdk" ]; then
                nyx_tag_log prop_preset_skipped "$_pfile (sdk $_dev_sdk < min_sdk $_min_sdk)"
                continue
            fi
            if [ -n "$_max_sdk" ] && [ "$_dev_sdk" -gt "$_max_sdk" ]; then
                nyx_tag_log prop_preset_skipped "$_pfile (sdk $_dev_sdk > max_sdk $_max_sdk)"
                continue
            fi
        fi

        nyx_tag_log prop_preset "$_pfile"

        set -f
        while IFS= read -r _line || [ -n "$_line" ]; do
            case "$_line" in
                *'{vbmeta_size}'*)
                    _line=$(echo "$_line" | sed "s/{vbmeta_size}/${vbmeta_size}/g")
                    ;;
            esac
            case "$_line" in
                *'{avb_version}'*)
                    _line=$(echo "$_line" | sed "s/{avb_version}/${avb_version}/g")
                    ;;
            esac
            case "$_line" in
                *'{security_patch}'*)
                    if [ -n "$security_patch" ]; then
                        _line=$(echo "$_line" | sed "s/{security_patch}/${security_patch}/g")
                    else
                        nyx_tag_log prop_skip "unresolved {security_patch}: $_line"
                        continue
                    fi
                    ;;
            esac
            case "$_line" in
                *'{yyyy_mm}'*)
                    if [ -n "$yyyy_mm" ]; then
                        _line=$(echo "$_line" | sed "s/{yyyy_mm}/${yyyy_mm}/g")
                    else
                        nyx_tag_log prop_skip "unresolved {yyyy_mm}: $_line"
                        continue
                    fi
                    ;;
            esac

            # shellcheck disable=SC2086
            set -- $_line
            [ $# -eq 0 ] && continue
            case "$1" in '#'*) continue ;; esac
            if [ $# -lt 2 ]; then
                nyx_tag_log prop_error "malformed line in $_pfile: $_line"
                continue
            fi
            nyx_apply_prop_rule "$@"
        done < "$_preset"
        set +f
    done
    set +f
}

NYX_REPEAT_PID_FILE=${TMPF_DIR:-/data/adb/ksu/nyxsusfs}/repeat.pid

NYX_REPEAT_BOOTID_FILE=${TMPF_DIR:-/data/adb/ksu/nyxsusfs}/repeat.bootid

nyx_preset_repeat_interval() {
    _r=$(sed -n 's/^#[[:space:]]*repeat:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1)
    [ -n "$_r" ] || return 0
    case "$_r" in *[!0-9]* | '') return 0 ;; esac
    [ "$_r" -gt 0 ] 2> /dev/null || return 0
    _floor=${repeat_min_interval:-30}
    case "$_floor" in *[!0-9]* | '') _floor=30 ;; esac
    [ "$_r" -lt "$_floor" ] && _r=$_floor
    echo "$_r"
}

nyx_current_boot_id() {
    cat /proc/sys/kernel/random/boot_id 2> /dev/null
}

nyx_preset_sdk_ok() {
    _sk_min=$(sed -n 's/^#[[:space:]]*min_sdk:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1)
    _sk_max=$(sed -n 's/^#[[:space:]]*max_sdk:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1)
    [ -n "$_sk_min" ] || [ -n "$_sk_max" ] || return 0
    _sk_dev=$2
    case "$_sk_dev" in '' | *[!0-9]*) return 1 ;; esac
    [ -n "$_sk_min" ] && [ "$_sk_dev" -lt "$_sk_min" ] && return 1
    [ -n "$_sk_max" ] && [ "$_sk_dev" -gt "$_sk_max" ] && return 1
    return 0
}

nyx_apply_single_preset() {
    _preset=$1
    [ -f "$_preset" ] || return 0

    NYX_TOUCHED_CONTEXTS=
    _enabled=$(sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_preset" | head -n 1)
    [ -z "$_enabled" ] && _enabled=1
    [ "$_enabled" = "1" ] || return 0

    _asp_sdk=$(nyx_rp_get ro.build.version.sdk)
    case "$_asp_sdk" in '' | *[!0-9]*) _asp_sdk='' ;; esac
    nyx_preset_sdk_ok "$_preset" "$_asp_sdk" || return 0
    set -f
    while IFS= read -r _line || [ -n "$_line" ]; do
        case "$_line" in
            *'{vbmeta_size}'*) _line=$(echo "$_line" | sed "s/{vbmeta_size}/${vbmeta_size}/g") ;;
        esac
        case "$_line" in
            *'{avb_version}'*) _line=$(echo "$_line" | sed "s/{avb_version}/${avb_version}/g") ;;
        esac
        case "$_line" in
            *'{security_patch}'*)
                if [ -n "$security_patch" ]; then _line=$(echo "$_line" | sed "s/{security_patch}/${security_patch}/g"); else continue; fi
                ;;
        esac
        case "$_line" in
            *'{yyyy_mm}'*)
                if [ -n "$yyyy_mm" ]; then _line=$(echo "$_line" | sed "s/{yyyy_mm}/${yyyy_mm}/g"); else continue; fi
                ;;
        esac
        # shellcheck disable=SC2086
        set -- $_line
        [ $# -eq 0 ] && continue
        case "$1" in '#'*) continue ;; esac
        [ $# -lt 2 ] && continue
        nyx_apply_prop_rule "$@"
    done < "$_preset"
    set +f
}

nyx_stop_repeat_loop() {
    [ -f "$NYX_REPEAT_PID_FILE" ] || return 0
    _old=$(cat "$NYX_REPEAT_PID_FILE" 2> /dev/null)
    _old_boot=$(cat "$NYX_REPEAT_BOOTID_FILE" 2> /dev/null)
    _cur_boot=$(nyx_current_boot_id)
    case "$_old" in
        '' | *[!0-9]*) ;;
        *)
            if [ -n "$_cur_boot" ] && [ "$_old_boot" = "$_cur_boot" ] && kill -0 "$_old" 2> /dev/null; then
                kill "$_old" 2> /dev/null
            fi
            ;;
    esac
    rm -f "$NYX_REPEAT_PID_FILE" "$NYX_REPEAT_BOOTID_FILE"
}

nyx_start_repeat_loop() {
    _dir=$1
    nyx_stop_repeat_loop

    [ "${repeat_enabled:-1}" = "1" ] || return 0
    [ -d "$_dir" ] || return 0

    _dev_sdk=$(nyx_rp_get ro.build.version.sdk)
    case "$_dev_sdk" in '' | *[!0-9]*) _dev_sdk='' ;; esac

    _have=0
    _base=
    for _p in "$_dir"/*.prop; do
        [ -f "$_p" ] || continue
        _iv=$(nyx_preset_repeat_interval "$_p")
        [ -n "$_iv" ] || continue

        _en=$(sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_p" | head -n 1)
        [ -z "$_en" ] && _en=1
        [ "$_en" = "1" ] || continue

        if ! nyx_preset_sdk_ok "$_p" "$_dev_sdk"; then
            nyx_tag_log prop_repeat "$(basename "$_p") not repeating (sdk gate)"
            continue
        fi
        _have=1
        if [ -z "$_base" ] || [ "$_iv" -lt "$_base" ]; then _base=$_iv; fi
    done
    [ "$_have" = "1" ] || return 0
    [ -n "$_base" ] || return 0

    nyx_tag_log prop_repeat "starting loop (base tick ${_base}s)"

    (
        _elapsed=0
        while :; do
            sleep "$_base"
            _elapsed=$((_elapsed + _base))

            [ -f "$PERSISTENT_DIR/config.sh" ] && . "$PERSISTENT_DIR/config.sh"
            [ "${repeat_enabled:-1}" = "1" ] || {
                nyx_tag_log prop_repeat "master switch off, loop exiting"
                break
            }

            nyx_resolve_avb_version
            nyx_resolve_prop_dates
            for _p in "$_dir"/*.prop; do
                [ -f "$_p" ] || continue
                _iv=$(nyx_preset_repeat_interval "$_p")
                [ -n "$_iv" ] || continue

                nyx_preset_sdk_ok "$_p" "$_dev_sdk" || continue

                [ $((_elapsed % _iv)) -eq 0 ] || continue
                nyx_apply_single_preset "$_p" repeat
            done
        done
    ) < /dev/null > /dev/null 2>&1 &
    echo $! > "$NYX_REPEAT_PID_FILE"
    nyx_current_boot_id > "$NYX_REPEAT_BOOTID_FILE" 2> /dev/null
}

nyx_sus_map() {
    [ -n "$1" ] || return 0
    ${SUSFS_BIN} add_sus_map "$1" && echo "[sus_map]: nyxsusfs/$2 $1" >> "$logfile1"
}

nyx_sus_path_loop() {
    [ -n "$1" ] || return 0
    ${SUSFS_BIN} add_sus_path_loop "$1" && echo "[sus_path_loop]: nyxsusfs/$2 $1" >> "$logfile1"
}

nyx_hide_injections() {
    _tag=$1
    _ovl="/data/adb/modules/meta-overlayfs/mnt"
    _magic="/data/adb/modules"
    if [ -e "$_ovl" ]; then _base="$_ovl"; else _base="$_magic"; fi
    for _mod in "$_base"/*; do
        [ -d "$_mod/system" ] || continue
        find "$_mod/system" -type f 2> /dev/null | while IFS= read -r _f; do
            nyx_sus_map "$_f" "$_tag"
        done
    done
    find /data/adb/modules -name "*.so" 2> /dev/null | while IFS= read -r _f; do
        nyx_sus_map "$_f" "$_tag"
    done
}

nyx_hide_suspicious_pty() {
    _i=0
    while [ "$_i" -le 5 ]; do
        nyx_sus_path_loop "/dev/pts/$_i" "$1"
        _i=$((_i + 1))
    done
}

nyx_hide_custom_recovery() {
    for _p in \
        /storage/emulated/0/Fox \
        /storage/emulated/0/TWRP \
        /data/recovery \
        /vendor/bin/install-recovery.sh \
        /system/bin/install-recovery.sh; do
        [ -e "$_p" ] && nyx_sus_path_loop "$_p" "$1"
    done
}

nyx_hide_addon_d() {
    [ -e /system/addon.d ] || return 0
    nyx_sus_map "/system/addon.d" "$1"
    nyx_sus_path_loop "/system/addon.d" "$1"
}

nyx_hide_framework_res() {
    find /system -iname "*framework-res.apk" 2> /dev/null | while IFS= read -r _f; do
        nyx_sus_map "$_f" "$1"
    done
}

nyx_hide_data_local_tmp() {
    for _e in /data/local/tmp/*; do
        [ -e "$_e" ] || continue
        nyx_sus_path_loop "$_e" "$1"
    done
}

nyx_hide_nonstd_sdcard() {
    _std="Alarms Android Audiobooks DCIM Documents Download Movies Music Notifications Pictures Podcasts Recordings Ringtones"

    [ -n "$(nyx_rp_get ro.miui.ui.version.name)" ] && _std="$_std MIUI"
    for _e in /storage/emulated/0/*; do
        [ -e "$_e" ] || continue
        _name=${_e##*/}
        _skip=0
        for _s in $_std; do
            [ "$_name" = "$_s" ] && {
                _skip=1
                break
            }
        done
        [ "$_skip" = 1 ] && continue
        nyx_sus_path_loop "$_e" "$1"
    done
}

nyx_hide_nonstd_sdcard_android() {
    for _e in /storage/emulated/0/Android/*; do
        [ -e "$_e" ] || continue
        _name=${_e##*/}
        case "$_name" in
            data | media | obb) continue ;;
        esac
        nyx_sus_path_loop "$_e" "$1"
    done
}

nyx_hide_lineage_strings() {
    _tag=$1
    _fakedir="$PERSISTENT_DIR/fake_files"
    mkdir -p "$_fakedir"

    find /system /system_ext /vendor /product \
        \( -iname "*sepolicy.cil" -o -iname "*file_contexts" \) 2> /dev/null | while IFS= read -r _p; do
        [ -f "$_p" ] || continue
        _fn=$(basename "$_p")
        _fake="$_fakedir/$_fn"
        [ -f "$_fake" ] || : > "$_fake"
        susfs_clone_perm "$_fake" "$_p"
        ${SUSFS_BIN} add_open_redirect "$_p" "$_fake" 3 && echo "[open_redirect]: nyxsusfs/$_tag $_p -> $_fake (lineage_strings)" >> "$logfile1"
    done

    find /system /system_ext /vendor /product -iname "*.rc" 2> /dev/null | while IFS= read -r _p; do
        [ -f "$_p" ] || continue
        grep -iq "lineage" "$_p" 2> /dev/null || continue
        _fn=$(basename "$_p")
        _fake="$_fakedir/$_fn"
        [ -f "$_fake" ] || : > "$_fake"
        susfs_clone_perm "$_fake" "$_p"
        ${SUSFS_BIN} add_open_redirect "$_p" "$_fake" 3 && echo "[open_redirect]: nyxsusfs/$_tag $_p -> $_fake (lineage_strings)" >> "$logfile1"
    done
}

nyx_zygisk_handles_umount() {
    for _d in /data/adb/modules/rezygisk /data/adb/modules/zygisksu; do
        [ -d "$_d" ] || continue
        [ -f "$_d/disable" ] && continue
        [ -f "$_d/remove" ] && continue
        return 0
    done
    return 1
}
