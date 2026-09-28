#!/bin/sh
# NyxSUSFS persistent config.

# Every key below is read by the boot-stage scripts with a safe default,
# so it's fine to delete a line here — it'll just fall back to the
# in-script default until you set it again from the WebUI.
susfs_log=1
sus_su=2
sus_su_active=2
hide_cusrom=0
hide_vendor_sepolicy=0
hide_compat_matrix=0
hide_gapps=0
hide_revanced=0
spoof_cmdline=0
hide_loops=0

# Targeted mount/path hiding:
#   hide_injections      map every file a module injects (system/ overlay
#                        files + *.so under /data/adb/modules) so an
#                        inode/memory-map scan can't see them. Default on.
#   hide_suspicious_pty  hide /dev/pts/0..5 (root shell PTYs). Default off.
#   hide_custom_recovery hide TWRP/Fox/install-recovery leftovers if
#                        present. Default on.
#   hide_addon_d         hide /system/addon.d (survive-OTA ROM scripts).
#                        Default off.
#   hide_framework_res   map framework-res.apk overlays. Default off.
# Each no-ops if its susfs kernel feature (SUS_MAP / sus-path) is absent.
hide_injections=1
hide_suspicious_pty=0
hide_custom_recovery=1
hide_addon_d=0
hide_framework_res=0

# Bulk path hiding:
#   hide_data_local_tmp        hide every entry under /data/local/tmp
#                              (root-tool staging area). Default on.
#   hide_nonstd_sdcard         hide top-level /storage/emulated/0 entries
#                              that aren't standard media folders. Broad -
#                              hides any stray dir in storage root.
#                              Default off.
#   hide_nonstd_sdcard_android hide /storage/emulated/0/Android entries
#                              that aren't data/media/obb. Default on.
# All use sus_path_loop and no-op without the sus-path kernel feature.
hide_data_local_tmp=1
hide_nonstd_sdcard=0
hide_nonstd_sdcard_android=1

# hide_lineage_strings: redirect SELinux policy (*sepolicy.cil,
# *file_contexts) and lineage-mentioning *.rc files to empty fakes.
# ADVANCED / RISKY - off by default. These are policy/init files;
# anything that re-reads them at runtime (a late restorecon, a service
# restart) would see an empty file and could hit SELinux denials or fail
# to start. Only enable if you understand that and a check specifically
# needs it. Needs the open_redirect kernel feature.
hide_lineage_strings=0
force_hide_lsposed=0
spoof_uname=0
hide_sus_mnts_for_all_or_non_su_procs=1

# umount_for_zygote_iso_service: DEPRECATED in SuSFS v2.0.0. The
# umount_for_zygote_iso_service command was removed from susfs when it
# rebased onto KernelSU, so this is a no-op on v2.0.0+ kernels (the
# built-in kernel umount already covers isolated services). Kept for
# older kernels that still ship it. Default off.
umount_for_zygote_iso_service=0
auto_try_umount=0

# skip_kernel_umount_zygisk: when ReZygisk (rezygisk) or ZygiskNext
# (zygisksu) is installed, skip enabling the ksud kernel umount and skip
# Nyx's own ksud `kernel umount add` calls — those Zygisk implementations
# do their own unmounting inside each target process, and doing both
# conflicts. Default on. Only takes effect when such a Zygisk module is
# actually present; with none installed the module unmounts its normal
# way regardless of this setting.
skip_kernel_umount_zygisk=1

# disable_add_try_umount: independently skip the SuSFS-native
# add_try_umount backend (the kernel's own try-umount). DEPRECATED in
# SuSFS v2.0.0 — add_try_umount was removed from susfs, so this has no
# effect on v2.0.0+ kernels (Nyx routes umounts through KernelSU's
# built-in kernel umount there). Only relevant on older kernels that
# still expose CONFIG_KSU_SUSFS_TRY_UMOUNT. Default off.
disable_add_try_umount=0
skip_legit_mounts=0
avc_log_spoofing=0
emulate_vold_app_data=0

# 1 = don't check the susfs binary when the WebUI opens (the default).
# Set to 0 to have the WebUI compare the installed binary against
# sidex15/susfs4ksu-binaries on open and offer to install it. The check
# only ever reports; nothing is replaced without confirmation. There is
# also a "Check now" button in Settings that works either way.
disable_webui_bin_update=1
kernel_version='default'
kernel_build='default'

# Nyx-only: WebUI color scheme. One of: system, light, dark.
# Not read by any boot-stage script - safe to ignore outside the WebUI.
webui_theme='system'

# Nyx-only: use the device's Material You palette when the manager
# provides one. 1 = follow Material You, 0 = use Nyx's own palette.
webui_monet=0

# Nyx-only: hide the status and navigation bars while the WebUI is open.
# 1 = fullscreen (the default), 0 = leave the system bars visible, in
# which case the WebUI pads itself for them. Not read by any boot-stage
# script - safe to ignore outside the WebUI.
webui_fullscreen=1
