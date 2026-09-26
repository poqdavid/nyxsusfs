use crate::ctx::{Ctx, PERSISTENT_DIR};
use crate::fsx::{self, Kind};
use crate::tools::{self, Out};

pub fn clone_perm(to: &str, from: &str) {
    if to.is_empty() || from.is_empty() {
        return;
    }
    fsx::clone_mode_owner(to, from);
    tools::run("busybox", &["chcon", &format!("--reference={from}"), to], Out::Inherit);
}

pub fn spoof_uname(ctx: &Ctx) {
    let kv = match ctx.var("kernel_version") {
        "" => "default",
        v => v,
    };
    let kb = match ctx.var("kernel_build") {
        "" => "default",
        v => v,
    };
    tools::susfs(&["set_uname", kv, kb], Out::Inherit);
}

pub fn sus_map(ctx: &Ctx, path: &str, tag: &str) {
    if !path.is_empty() {
        ctx.susfs_log(&["add_sus_map", path], &format!("[sus_map]: nyxsusfs/{tag} {path}"));
    }
}

pub fn sus_path_loop(ctx: &Ctx, path: &str, tag: &str) {
    if !path.is_empty() {
        ctx.susfs_log(&["add_sus_path_loop", path], &format!("[sus_path_loop]: nyxsusfs/{tag} {path}"));
    }
}

pub fn injections(ctx: &Ctx, tag: &str) {
    let ovl = "/data/adb/modules/meta-overlayfs/mnt";
    let base = if fsx::exists(ovl) { ovl } else { "/data/adb/modules" };
    for m in fsx::glob_star(base) {
        let sys = format!("{m}/system");
        if !fsx::is_dir(&sys) {
            continue;
        }
        for f in fsx::find(&[&sys], None, |e| e.kind == Kind::File) {
            sus_map(ctx, &f, tag);
        }
    }
    for f in fsx::find(&["/data/adb/modules"], None, |e| crate::text::glob_match("*.so", e.name, false)) {
        sus_map(ctx, &f, tag);
    }
}

pub fn suspicious_pty(ctx: &Ctx, tag: &str) {
    for i in 0..=5 {
        sus_path_loop(ctx, &format!("/dev/pts/{i}"), tag);
    }
}

pub fn custom_recovery(ctx: &Ctx, tag: &str) {
    for p in [
        "/storage/emulated/0/Fox",
        "/storage/emulated/0/TWRP",
        "/data/recovery",
        "/vendor/bin/install-recovery.sh",
        "/system/bin/install-recovery.sh",
    ] {
        if fsx::exists(p) {
            sus_path_loop(ctx, p, tag);
        }
    }
}

pub fn addon_d(ctx: &Ctx, tag: &str) {
    if !fsx::exists("/system/addon.d") {
        return;
    }
    sus_map(ctx, "/system/addon.d", tag);
    sus_path_loop(ctx, "/system/addon.d", tag);
}

pub fn framework_res(ctx: &Ctx, tag: &str) {
    for f in fsx::find(&["/system"], None, |e| crate::text::glob_match("*framework-res.apk", e.name, true)) {
        sus_map(ctx, &f, tag);
    }
}

pub fn data_local_tmp(ctx: &Ctx, tag: &str) {
    for e in fsx::glob_star("/data/local/tmp") {
        if fsx::exists(&e) {
            sus_path_loop(ctx, &e, tag);
        }
    }
}

pub fn nonstd_sdcard(ctx: &Ctx, tag: &str) {
    let mut std = vec![
        "Alarms",
        "Android",
        "Audiobooks",
        "DCIM",
        "Documents",
        "Download",
        "Movies",
        "Music",
        "Notifications",
        "Pictures",
        "Podcasts",
        "Recordings",
        "Ringtones",
    ];
    if !tools::rp_get("ro.miui.ui.version.name").is_empty() {
        std.push("MIUI");
    }
    for e in fsx::glob_star("/storage/emulated/0") {
        if !fsx::exists(&e) || std.contains(&fsx::basename(&e)) {
            continue;
        }
        sus_path_loop(ctx, &e, tag);
    }
}

pub fn nonstd_sdcard_android(ctx: &Ctx, tag: &str) {
    for e in fsx::glob_star("/storage/emulated/0/Android") {
        if !fsx::exists(&e) || matches!(fsx::basename(&e), "data" | "media" | "obb") {
            continue;
        }
        sus_path_loop(ctx, &e, tag);
    }
}

pub fn lineage_strings(ctx: &Ctx, tag: &str) {
    let fakedir = format!("{PERSISTENT_DIR}/fake_files");
    fsx::mkdir_p(&fakedir);
    let roots = ["/system", "/system_ext", "/vendor", "/product"];
    let redirect = |p: &str| {
        let fake = format!("{fakedir}/{}", fsx::basename(p));
        if !fsx::is_file(&fake) {
            fsx::write_lines::<&str>(&fake, &[]);
        }
        clone_perm(&fake, p);
        ctx.susfs_log(
            &["add_open_redirect", p, &fake, "3"],
            &format!("[open_redirect]: nyxsusfs/{tag} {p} -> {fake} (lineage_strings)"),
        );
    };
    let policy = fsx::find(&roots, None, |e| {
        crate::text::glob_match("*sepolicy.cil", e.name, true) || crate::text::glob_match("*file_contexts", e.name, true)
    });
    for p in policy {
        if fsx::is_file(&p) {
            redirect(&p);
        }
    }
    for p in fsx::find(&roots, None, |e| crate::text::glob_match("*.rc", e.name, true)) {
        if !fsx::is_file(&p) {
            continue;
        }
        let mentions = std::fs::read(&p).is_ok_and(|b| crate::text::icontains(&String::from_utf8_lossy(&b), "lineage"));
        if mentions {
            redirect(&p);
        }
    }
}

pub fn zygisk_handles_umount() -> bool {
    ["/data/adb/modules/rezygisk", "/data/adb/modules/zygisksu"]
        .iter()
        .any(|d| fsx::is_dir(d) && !fsx::is_file(&format!("{d}/disable")) && !fsx::is_file(&format!("{d}/remove")))
}
