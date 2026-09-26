#!/bin/sh
PATH=/data/adb/ksu/bin:/data/data/com.termux/files/usr/bin:$PATH
KSU_BIN=/data/adb/ksu/bin/ksud
DEST_BIN_DIR=/data/adb/ksu/bin

PERSISTENT_DIR=/data/adb/nyxsusfs
LEGACY_PERSISTENT_DIR=/data/adb/susfs4ksu

ui_print " "
ui_print "  NyxSUSFS"
ui_print "  config-compatible with ksu_module_susfs"
ui_print " "

if [ -z "$KSU" ]; then
    abort '[!] NyxSUSFS is for KernelSU / KernelSU-Next only.'
fi

nyx_abi=${ARCH:-$(getprop ro.product.cpu.abi 2> /dev/null)}
case "$nyx_abi" in
    arm64 | arm64-v8a) ;;
    *) abort "[!] NyxSUSFS needs an arm64 device (this one is '${nyx_abi:-unknown}'): ksu_susfs is only built for arm64." ;;
esac

if [ ! -d ${DEST_BIN_DIR} ]; then
    ui_print "'${DEST_BIN_DIR}' does not exist, installation aborted."
    rm -rf ${MODPATH}
    exit 1
fi

if [ -f ${MODPATH}/verify.sh ]; then
    . ${MODPATH}/verify.sh
    if nyx_verify "${MODPATH}"; then
        ui_print "  [+] Integrity check passed"
    else
        ui_print " "
        ui_print "  [!] Integrity check FAILED - the module is corrupted or has"
        ui_print "      been tampered with. Aborting installation."
        rm -rf ${MODPATH}
        exit 1
    fi
fi

unzip -qq ${ZIPFILE} -d ${TMPDIR}/nyxsusfs

nyxsusfs_config_check() {
    ui_print " "
    ui_print "****************************************"
    ui_print "   An existing NyxSUSFS config folder   "
    ui_print "   was found                              "
    ui_print "****************************************"
    ui_print "     Do you want to reset settings?     "
    ui_print "****************************************"
    ui_print "  Volume Up (+): Reset to default"
    ui_print "  Volume Down (-): Keep current settings"
    ui_print " "
    ui_print "  Keep current settings in 10 seconds"
    ui_print "****************************************"
    local timeout=10
    local start_time
    start_time=$(date +%s)
    while true; do
        local current_time
        current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            ui_print "[-] Timeout: keeping current settings"
            break
        fi
        local key_event
        key_event=$(timeout 0.5 getevent -l 2> /dev/null)
        if echo "$key_event" | grep -q "KEY_VOLUMEUP"; then
            ui_print "[-] Resetting NyxSUSFS settings to default..."
            rm -rf ${PERSISTENT_DIR}
            break
        elif echo "$key_event" | grep -q "KEY_VOLUMEDOWN"; then
            ui_print "[-] Keeping current settings"
            break
        fi
    done
}

ksuver=${KSU_KERNEL_VER_CODE:-$(${KSU_BIN} debug version | cut -d' ' -f3)}
ui_print "[-] Detected KernelSU version: $ksuver"

nyx_bundled=${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64
nyx_bundled_commit=$(cat "${TMPDIR}/nyxsusfs/tools/ksu_susfs.commit" 2> /dev/null)
chmod +x "$nyx_bundled"
SUSFS_VERSION_RAW=$("$nyx_bundled" show version 2> /dev/null) || SUSFS_VERSION_RAW=

if [ -z "$SUSFS_VERSION_RAW" ]; then
    abort "[!] NyxSUSFS needs a kernel with SuSFS v2.1.0 or newer, and this kernel has no SuSFS."
fi
ui_print "[-] Kernel is using susfs $SUSFS_VERSION_RAW"
nyx_v=${SUSFS_VERSION_RAW#v}
nyx_major=${nyx_v%%.*}
nyx_minor=${nyx_v#*.}
nyx_minor=${nyx_minor%%.*}
case "${nyx_major}${nyx_minor}" in
    '' | *[!0-9]*) abort "[!] Could not read the susfs version '$SUSFS_VERSION_RAW'." ;;
esac
if [ "$nyx_major" -lt 2 ] || { [ "$nyx_major" -eq 2 ] && [ "$nyx_minor" -lt 1 ]; }; then
    abort "[!] NyxSUSFS needs SuSFS v2.1.0 or newer (this kernel has $SUSFS_VERSION_RAW)."
fi

NYX_BIN_UPDATE_LIB=1
. "${MODPATH}/bin-update.sh"
SUSFS_BIN=${DEST_BIN_DIR}/ksu_susfs

ui_print "[-] Checking simonpunk's susfs4ksu for a newer ksu_susfs"
if net_check "$BASE_URL" && nyx_bin_remote && [ "$NYX_REMOTE" != "$nyx_bundled_commit" ]; then
    ui_print "[-] Newer ksu_susfs published: ${NYX_MESSAGE:-$NYX_REMOTE}"
    if nyx_bin_apply; then
        ui_print "[-] Installed simonpunk's latest ksu_susfs"
    else
        ui_print "[!] ${NYX_DETAIL}"
        ui_print "[-] Installing the bundled ksu_susfs"
        nyx_bin_install "$nyx_bundled" "$nyx_bundled_commit"
    fi
else
    ui_print "[-] Installing the bundled ksu_susfs"
    nyx_bin_install "$nyx_bundled" "$nyx_bundled_commit"
fi

if [ ! -f "$SUSFS_BIN" ]; then
    abort "[!] susfs binary was not installed, aborting rather than leaving a broken module"
fi

if ! "$SUSFS_BIN" show version > /dev/null 2>&1; then
    ui_print "[!] Installed susfs binary did not run, falling back to the bundled one"
    nyx_bin_install "$nyx_bundled" "$nyx_bundled_commit"
fi

chmod 644 ${MODPATH}/post-fs-data.sh ${MODPATH}/post-mount.sh ${MODPATH}/service.sh \
    ${MODPATH}/boot-completed.sh ${MODPATH}/action.sh ${MODPATH}/uninstall.sh

chmod 644 ${MODPATH}/bin-update.sh

chmod 0755 ${MODPATH}/bin/nyxsusfs

nyx_had_existing_dir=0
[ -d ${PERSISTENT_DIR} ] && nyx_had_existing_dir=1

if [ "$nyx_had_existing_dir" = 0 ] && [ -d ${LEGACY_PERSISTENT_DIR} ]; then
    ui_print " "
    ui_print "[-] Found an existing ksu_module_susfs config at ${LEGACY_PERSISTENT_DIR}"
    ui_print "[-] Importing it into ${PERSISTENT_DIR} (one-time; the original is left untouched)"
    mkdir -p ${PERSISTENT_DIR}
    cp -f ${LEGACY_PERSISTENT_DIR}/*.txt ${PERSISTENT_DIR}/ 2> /dev/null
    cp -f ${LEGACY_PERSISTENT_DIR}/*.json ${PERSISTENT_DIR}/ 2> /dev/null
    cp -f ${LEGACY_PERSISTENT_DIR}/config.sh ${PERSISTENT_DIR}/config.sh 2> /dev/null
fi

if [ "$nyx_had_existing_dir" = 1 ]; then
    nyxsusfs_config_check
fi

ui_print "[-] Preparing NyxSUSFS persistent directory"
[ ! -d ${PERSISTENT_DIR} ] && mkdir -p ${PERSISTENT_DIR}
files="try_umount.txt sus_path.txt sus_path_loop.txt sus_maps.txt sus_open_redirect.txt legit_mounts.txt priority_uid_filter.txt sus_kstat_statically.json config.sh"
for i in $files; do
    if [ ! -f ${PERSISTENT_DIR}/$i ]; then
        cat ${MODPATH}/$i > ${PERSISTENT_DIR}/$i
    elif [ "$i" = "config.sh" ]; then
        [ -s "${PERSISTENT_DIR}/$i" ] && [ "$(tail -c1 "${PERSISTENT_DIR}/$i" | xxd -p)" != "0a" ] && echo "" >> "${PERSISTENT_DIR}/$i"
        while IFS= read -r line; do
            key=$(echo "$line" | cut -d'=' -f1)
            echo "$key" | grep -q '^#' && continue
            [ -z "$key" ] && continue
            grep -q "^${key}=" "${PERSISTENT_DIR}/$i" || echo "$line" >> "${PERSISTENT_DIR}/$i"
        done < "${MODPATH}/$i"
    fi
    rm ${MODPATH}/$i
done

rm -rf ${MODPATH}/tools
rm ${MODPATH}/customize.sh
rm -f ${MODPATH}/verify.sh

ui_print "[-] Done. Open the module's WebUI any time to check status or change settings."
# EOF
