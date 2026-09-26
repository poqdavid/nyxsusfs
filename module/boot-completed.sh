#!/bin/sh
MODDIR=${0%/*}
SUSFS_BIN=/data/adb/ksu/bin/ksu_susfs
KSU_BIN=/data/adb/ksu/bin/ksud
. ${MODDIR}/utils.sh
PERSISTENT_DIR=/data/adb/nyxsusfs
tmpfolder=/data/adb/ksu/nyxsusfs
logfile="$tmpfolder/logs/susfs.log"
logfile1="$tmpfolder/logs/susfs1.log"
version=$(${SUSFS_BIN} show version)
susfs_features=$(${SUSFS_BIN} show enabled_features)
SUSFS_DECIMAL_MAIN=$(echo "$version" | sed 's/^v//;' | cut -d'.' -f1)
SUSFS_DECIMAL_SUB=$(echo "$version" | sed 's/^v//;' | cut -d'.' -f2)
SUSFS_DECIMAL_PATCH=$(echo "$version" | sed 's/^v//;' | cut -d'.' -f3)

legit_mounts="$PERSISTENT_DIR/legit_mounts.txt"

[ -w /mnt ] && mntfolder=/mnt/nyxsusfs
[ -w /mnt/vendor ] && mntfolder=/mnt/vendor/nyxsusfs

service=0
[ -f $tmpfolder/logs/boot_stage_time.sh ] && . $tmpfolder/logs/boot_stage_time.sh

hide_cusrom=0
hide_gapps=0
hide_revanced=0
spoof_uname=0
spoof_cmdline=0
hide_sus_mnts_for_all_or_non_su_procs=0
emulate_vold_app_data=0
auto_try_umount=0
skip_kernel_umount_zygisk=1
disable_add_try_umount=0
skip_legit_mounts=0
hide_injections=0
hide_custom_recovery=0
hide_framework_res=0
hide_data_local_tmp=0
hide_nonstd_sdcard=0
hide_nonstd_sdcard_android=0
hide_lineage_strings=0
force_hide_lsposed=0
[ -f $PERSISTENT_DIR/config.sh ] && . $PERSISTENT_DIR/config.sh

PROPS_DIR=${PERSISTENT_DIR}/props
vbmeta_size=$(sed -n 's/^vbmeta_size=//p' ${PERSISTENT_DIR}/config.sh 2> /dev/null)
vbmeta_size=${vbmeta_size:-8192}
nyx_resolve_avb_version
nyx_resolve_prop_dates
nyx_prop_tool_init "${prop_tool:-magisk}"
nyx_apply_prop_presets "$PROPS_DIR" boot-completed
if nyx_rp_needs_rebuild; then
    nyx_rebuild_touched_areas "${hide_compact:-area}"
fi

nyx_start_repeat_loop "$PROPS_DIR"

if [ -f $tmpfolder/logs/susfs_active ] || dmesg | grep -q "susfs:"; then
    status_txt="✅ Active"
else
    status_txt="❌ Not detected"
    touch ${MODDIR}/disable
fi

if [ -n "$version" ]; then
    version_txt="susfs $version"
else
    version_txt="susfs version unknown"
fi

description="[${status_txt}] ${version_txt} — details in the WebUI"
NYX_DESC="$description" awk '
BEGIN { done = 0; d = ENVIRON["NYX_DESC"] }
done == 0 && /^description=/ { print "description=" d; done = 1; next }
{ print }
END { if (done == 0) print "description=" d }
' "$MODDIR/module.prop" > "$MODDIR/module.prop.nyxtmp" \
    && mv "$MODDIR/module.prop.nyxtmp" "$MODDIR/module.prop"

nyx_skip_ksud_umount=0
if [ "$skip_kernel_umount_zygisk" = 1 ] && nyx_zygisk_handles_umount; then
    nyx_skip_ksud_umount=1
    echo "nyxsusfs/boot-completed: [skip_kernel_umount_zygisk] ReZygisk/ZygiskNext present, leaving kernel umount to it" >> $logfile1
fi

if [ "$nyx_skip_ksud_umount" != 1 ] && [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && [ $auto_try_umount = 1 ] && ! echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
    ${KSU_BIN} feature set kernel_umount 1 && echo "[ksud umount enabled]: nyxsusfs/boot-completed" >> $logfile1
fi

if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 7 ] 2> /dev/null; then
    if [ $hide_sus_mnts_for_all_or_non_su_procs -lt 1 ]; then
        ${SUSFS_BIN} hide_sus_mnts_for_all_procs 0 && echo "[hide_sus_mnts_for_all_procs = 0]: nyxsusfs/boot-completed" >> $logfile1
    fi
fi

if echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_OPEN_REDIRECT"; then
    grep -v "#" "$PERSISTENT_DIR/sus_open_redirect.txt" | while read -r line; do
        original_path=$(echo "$line" | awk '{print $1}')
        redirected_path=$(echo "$line" | awk '{print $2}')
        execute_on=$(echo "$line" | awk '{print $3}')
        [ "$execute_on" != "0" ] && continue
        SUS_KSTAT=$(stat -c "%i %d default default %X 0 %Y 0 %Z 0 %b %B" "$original_path")
        if [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && [ "$SUSFS_DECIMAL_SUB" -ge 1 ] 2> /dev/null; then
            uid_scheme=$(echo "$line" | awk '{print $4}')
            if [ -z $uid_scheme ]; then
                ${SUSFS_BIN} add_open_redirect "$original_path" "$redirected_path" 2 && echo "[open_redirect]: nyxsusfs/boot-completed $original_path -> $redirected_path default_uid_scheme: 2" >> $logfile1
            else
                ${SUSFS_BIN} add_open_redirect "$original_path" "$redirected_path" $uid_scheme && echo "[open_redirect]: nyxsusfs/boot-completed $original_path -> $redirected_path uid_scheme: $uid_scheme" >> $logfile1
            fi
        else
            ${SUSFS_BIN} add_open_redirect "$original_path" "$redirected_path" && echo "[open_redirect]: nyxsusfs/boot-completed $original_path -> $redirected_path" >> $logfile1
        fi
        ${SUSFS_BIN} add_sus_kstat_statically "$redirected_path" $SUS_KSTAT && echo "[add_sus_kstat_statically]: nyxsusfs/boot-completed $original_path" >> $logfile1
    done
fi

if echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_SUS_MAP"; then
    grep -v "#" $PERSISTENT_DIR/sus_maps.txt | while read -r i; do
        [ -z "$i" ] || { ${SUSFS_BIN} add_sus_map "$i" && echo "[sus_map]: nyxsusfs/boot-completed $i" >> $logfile1; }
    done

    [ "$hide_injections" = 1 ] && nyx_hide_injections boot-completed
    [ "$hide_framework_res" = 1 ] && nyx_hide_framework_res boot-completed
fi

if [ "$hide_custom_recovery" = 1 ] && echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_SUS_PATH"; then
    nyx_hide_custom_recovery boot-completed
fi

if echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_SUS_PATH"; then
    [ "$hide_data_local_tmp" = 1 ] && nyx_hide_data_local_tmp boot-completed
    [ "$hide_nonstd_sdcard" = 1 ] && nyx_hide_nonstd_sdcard boot-completed
    [ "$hide_nonstd_sdcard_android" = 1 ] && nyx_hide_nonstd_sdcard_android boot-completed
fi

if [ "$hide_lineage_strings" = 1 ] && echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_OPEN_REDIRECT"; then
    nyx_hide_lineage_strings boot-completed
fi

if [ -f "$PERSISTENT_DIR/sus_kstat_statically.json" ]; then
    awk '/^[[:space:]]*\{/,/^[[:space:]]*\}/' "$PERSISTENT_DIR/sus_kstat_statically.json" | {
        current_obj=""
        while IFS= read -r line; do
            if echo "$line" | grep -q '^[[:space:]]*{'; then
                current_obj=""
            fi
            current_obj="$current_obj $line"

            if echo "$line" | grep -q '^[[:space:]]*}'; then
                IFS='	' read -r path ino dev nlink size atime atime_nsec mtime mtime_nsec ctime ctime_nsec blocks blksize << EOF
$(echo "$current_obj" | awk '
					{
						while (match($0, /"[a-z_]+"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
							pair = substr($0, RSTART, RLENGTH)
							$0 = substr($0, RSTART + RLENGTH)
							k = pair; sub(/"[[:space:]]*:.*/, "", k); sub(/^"/, "", k)
							v = pair; sub(/^[^:]*:[[:space:]]*"/, "", v); sub(/"$/, "", v)
							if (!(k in seen)) { seen[k] = 1; val[k] = v }
						}
					}
					END {
						printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", \
							val["path"], val["ino"], val["dev"], val["nlink"], val["size"], \
							val["atime"], val["atime_nsec"], val["mtime"], val["mtime_nsec"], \
							val["ctime"], val["ctime_nsec"], val["blocks"], val["blksize"]
					}')
EOF

                if [ -n "$path" ]; then
                    ${SUSFS_BIN} add_sus_kstat_statically "$path" "$ino" "$dev" "$nlink" "$size" "$atime" "$atime_nsec" "$mtime" "$mtime_nsec" "$ctime" "$ctime_nsec" "$blocks" "$blksize" \
                        && echo "[add_sus_kstat_statically]: nyxsusfs/boot-completed $path" >> "$logfile1"
                fi
                current_obj=""
            fi
        done
    } 2> /dev/null || true
fi

if [ $auto_try_umount = 1 ] \
    && [ ! -f "/data/adb/susfs_no_auto_add_try_umount_for_bind_mount" ] \
    && echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_AUTO_ADD_TRY_UMOUNT_FOR_BIND_MOUNT"; then
    sed -i 's/auto_try_umount=.*/auto_try_umount=0/' $PERSISTENT_DIR/config.sh
    auto_try_umount=0
    echo "nyxsusfs/boot-completed: [auto_try_umount] kernel auto-adds try_umount for bind mounts, disabling userspace scan" >> $logfile1
fi

[ $auto_try_umount = 1 ] && {
    if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 7 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
        [ $hide_sus_mnts_for_all_or_non_su_procs -ge 1 ] && {
            ${SUSFS_BIN} hide_sus_mnts_for_all_procs 0 > /dev/null && echo "[hide_sus_mnts_for_all_procs = 0]: nyxsusfs/boot-completed" || {
                ${SUSFS_BIN} hide_sus_mnts_for_non_su_procs 0 > /dev/null && echo "[hide_sus_mnts_for_non_su_procs = 0]: nyxsusfs/boot-completed"
            }
        } >> $logfile1
    fi

    sus_mounts=$(awk '
		{
			sep = index($0, " - ")
			if (sep == 0) next
			pre  = substr($0, 1, sep - 1)
			post = substr($0, sep + 3)
			n = split(pre, a, " ")
			root   = a[4]
			target = a[5]
			split(post, b, " ")
			source = b[2]
			if (source == "KSU" || target ~ /^\/data\/adb\/modules/ || root ~ /^\/adb\/modules\//)
				print target
		}' /proc/1/mountinfo)
    for LINE in $sus_mounts; do
        if [ $skip_legit_mounts = 1 ] && grep -qE "^$LINE$" $legit_mounts 2> /dev/null; then
            echo "[skip_legit_mounts] Skipping legit mount: $LINE" >> $logfile1
            continue
        fi

        if [ "$disable_add_try_umount" != 1 ] && echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
            ${SUSFS_BIN} add_try_umount "${LINE}" 1 && echo "[try_umount (SUSFS)]: nyxsusfs/boot-completed ${LINE}" >> $logfile1
        elif [ "$nyx_skip_ksud_umount" != 1 ] && [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && ! echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
            ${KSU_BIN} kernel umount add "${LINE}" --flags 2 && echo "[try_umount (KSUD)]: nyxsusfs/boot-completed ${LINE}" >> $logfile1
        else
            echo "[try_umount skipped]: nyxsusfs/boot-completed ${LINE} (no active backend: zygisk-skip=$nyx_skip_ksud_umount, disable_add_try_umount=$disable_add_try_umount)" >> $logfile1
        fi
    done

    if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 7 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
        [ $hide_sus_mnts_for_all_or_non_su_procs -ge 1 ] && {
            ${SUSFS_BIN} hide_sus_mnts_for_all_procs 1 > /dev/null && echo "[hide_sus_mnts_for_all_procs = 1]: nyxsusfs/boot-completed" || {
                ${SUSFS_BIN} hide_sus_mnts_for_non_su_procs 1 > /dev/null && echo "[hide_sus_mnts_for_non_su_procs = 1]: nyxsusfs/boot-completed"
            }
        } >> $logfile1
    fi
}

if [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && grep -qv "#" "$PERSISTENT_DIR/try_umount.txt" 2> /dev/null; then
    grep -v "#" "$PERSISTENT_DIR/try_umount.txt" | while read -r i; do
        [ -z "$i" ] && continue
        if [ "$disable_add_try_umount" != 1 ] && echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
            ${SUSFS_BIN} add_try_umount "$i" 1 && echo "[try_umount (SUSFS)]: nyxsusfs/boot-completed $i" >> "$logfile1"
        elif [ "$nyx_skip_ksud_umount" != 1 ] && ! echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
            ${KSU_BIN} kernel umount add "$i" --flags 2 && echo "[try_umount (KSUD)]: nyxsusfs/boot-completed $i" >> "$logfile1"
        else
            echo "[try_umount skipped]: nyxsusfs/boot-completed $i (no active backend: zygisk-skip=$nyx_skip_ksud_umount, disable_add_try_umount=$disable_add_try_umount; left to Zygisk if it's a module mount)" >> "$logfile1"
        fi
    done
fi

[ $spoof_uname = 1 ] && spoof_uname

[ $hide_cusrom -gt 0 ] && {
    case $hide_cusrom in
        6) cusrom_exclude="" ;;
        5) cusrom_exclude="" ;;
        4) cusrom_exclude=".(apk|jar)|/vendor/bin/hw/" ;;
        3) cusrom_exclude=".(apk|jar|odex|vdex)|/vendor/bin/hw/" ;;
        2) cusrom_exclude=".(apk|jar|odex|vdex|so)|/vendor/bin/hw/" ;;
        1) cusrom_exclude=".(apk|jar|odex|vdex|so|rc)|/vendor/bin/hw/" ;;
        *) cusrom_exclude="" ;;
    esac
    echo "nyxsusfs/boot-completed: [hide_cusrom][$hide_cusrom]" >> $logfile1
    cusrom_names="lineage|infinity|evolution|crdroid|mistos|axion|pixelos|rising|lunaris|halcyon|havoc|alphadroid|bliss|calyx|derpfest|graphene|lmodroid|lumine|matrixx|clover|yaap|aospa"

    {
        find /system /vendor /system_ext /product -type f -o -type d 2> /dev/null | grep -iE "$cusrom_names" | grep -iE "\."
        find /data -maxdepth 1 2> /dev/null | grep -iE "$cusrom_names"
        [ "$hide_cusrom" = 6 ] && find /data/misc /data/dalvik-cache /data/resource-cache 2> /dev/null | grep -iE "$cusrom_names"
    } | {
        if [ -n "$cusrom_exclude" ]; then
            grep -vE "$cusrom_exclude"
        else
            cat
        fi
    } | while read -r path; do
        [ -n "$path" ] || continue
        ${SUSFS_BIN} add_sus_map "$path" && echo "[sus_map]: nyxsusfs/boot-completed $path" >> "$logfile1"
        ${SUSFS_BIN} add_sus_path_loop "$path" && echo "[sus_path_loop]: nyxsusfs/boot-completed $path" >> "$logfile1"
    done
}

[ $hide_gapps = 1 ] && {
    echo "nyxsusfs/boot-completed: [hide_gapps]" >> $logfile1
    find /system /vendor /system_ext /product \( -iname "*gapps*xml" -o -type d -iname "*gapps*" \) 2> /dev/null | while read -r i; do
        [ -n "$i" ] && { ${SUSFS_BIN} add_sus_path "$i" && echo "[sus_path]: nyxsusfs/boot-completed $i" >> $logfile1; }
    done
}

[ $spoof_cmdline = 1 ] && {
    echo "nyxsusfs/boot-completed: [spoof_cmdline]" >> $logfile1

    if grep -q "androidboot.verifiedbootstate" /proc/cmdline; then
        sed 's|androidboot\.verifiedbootstate=orange|androidboot.verifiedbootstate=green|g' /proc/cmdline > $mntfolder/cmdline
    else
        sed 's|androidboot\.verifiedbootstate[[:space:]]*=[[:space:]]*"orange"|androidboot.verifiedbootstate = "green"|g' /proc/bootconfig > $mntfolder/bootconfig
    fi

    if [ -f $mntfolder/cmdline ]; then
        sed -i 's|androidboot\.warranty_bit=1|androidboot.warranty_bit=0|g' $mntfolder/cmdline
    fi
    if [ -f $mntfolder/bootconfig ]; then
        sed -i 's|androidboot\.warranty_bit[[:space:]]*=[[:space:]]*"1"|androidboot.warranty_bit = "0"|g' $mntfolder/bootconfig
    fi

    if grep -q "androidboot.hwname\|androidboot.product.hardware.sku" /proc/cmdline; then
        sed -i "s/androidboot\.hwname=[^ ]*/androidboot.hwname=$(getprop ro.product.name)/; s/androidboot\.product\.hardware\.sku=[^ ]*/androidboot.product.hardware.sku=$(getprop ro.product.name)/" $mntfolder/cmdline
    else
        product_name=$(getprop ro.product.name)
        sed -i \
            -e "s|androidboot\.hwname[[:space:]]*=[[:space:]]*\"[^\"]*\"|androidboot.hwname = \"$product_name\"|g" \
            -e "s|androidboot\.product\.hardware\.sku[[:space:]]*=[[:space:]]*\"[^\"]*\"|androidboot.product.hardware.sku = \"$product_name\"|g" \
            $mntfolder/bootconfig
    fi

    if [ -f $mntfolder/cmdline ]; then
        if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 4 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
            ${SUSFS_BIN} set_cmdline_or_bootconfig $mntfolder/cmdline
        else
            ${SUSFS_BIN} set_proc_cmdline $mntfolder/cmdline
        fi
    fi

    if [ -f $mntfolder/bootconfig ]; then
        if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 4 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
            ${SUSFS_BIN} set_cmdline_or_bootconfig $mntfolder/bootconfig
        else
            ${SUSFS_BIN} set_proc_cmdline $mntfolder/bootconfig
        fi
    fi
}

[ $hide_revanced = 1 ] && {
    echo "nyxsusfs/boot-completed: [hide_revanced]" >> $logfile1
    count=0
    max_attempts=15
    until grep "youtube" /proc/self/mounts || [ $count -ge $max_attempts ]; do
        sleep 1
        count=$((count + 1))
    done
    packages="com.google.android.youtube com.google.android.apps.youtube.music"
    hide_app() {
        for path in $(pm path $1 | cut -d: -f2); do
            if echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_SUS_MOUNT"; then
                ${SUSFS_BIN} add_sus_mount $path && echo "[sus_mount] nyxsusfs/boot-completed: $path" >> $logfile1
            fi
            if echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
                ${SUSFS_BIN} add_try_umount $path 1 && echo "[try_umount] nyxsusfs/boot-completed: $path" >> $logfile1
            fi
            if [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && ! echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
                ${KSU_BIN} kernel umount add $path --flags 2 && echo "[try_umount (KSUD)] nyxsusfs/boot-completed: $path" >> $logfile1
            fi
        done
    }
    for i in $packages; do hide_app $i; done
} &

[ $force_hide_lsposed = 1 ] && [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && {
    echo "nyxsusfs/boot-completed: [force_hide_lsposed]" >> $logfile1
    ${KSU_BIN} kernel umount add /system/apex/com.android.art/bin/dex2oat --flags 2
    ${KSU_BIN} kernel umount add /system/apex/com.android.art/bin/dex2oat32 --flags 2
    ${KSU_BIN} kernel umount add /system/apex/com.android.art/bin/dex2oat64 --flags 2
    ${KSU_BIN} kernel umount add /apex/com.android.art/bin/dex2oat --flags 2
    ${KSU_BIN} kernel umount add /apex/com.android.art/bin/dex2oat32 --flags 2
    ${KSU_BIN} kernel umount add /apex/com.android.art/bin/dex2oat64 --flags 2
}

if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 7 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
    [ $hide_sus_mnts_for_all_or_non_su_procs = 2 ] && {
        ${SUSFS_BIN} hide_sus_mnts_for_all_procs 0 > /dev/null && echo "[hide_sus_mnts_for_all_procs = 0]: nyxsusfs/boot-completed" || {
            ${SUSFS_BIN} hide_sus_mnts_for_non_su_procs 0 > /dev/null && echo "[hide_sus_mnts_for_non_su_procs = 0]: nyxsusfs/boot-completed"
        }
    } >> $logfile1
fi

count=0
max_attempts=60
until [ -d "/sdcard/Android/data" ] || [ $count -ge $max_attempts ]; do
    sleep 1
    count=$((count + 1))
done
if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 8 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
    ${SUSFS_BIN} set_sdcard_root_path /sdcard
    ${SUSFS_BIN} set_android_data_root_path /sdcard/Android/data
fi

_add_sus_paths() {
    local sus_path_count=0
    while read -r i; do
        case "$i" in
            "" | \#*) continue ;;
        esac

        path=$(echo "$i" | awk '{print $1}')
        max_tries=$(echo "$i" | awk '{print $2}')

        until [ -z "$max_tries" ] || [ "$max_tries" -le 0 ] || [ -e "$path" ]; do
            max_tries=$((max_tries - 1))
            sleep 1
        done

        ${SUSFS_BIN} "$2" "$path" && {
            sus_path_count=$((sus_path_count + 1))
            echo "[$3]: nyxsusfs/boot-completed $path" >> "$logfile1"
        }
    done < "$1"
    echo "$sus_path_count"
}

dmesg_snapshot=$(dmesg)
echo "$dmesg_snapshot" | sed -n "/^\[ *$service/,\$p" | grep -iE "susfs_auto_add|ksu_susfs|susfs:" >> $logfile
endmsg=$(echo "$dmesg_snapshot" | grep -E '^\[ *[0-9]' | cut -d']' -f1 | sed 's/^\[ *//' | cut -d' ' -f1 | tail -n 1)
echo "boot_completed=$endmsg" >> $tmpfolder/logs/boot_stage_time.sh
sleep 15
if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 8 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
    ${SUSFS_BIN} set_sdcard_root_path /sdcard
    ${SUSFS_BIN} set_android_data_root_path /sdcard/Android/data
fi

sus_mount_count=$(($(grep -ciE "set SUS_MOUNT|to LH_SUS_MOUNT" $logfile) + $(awk '
	{
		sep = index($0, " - ")
		if (sep == 0) next
		pre  = substr($0, 1, sep - 1)
		post = substr($0, sep + 3)
		split(pre, a, " ")
		root   = a[4]
		target = a[5]
		split(post, b, " ")
		source = b[2]
		if (source == "KSU" || target ~ /^\/data\/adb\/modules/ || root ~ /^\/adb\/modules\//)
			c++
	}
	END { print c + 0 }' /proc/1/mountinfo)))
rm -f ${tmpfolder}/susfs_stats.txt
echo sus_map=$(grep -ci 'AS_FLAGS_SUS_MAP' $logfile) >> ${tmpfolder}/susfs_stats.txt
echo sus_mount=$sus_mount_count >> ${tmpfolder}/susfs_stats.txt
if [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] && ! echo "$susfs_features" | grep -q "CONFIG_KSU_SUSFS_TRY_UMOUNT"; then
    echo try_umount=$(grep -ci 'try_umount (KSUD)' $logfile1) >> ${tmpfolder}/susfs_stats.txt
else
    echo try_umount=$(grep -ci 'to LH_TRY_UMOUNT_PATH' $logfile) >> ${tmpfolder}/susfs_stats.txt
fi

{
    echo "sus_path=0" >> ${tmpfolder}/susfs_stats.txt
    [ $emulate_vold_app_data -ge 1 ] && {
        for i in $(pm list packages -3 | cut -d: -f2); do
            [ $emulate_vold_app_data = 1 ] && ${SUSFS_BIN} add_sus_path "/sdcard/Android/data/$i" && {
                app_data_count=$((app_data_count + 1))
                echo "[sus_path]: nyxsusfs/boot-completed /sdcard/Android/data/$i" >> $logfile1
            }
            [ $emulate_vold_app_data = 2 ] && ${SUSFS_BIN} add_sus_path_loop "/sdcard/Android/data/$i" && {
                app_data_count=$((app_data_count + 1))
                echo "[sus_path_loop]: nyxsusfs/boot-completed /sdcard/Android/data/$i" >> $logfile1
            }
        done
    }

    sus_path_count=$(_add_sus_paths "$PERSISTENT_DIR/sus_path.txt" add_sus_path sus_path)

    if [ -n "$version" ] && [ "$SUSFS_DECIMAL_MAIN" -ge 1 ] && [ "$SUSFS_DECIMAL_SUB" -ge 5 ] && [ "$SUSFS_DECIMAL_PATCH" -ge 9 ] || [ "$SUSFS_DECIMAL_MAIN" -ge 2 ] 2> /dev/null; then
        sus_path_loop_count=$(_add_sus_paths "$PERSISTENT_DIR/sus_path_loop.txt" add_sus_path_loop sus_path_loop)
    fi

    total_sus_paths=$((sus_path_count + sus_path_loop_count + app_data_count))
    sed -i "s/sus_path=.*/sus_path=$total_sus_paths/" ${tmpfolder}/susfs_stats.txt
    dmesg | sed -n "/^\[ *$endmsg/,\$p" | grep -iE "susfs_auto_add|ksu_susfs|susfs:" >> $logfile
} &
