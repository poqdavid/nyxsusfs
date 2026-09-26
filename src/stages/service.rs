use crate::config::Vars;
use crate::ctx::{self, Ctx, Version, CONFIG, PERSISTENT_DIR};
use crate::fsx;
use crate::text;
use crate::tools::{self, Out};

pub fn run(moddir: &str) {
    let version = Version::query();
    let features = ctx::features();
    let post_mount = ctx::stage_marker("post_mount");
    let mut vars = Vars::with_defaults(&[
        ("kernel_version", "default"),
        ("kernel_build", "default"),
        ("hide_loops", "1"),
        ("hide_vendor_sepolicy", "0"),
        ("hide_compat_matrix", "0"),
        ("susfs_log", "1"),
    ]);
    if fsx::is_file(CONFIG) {
        vars.source(CONFIG);
    }
    let c = Ctx::new(moddir, version, features, vars);

    if let Some(why) = c.version.unsupported() {
        c.log1(&format!("nyxsusfs/service: {why}, skipping"));
        ctx::kernel_log_checkpoint(&post_mount, "service");
        return;
    }

    if text::word_eq(c.var("susfs_log"), "1") {
        tools::susfs(&["enable_log", "1"], Out::Inherit);
    }

    ctx::kernel_log_checkpoint(&post_mount, "service");

    tools::run("resetprop", &["-w", "sys.boot_completed", "0"], Out::Inherit);

    if c.feature("CONFIG_KSU_SUSFS_OPEN_REDIRECT") {
        open_redirects(&c, "1", "service");
    }

    if text::word_eq(c.var("hide_loops"), "1") {
        c.log1("nyxsusfs/service: [hide_loops]");
        for device in loop_devices() {
            let jbd2 = format!("/proc/fs/jbd2/{device}-8");
            c.susfs_log(&["add_sus_path", &jbd2], &format!("[sus_path]: nyxsusfs/service {jbd2}"));
            let ext4 = format!("/proc/fs/ext4/{device}");
            c.susfs_log(&["add_sus_path", &ext4], &format!("[sus_path]: nyxsusfs/service {ext4}"));
        }
    }

    if text::word_eq(c.var("hide_vendor_sepolicy"), "1") {
        c.log1("nyxsusfs/service: [hide_vendor_sepolicy]");
        for f in [
            "/vendor/etc/selinux/vendor_sepolicy.cil",
            "/vendor/etc/selinux/vendor_file_contexts",
            "/system_ext/etc/selinux/system_ext_sepolicy.cil",
        ] {
            lineage_free_bind(&c, f, &c.mnt(fsx::basename(f)));
        }
    }

    if text::word_eq(c.var("hide_compat_matrix"), "1") {
        c.log1("nyxsusfs/service: [hide_compat_matrix] - compatibility_matrix.device.xml");
        let f = "/system/etc/vintf/compatibility_matrix.device.xml";
        lineage_free_bind(&c, f, &c.mnt("compatibility_matrix.device.xml"));
    }
}

pub fn open_redirects(c: &Ctx, stage: &str, tag: &str) {
    for line in fsx::lines_without_hash(&format!("{PERSISTENT_DIR}/sus_open_redirect.txt")).unwrap_or_default() {
        let orig = text::column(&line, 1);
        let redir = text::column(&line, 2);
        if text::column(&line, 3) != stage {
            continue;
        }
        let kstat = fsx::sus_kstat_fields(orig);
        let uid = text::column(&line, 4);
        let (scheme, label) = if uid.is_empty() {
            ("2", "default_uid_scheme")
        } else {
            (uid, "uid_scheme")
        };
        c.susfs_log(
            &["add_open_redirect", orig, redir, scheme],
            &format!("[open_redirect]: nyxsusfs/{tag} {orig} -> {redir} {label}: {scheme}"),
        );
        if kstat.is_empty() {
            continue;
        }
        let mut args = vec!["add_sus_kstat_statically", redir];
        args.extend(kstat.iter().map(String::as_str));
        c.susfs_log(&args, &format!("[add_sus_kstat_statically]: nyxsusfs/{tag} {orig}"));
    }
}

fn loop_devices() -> Vec<String> {
    let dir = "/proc/fs/jbd2";
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = rd
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("loop") && n.ends_with('8'))
        .collect();
    names.sort();
    names
        .into_iter()
        .filter(|n| std::fs::metadata(format!("{dir}/{n}")).is_ok())
        .map(|n| n.replacen("-8", "", 1))
        .flat_map(|n| text::words(&n).into_iter().map(str::to_string).collect::<Vec<_>>())
        .collect()
}

fn lineage_free_bind(c: &Ctx, file: &str, copy: &str) {
    let has = |l: &Vec<u8>| l.windows(7).any(|w| w == b"lineage");
    let Some(lines) = fsx::read_lines_bytes(file) else { return };
    if !lines.iter().any(has) {
        return;
    }
    let kept: Vec<&Vec<u8>> = lines.iter().filter(|l| !has(l)).collect();
    fsx::write_lines_bytes(copy, &kept);
    c.susfs_log(&["add_sus_kstat", file], &format!("[add_sus_kstat]: nyxsusfs/service {file}"));
    if tools::run_cmd(tools::applet("mount", &["--bind", copy, file]), Out::Inherit) {
        c.log1(&format!("[bind_mount]: nyxsusfs/service {file}"));
    }
    c.susfs_log(&["update_sus_kstat", file], &format!("[update_sus_kstat]: nyxsusfs/service {file}"));
}
