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
    local start_time=$(date +%s)
    while true; do
        local current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            ui_print "[-] Timeout: keeping current settings"
            break
        fi
        local key_event=$(timeout 0.5 getevent -l 2> /dev/null)
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

download() { busybox wget -T 10 --no-check-certificate -qO - "$1"; }
if command -v curl > /dev/null 2>&1; then
    download() { curl --connect-timeout 10 -Ls "$1"; }
fi

check() {
    if command -v curl > /dev/null 2>&1; then
        curl -s --max-time 5 --head "$1" > /dev/null 2>&1
    else
        busybox wget --no-check-certificate --timeout=5 --spider -q "$1" > /dev/null 2>&1
    fi
}

# Checking KernelSU / KernelSU-Next version
ksuver=$(${KSU_BIN} debug version | cut -d' ' -f3)
ui_print "[-] Detected KernelSU version: $ksuver"
susfs_temp_bin="pre-20000"

if [ ${ksuver} -gt 19999 ] 2> /dev/null; then
    ui_print "[-] KernelSU version is using supercalls, using v2.0.0 binary for checking"
    susfs_temp_bin="20000"
fi

chmod +x "${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64"
SUSFS_VERSION_RAW="$(${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 show version)"

if [ -n "$SUSFS_VERSION_RAW" ] 2> /dev/null; then
    ui_print "[-] Kernel is using susfs $SUSFS_VERSION_RAW"
    SUSFS_DECIMAL_MAIN=$(echo "$SUSFS_VERSION_RAW" | sed 's/^v//;' | cut -d'.' -f1)
else
    ui_print "[-] Could not detect a running susfs version yet"
fi

ui_print "[-] Checking susfs binary cloud connection"
base_url="https://raw.githubusercontent.com/sidex15/susfs4ksu-binaries/universal-binary/ksu_susfs_arm64"
if check "$base_url"; then
    ui_print "[-] susfs binary cloud connection established"
    hash=$(sha256sum ${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 | awk '{print $1}')
    cloudhash=$(download "$base_url" | sha256sum | awk '{print $1}')
    if [ "$hash" = "$cloudhash" ] 2> /dev/null; then
        ui_print "[-] Bundled binary matches upstream, installing it as-is"
        cp -f ${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 ${DEST_BIN_DIR}/ksu_susfs
    else
        ui_print "[-] Downloading latest susfs binary from the internet"
        download "$base_url" > ${MODPATH}/ksu_susfs_remote
        chmod +x ${MODPATH}/ksu_susfs_remote
        if ${MODPATH}/ksu_susfs_remote > /dev/null 2>&1; then
            ui_print "[-] Downloaded susfs binary works, using it for installation"
            cp -f ${MODPATH}/ksu_susfs_remote ${DEST_BIN_DIR}/ksu_susfs
        else
            ui_print "[!] Downloaded susfs binary failed to run, using the bundled one"
            cp ${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 ${DEST_BIN_DIR}/ksu_susfs
        fi
    fi
else
    ui_print "[!] No internet connection"
    ui_print "[-] Using bundled susfs binary"
    cp ${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 ${DEST_BIN_DIR}/ksu_susfs
fi
rm -f ${MODPATH}/ksu_susfs_remote > /dev/null 2>&1

if [ ! -f ${DEST_BIN_DIR}/ksu_susfs ]; then
    abort "[!] susfs binary was not installed, aborting rather than leaving a broken module"
fi
chmod 755 ${DEST_BIN_DIR}/ksu_susfs

if ! ${DEST_BIN_DIR}/ksu_susfs show version > /dev/null 2>&1; then
    ui_print "[!] Installed susfs binary did not run, falling back to the bundled one"
    cp -f ${TMPDIR}/nyxsusfs/tools/ksu_susfs_arm64 ${DEST_BIN_DIR}/ksu_susfs
    chmod 755 ${DEST_BIN_DIR}/ksu_susfs
fi

if [ -n "$SUSFS_DECIMAL_MAIN" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 2 ]; then
    ui_print "[!] susfs v2.0.0+ detected, sus_su is deprecated"
    ui_print "[-] Skipping sus_su installation"
else
    ui_print "[-] Installing sus_su"
    cp ${TMPDIR}/nyxsusfs/tools/sus_su_arm64 ${DEST_BIN_DIR}/sus_su
    chmod 755 ${DEST_BIN_DIR}/sus_su
fi

chmod 644 ${MODPATH}/post-fs-data.sh ${MODPATH}/post-mount.sh ${MODPATH}/service.sh \
    ${MODPATH}/boot-completed.sh ${MODPATH}/action.sh ${MODPATH}/uninstall.sh

chmod 644 ${MODPATH}/bin-update.sh

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
files="sus_mount.txt try_umount.txt sus_path.txt sus_path_loop.txt sus_maps.txt sus_open_redirect.txt legit_mounts.txt sus_kstat_statically.json config.sh"
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

vbmeta_size=$((5504 + (RANDOM % 14 + 1) * 1024))
if grep -q "^vbmeta_size=" ${PERSISTENT_DIR}/config.sh; then
    sed -i "s/^vbmeta_size=.*/vbmeta_size=$vbmeta_size/" ${PERSISTENT_DIR}/config.sh
else
    echo "vbmeta_size=$vbmeta_size" >> ${PERSISTENT_DIR}/config.sh
fi

ui_print "[-] Setting up prop tool (resetprop-rs)"

RS_DIR="${MODPATH}/bin"
RS_ABI=$(getprop ro.product.cpu.abi 2> /dev/null)
case "$RS_ABI" in
    arm64* | aarch64*) RS_ASSET="resetprop-arm64-v8a" ;;
    armeabi* | armv*) RS_ASSET="resetprop-armeabi-v7a" ;;
    x86_64*) RS_ASSET="resetprop-x86_64" ;;
    x86*) RS_ASSET="resetprop-x86" ;;
    *) RS_ASSET="" ;;
esac

rs_ok=0
if [ -n "$RS_ASSET" ]; then
    RS_BIN="${RS_DIR}/${RS_ASSET}"

    for f in "${RS_DIR}"/resetprop-*; do
        [ -e "$f" ] || continue
        [ "$f" = "$RS_BIN" ] || rm -f "$f"
    done
    if [ -f "$RS_BIN" ]; then
        chmod 0755 "$RS_BIN"
        if "$RS_BIN" -h > /dev/null 2>&1; then
            ui_print "    + bundled resetprop-rs ok ($RS_ASSET)"
            rs_ok=1
        else
            ui_print "    ! bundled resetprop-rs failed smoke test, will try download"
            rm -f "$RS_BIN"
        fi
    fi
    if [ "$rs_ok" = 0 ]; then
        RS_URL="https://github.com/Enginex0/resetprop-rs/releases/latest/download/${RS_ASSET}"
        ui_print "    - downloading resetprop-rs ($RS_ASSET)..."
        if download "$RS_URL" > "$RS_BIN" 2> /dev/null && [ -s "$RS_BIN" ]; then
            chmod 0755 "$RS_BIN"
            if "$RS_BIN" -h > /dev/null 2>&1; then
                ui_print "    + downloaded resetprop-rs ok"
                rs_ok=1
            else
                ui_print "    ! downloaded binary failed smoke test"
                rm -f "$RS_BIN"
            fi
        else
            ui_print "    ! download failed"
            rm -f "$RS_BIN"
        fi
    fi
else
    ui_print "    ! no resetprop-rs build for abi '$RS_ABI'"
fi

if [ "$rs_ok" = 1 ]; then
    ui_print "    resetprop-rs is ready. Set prop_tool=auto or rs in the"
    ui_print "    WebUI to use it (stealth writes, nuke deletes)."
else
    ui_print "    Using the stock resetprop (prop_tool default)."
    rmdir "${RS_DIR}" 2> /dev/null
fi

ui_print "[-] Installing prop presets"
mkdir -p ${PERSISTENT_DIR}/props

DEFAULTS_DIR=${PERSISTENT_DIR}/props/.defaults
mkdir -p ${DEFAULTS_DIR}

preset_kept=0
for p in ${MODPATH}/props/*.prop; do
    [ -f "$p" ] || continue
    pbase=$(basename "$p")
    installed=${PERSISTENT_DIR}/props/$pbase
    shipped=${DEFAULTS_DIR}/$pbase
    if [ ! -f "$installed" ]; then
        cat "$p" > "$installed"
        cat "$p" > "$shipped"
        ui_print "    + $pbase"
    elif [ -f "$shipped" ] && cmp -s "$installed" "$shipped"; then
        if cmp -s "$installed" "$p"; then
            cat "$p" > "$shipped"
        else
            cat "$p" > "$installed"
            cat "$p" > "$shipped"
            ui_print "    ^ $pbase (updated default)"
        fi
    elif [ -f "$shipped" ]; then
        if ! cmp -s "$p" "$shipped"; then
            cat "$p" > "$shipped"
            ui_print "    = $pbase (kept your edits, default changed)"
            preset_kept=$((preset_kept + 1))
        fi
    else
        cat "$p" > "$shipped"
        if ! cmp -s "$installed" "$p"; then
            ui_print "    = $pbase (kept, differs from new default)"
            preset_kept=$((preset_kept + 1))
        fi
    fi
done
if [ "$preset_kept" -gt 0 ]; then
    ui_print " "
    ui_print "[!] $preset_kept preset(s) on this device differ from the new"
    ui_print "    defaults and were left alone. The new defaults are in"
    ui_print "    ${DEFAULTS_DIR}"
    ui_print "    if you want to compare or copy them over."
    ui_print " "
fi
rm -rf ${MODPATH}/props

rm -rf ${MODPATH}/tools
rm ${MODPATH}/customize.sh
rm -f ${MODPATH}/verify.sh

ui_print "[-] Done. Open the module's WebUI any time to check status or change settings."
# EOF
