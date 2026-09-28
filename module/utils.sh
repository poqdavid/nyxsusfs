#!/bin/sh

PATH=/data/adb/ksu/bin:$PATH
kernel_version='default'
kernel_build='default'

nyx_rp_get() {
    if [ -n "$NYX_RP_BIN" ]; then
        "$NYX_RP_BIN" "$1" 2> /dev/null
    else
        resetprop "$1" 2> /dev/null
    fi
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
