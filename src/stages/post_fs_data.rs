use crate::config::Vars;
use crate::ctx::{self, Ctx, Version, CONFIG, LOG, LOG1, LOG_DIR, PERSISTENT_DIR, STAGE_TIME, TMP_DIR};
use crate::fsx;
use crate::hide;
use crate::text;
use crate::tools::{self, Out};

pub const DEX2OAT: [&str; 6] = [
    "/system/apex/com.android.art/bin/dex2oat",
    "/system/apex/com.android.art/bin/dex2oat32",
    "/system/apex/com.android.art/bin/dex2oat64",
    "/apex/com.android.art/bin/dex2oat",
    "/apex/com.android.art/bin/dex2oat32",
    "/apex/com.android.art/bin/dex2oat64",
];

pub fn run(moddir: &str) {
    fsx::mkdir_p(LOG_DIR);
    let features = ctx::features();
    let version = Version::query();
    let mut vars = Vars::with_defaults(&[
        ("kernel_version", "default"),
        ("kernel_build", "default"),
        ("spoof_uname", "0"),
        ("avc_log_spoofing", "0"),
        ("hide_sus_mnts_for_all_or_non_su_procs", "0"),
        ("hide_suspicious_pty", "0"),
        ("hide_addon_d", "0"),
    ]);
    if fsx::is_file(CONFIG) {
        vars.source(CONFIG);
    }
    let c = Ctx::new(moddir, version, features, vars);
    if let Some(m) = &c.mntfolder {
        fsx::mkdir_p(m);
    }

    let active = format!("{TMP_DIR}/logs/susfs_active");
    if !c.features.is_empty() {
        fsx::touch(&active);
    } else if !(tools::dmesg().split('\n').any(|l| l.contains("susfs:")) && fsx::touch(&active)) {
        fsx::rm_f(&active);
    }
    if fsx::is_file(&format!("{PERSISTENT_DIR}/susfs_force_override")) {
        fsx::touch(&active);
    }

    fsx::write_lines(LOG1, &["nyxsusfs/post-fs-data: [logging_initialized]"]);

    match c.version.unsupported() {
        Some(why) => c.log1(&format!("nyxsusfs/post-fs-data: {why}, skipping")),
        None => apply(&c),
    }

    let snapshot = tools::dmesg();
    fsx::write_lines(LOG, &crate::dmesg::susfs_lines(&snapshot));
    fsx::write_lines(STAGE_TIME, &[format!("post_fs_data={}", crate::dmesg::endmsg(&snapshot))]);
}

fn apply(c: &Ctx) {
    if !(text::word_ge(c.var("hide_sus_mnts_for_all_or_non_su_procs"), 1) && hide_sus_mnts("1", "post-fs-data")) {
        hide_sus_mnts("0", "post-fs-data");
    }

    if text::word_eq(c.var("avc_log_spoofing"), "1") {
        tools::susfs(&["enable_avc_log_spoofing", "1"], Out::Inherit);
    }
    if text::word_eq(c.var("spoof_uname"), "2") {
        hide::spoof_uname(c);
    }

    if c.feature("CONFIG_KSU_SUSFS_SUS_PATH") {
        if c.var("hide_suspicious_pty") == "1" {
            hide::suspicious_pty(c, "post-fs-data");
        }
        if c.var("hide_addon_d") == "1" && c.feature("CONFIG_KSU_SUSFS_SUS_MAP") {
            hide::addon_d(c, "post-fs-data");
        }
    }
}

pub fn hide_sus_mnts(value: &str, tag: &str) -> bool {
    if tools::susfs(&["hide_sus_mnts_for_non_su_procs", value], Out::Null) {
        fsx::append_line(LOG1, &format!("[hide_sus_mnts_for_non_su_procs = {value}]: nyxsusfs/{tag}"));
        return true;
    }
    false
}
