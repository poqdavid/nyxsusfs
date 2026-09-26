use crate::config::Vars;
use crate::ctx::{self, Ctx, Version, CONFIG, LOG, LOG1, PERSISTENT_DIR, TMP_DIR};
use crate::fsx::{self, Kind};
use crate::hide;
use crate::priority;
use crate::stages::post_fs_data::{hide_sus_mnts, DEX2OAT};
use crate::stages::service::open_redirects;
use crate::text;
use crate::tools::{self, Out};

pub fn run(moddir: &str) {
    let version = Version::query();
    let features = ctx::features();
    let service_marker = ctx::stage_marker("service");
    let mut vars = Vars::with_defaults(&[
        ("hide_cusrom", "0"),
        ("hide_gapps", "0"),
        ("hide_revanced", "0"),
        ("spoof_uname", "0"),
        ("spoof_cmdline", "0"),
        ("hide_sus_mnts_for_all_or_non_su_procs", "0"),
        ("emulate_vold_app_data", "0"),
        ("auto_try_umount", "0"),
        ("skip_kernel_umount_zygisk", "1"),
        ("skip_legit_mounts", "0"),
        ("hide_injections", "0"),
        ("hide_custom_recovery", "0"),
        ("hide_framework_res", "0"),
        ("hide_data_local_tmp", "0"),
        ("hide_nonstd_sdcard", "0"),
        ("hide_nonstd_sdcard_android", "0"),
        ("hide_lineage_strings", "0"),
        ("force_hide_lsposed", "0"),
        ("priority_uid_filter", "0"),
    ]);
    if fsx::is_file(CONFIG) {
        vars.source(CONFIG);
    }
    let c = Ctx::new(moddir, version, features, vars);

    description(&c);

    if let Some(why) = c.version.unsupported() {
        c.log1(&format!("nyxsusfs/boot-completed: {why}, skipping"));
        return;
    }

    let skip_ksud = text::word_eq(c.var("skip_kernel_umount_zygisk"), "1") && hide::zygisk_handles_umount();
    if skip_ksud {
        c.log1("nyxsusfs/boot-completed: [skip_kernel_umount_zygisk] ReZygisk/ZygiskNext present, leaving kernel umount to it");
    }
    if !skip_ksud && text::word_eq(c.var("auto_try_umount"), "1") {
        c.ksud_log(
            &["feature", "set", "kernel_umount", "1"],
            "[ksud umount enabled]: nyxsusfs/boot-completed",
        );
    }

    if c.feature("CONFIG_KSU_SUSFS_OPEN_REDIRECT") {
        open_redirects(&c, "0", "boot-completed");
    }

    if c.feature("CONFIG_KSU_SUSFS_SUS_MAP") {
        for l in fsx::lines_without_hash(&format!("{PERSISTENT_DIR}/sus_maps.txt")).unwrap_or_default() {
            let i = text::trim(&l);
            if !i.is_empty() {
                c.susfs_log(&["add_sus_map", i], &format!("[sus_map]: nyxsusfs/boot-completed {i}"));
            }
        }
        if c.var("hide_injections") == "1" {
            hide::injections(&c, "boot-completed");
        }
        if c.var("hide_framework_res") == "1" {
            hide::framework_res(&c, "boot-completed");
        }
    }

    if c.var("hide_custom_recovery") == "1" && c.feature("CONFIG_KSU_SUSFS_SUS_PATH") {
        hide::custom_recovery(&c, "boot-completed");
    }

    if c.feature("CONFIG_KSU_SUSFS_SUS_PATH") {
        if c.var("hide_data_local_tmp") == "1" {
            hide::data_local_tmp(&c, "boot-completed");
        }
        if c.var("hide_nonstd_sdcard") == "1" {
            hide::nonstd_sdcard(&c, "boot-completed");
        }
        if c.var("hide_nonstd_sdcard_android") == "1" {
            hide::nonstd_sdcard_android(&c, "boot-completed");
        }
    }

    if c.var("hide_lineage_strings") == "1" && c.feature("CONFIG_KSU_SUSFS_OPEN_REDIRECT") {
        hide::lineage_strings(&c, "boot-completed");
    }

    sus_kstat_statically_json(&c);

    auto_try_umount(&c, skip_ksud);

    try_umount_txt(&c, skip_ksud);

    if text::word_eq(c.var("spoof_uname"), "1") {
        hide::spoof_uname(&c);
    }

    hide_cusrom(&c);
    hide_gapps(&c);
    spoof_cmdline(&c);

    std::thread::scope(|s| {
        if std::thread::Builder::new().spawn_scoped(s, || hide_revanced(&c)).is_err() {
            hide_revanced(&c);
        }
        if std::thread::Builder::new().spawn_scoped(s, || priority_filter(&c)).is_err() {
            priority_filter(&c);
        }

        if text::word_eq(c.var("force_hide_lsposed"), "1") {
            c.log1("nyxsusfs/boot-completed: [force_hide_lsposed]");
            for p in DEX2OAT {
                tools::ksud(&["kernel", "umount", "add", p, "--flags", "2"]);
            }
        }

        if c.var("hide_sus_mnts_for_all_or_non_su_procs") == "2" {
            hide_sus_mnts("0", "boot-completed");
        }

        wait_for("/sdcard/Android/data", 60);

        let end = ctx::kernel_log_checkpoint(&service_marker, "boot_completed");

        tools::nap(15);

        stats_and_paths(&c, &end);
    });
}

fn description(c: &Ctx) {
    let active = fsx::is_file(&format!("{TMP_DIR}/logs/susfs_active")) || tools::dmesg().split('\n').any(|l| l.contains("susfs:"));
    let supported = c.version.supported();
    let status = if supported && active {
        "✅ Active"
    } else {
        fsx::touch(&format!("{}/disable", c.moddir));
        if !supported && (active || !c.version.raw.is_empty()) {
            "❌ Needs SuSFS v2.1.0+"
        } else {
            "❌ Not detected"
        }
    };
    let version_txt = if c.version.raw.is_empty() {
        "susfs version unknown".to_string()
    } else {
        format!("susfs {}", c.version.raw)
    };
    let desc = format!("description=[{status}] {version_txt} — details in the WebUI");
    let path = format!("{}/module.prop", c.moddir);
    let Some(lines) = fsx::read_lines(&path) else { return };
    let mut out = Vec::with_capacity(lines.len() + 1);
    let mut done = false;
    for l in &lines {
        if !done && l.starts_with("description=") {
            out.push(desc.clone());
            done = true;
        } else {
            out.push(l.clone());
        }
    }
    if !done {
        out.push(desc);
    }
    fsx::write_lines(&path, &out);
}

fn sus_kstat_statically_json(c: &Ctx) {
    let path = format!("{PERSISTENT_DIR}/sus_kstat_statically.json");
    let Ok(raw) = std::fs::read_to_string(&path) else { return };
    const KEYS: [&str; 13] = [
        "path",
        "ino",
        "dev",
        "nlink",
        "size",
        "atime",
        "atime_nsec",
        "mtime",
        "mtime_nsec",
        "ctime",
        "ctime_nsec",
        "blocks",
        "blksize",
    ];
    for obj in brace_objects(&raw) {
        let vals = extract_pairs(&obj);
        let get = |k: &str| vals.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.as_str()).unwrap_or("");
        let mut fields: Vec<String> = KEYS.iter().map(|k| get(k).to_string()).filter(|v| !v.is_empty()).collect();
        if fields.is_empty() {
            continue;
        }
        fields.resize(13, String::new());
        let mut args = vec!["add_sus_kstat_statically"];
        args.extend(fields.iter().map(String::as_str));
        c.susfs_log(&args, &format!("[add_sus_kstat_statically]: nyxsusfs/boot-completed {}", fields[0]));
    }
}

fn brace_objects(text: &str) -> Vec<String> {
    let mut objs = Vec::new();
    let mut cur: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim_start_matches([' ', '\t']);
        if trimmed.starts_with('{') {
            cur = Some(String::new());
        }
        if let Some(buf) = cur.as_mut() {
            buf.push_str(line);
            buf.push(' ');
            if trimmed.starts_with('}') {
                objs.push(cur.take().unwrap());
            }
        }
    }
    objs
}

fn extract_pairs(obj: &str) -> Vec<(String, String)> {
    let b = obj.as_bytes();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'"' {
            i += 1;
            continue;
        }
        let ks = i + 1;
        let mut ke = ks;
        while ke < b.len() && (b[ke].is_ascii_lowercase() || b[ke] == b'_') {
            ke += 1;
        }
        if ke == ks || ke >= b.len() || b[ke] != b'"' {
            i += 1;
            continue;
        }
        let mut j = ke + 1;
        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
            j += 1;
        }
        if j >= b.len() || b[j] != b':' {
            i = ke + 1;
            continue;
        }
        j += 1;
        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
            j += 1;
        }
        if j >= b.len() || b[j] != b'"' {
            i = ke + 1;
            continue;
        }
        let vs = j + 1;
        let mut ve = vs;
        while ve < b.len() && b[ve] != b'"' {
            ve += 1;
        }
        if ve >= b.len() {
            break;
        }
        let key = obj[ks..ke].to_string();
        if !out.iter().any(|(k, _)| *k == key) {
            out.push((key, obj[vs..ve].to_string()));
        }
        i = ve + 1;
    }
    out
}

fn auto_try_umount(c: &Ctx, skip_ksud: bool) {
    if !text::word_eq(c.var("auto_try_umount"), "1") {
        return;
    }

    let on = text::word_ge(c.var("hide_sus_mnts_for_all_or_non_su_procs"), 1);
    if on {
        hide_sus_mnts("0", "boot-completed");
    }

    let legit = format!("{PERSISTENT_DIR}/legit_mounts.txt");
    for target in ksu_mount_targets() {
        if text::word_eq(c.var("skip_legit_mounts"), "1") && has_line(&legit, &target) {
            c.log1(&format!("[skip_legit_mounts] Skipping legit mount: {target}"));
            continue;
        }
        kernel_umount(c, &target, skip_ksud);
    }

    if on {
        hide_sus_mnts("1", "boot-completed");
    }
}

fn try_umount_txt(c: &Ctx, skip_ksud: bool) {
    let path = format!("{PERSISTENT_DIR}/try_umount.txt");
    let Some(lines) = fsx::lines_without_hash(&path) else { return };
    for l in &lines {
        let i = text::trim(l);
        if !i.is_empty() {
            kernel_umount(c, i, skip_ksud);
        }
    }
}

fn kernel_umount(c: &Ctx, target: &str, skip_ksud: bool) {
    if skip_ksud {
        c.log1(&format!(
            "[try_umount skipped]: nyxsusfs/boot-completed {target} (left to ReZygisk/ZygiskNext)"
        ));
    } else {
        c.ksud_log(
            &["kernel", "umount", "add", target, "--flags", "2"],
            &format!("[try_umount (KSUD)]: nyxsusfs/boot-completed {target}"),
        );
    }
}

fn hide_cusrom(c: &Ctx) {
    let level = c.var("hide_cusrom");
    if !text::word_gt(level, 0) {
        return;
    }
    let exclude = match level {
        "4" => ".(apk|jar)|/vendor/bin/hw/",
        "3" => ".(apk|jar|odex|vdex)|/vendor/bin/hw/",
        "2" => ".(apk|jar|odex|vdex|so)|/vendor/bin/hw/",
        "1" => ".(apk|jar|odex|vdex|so|rc)|/vendor/bin/hw/",
        _ => "",
    };
    c.log1(&format!("nyxsusfs/boot-completed: [hide_cusrom][{level}]"));
    const NAMES: &str = "lineage|infinity|evolution|crdroid|mistos|axion|pixelos|rising|lunaris|halcyon|havoc|alphadroid|bliss|calyx|derpfest|graphene|lmodroid|lumine|matrixx|clover|yaap|aospa";
    let names: Vec<&str> = NAMES.split('|').collect();

    let mut hits: Vec<String> = fsx::find(&["/system", "/vendor", "/system_ext", "/product"], None, |e| {
        (e.kind == Kind::File || e.kind == Kind::Dir) && names.iter().any(|n| text::icontains(e.path, n)) && e.path.contains('.')
    });
    hits.extend(fsx::find(&["/data"], Some(1), |e| names.iter().any(|n| text::icontains(e.path, n))));
    if level == "6" {
        hits.extend(fsx::find(
            &["/data/misc", "/data/dalvik-cache", "/data/resource-cache"],
            None,
            |e| names.iter().any(|n| text::icontains(e.path, n)),
        ));
    }

    let exclude_res = exclude_matcher(exclude);
    for path in hits {
        if exclude.is_empty() || !exclude_res(&path) {
            c.susfs_log(&["add_sus_map", &path], &format!("[sus_map]: nyxsusfs/boot-completed {path}"));
            c.susfs_log(
                &["add_sus_path_loop", &path],
                &format!("[sus_path_loop]: nyxsusfs/boot-completed {path}"),
            );
        }
    }
}

fn exclude_matcher(exclude: &str) -> impl Fn(&str) -> bool + '_ {
    let alts = split_top_level_alts(exclude);
    move |path: &str| {
        alts.iter().any(|alt| {
            if let Some(exts) = alt.strip_prefix(".(").and_then(|s| s.strip_suffix(')')) {
                exts.split('|').any(|e| text::re_lite_contains(path, &format!(".{e}")))
            } else {
                path.contains(alt.as_str())
            }
        })
    }
}

fn split_top_level_alts(ere: &str) -> Vec<String> {
    let mut alts = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for ch in ere.chars() {
        match ch {
            '(' => {
                depth += 1;
                cur.push(ch);
            }
            ')' => {
                depth -= 1;
                cur.push(ch);
            }
            '|' if depth == 0 => {
                if !cur.is_empty() {
                    alts.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(ch),
        }
    }
    if !cur.is_empty() {
        alts.push(cur);
    }
    alts
}

fn hide_gapps(c: &Ctx) {
    if !text::word_eq(c.var("hide_gapps"), "1") {
        return;
    }
    c.log1("nyxsusfs/boot-completed: [hide_gapps]");
    let hits = fsx::find(&["/system", "/vendor", "/system_ext", "/product"], None, |e| {
        text::glob_match("*gapps*xml", e.name, true) || (e.kind == Kind::Dir && text::glob_match("*gapps*", e.name, true))
    });
    for i in hits {
        if !i.is_empty() {
            c.susfs_log(&["add_sus_path", &i], &format!("[sus_path]: nyxsusfs/boot-completed {i}"));
        }
    }
}

fn hide_revanced(c: &Ctx) {
    if !text::word_eq(c.var("hide_revanced"), "1") {
        return;
    }
    c.log1("nyxsusfs/boot-completed: [hide_revanced]");
    let mut count = 0;
    while !file_contains("/proc/self/mounts", "youtube") && count < 15 {
        tools::nap(1);
        count += 1;
    }
    for pkg in ["com.google.android.youtube", "com.google.android.apps.youtube.music"] {
        for line in tools::capture("pm", &["path", pkg]).split('\n') {
            for path in text::words(text::field(line, ':', 2)) {
                c.ksud_log(
                    &["kernel", "umount", "add", path, "--flags", "2"],
                    &format!("[try_umount (KSUD)] nyxsusfs/boot-completed: {path}"),
                );
            }
        }
    }
}

fn priority_filter(c: &Ctx) {
    if priority::enabled(c) && !priority::wait_unlocked() {
        c.log1("[priority_uid_filter failed]: nyxsusfs/boot-completed the device was not unlocked within 15 minutes");
        return;
    }
    priority::apply(c, "boot-completed");
}

fn stats_and_paths(c: &Ctx, end: &str) {
    let stats = format!("{TMP_DIR}/susfs_stats.txt");
    let log_text = std::fs::read_to_string(LOG).unwrap_or_default();

    let sus_mount = count_matching_lines(&log_text, &["set sus_mount", "to lh_sus_mount"]) + ksu_mount_targets().len();
    let sus_map = count_matching_lines(&log_text, &["as_flags_sus_map"]);
    fsx::rm_f(&stats);
    fsx::append_line(&stats, &format!("sus_map={sus_map}"));
    fsx::append_line(&stats, &format!("sus_mount={sus_mount}"));
    let try_umount = count_matching_lines(&std::fs::read_to_string(LOG1).unwrap_or_default(), &["try_umount (ksud)"]);
    fsx::append_line(&stats, &format!("try_umount={try_umount}"));

    fsx::append_line(&stats, "sus_path=0");
    let mut app_data = 0;
    if text::word_ge(c.var("emulate_vold_app_data"), 1) {
        for pkg in tools::capture("pm", &["list", "packages", "-3"])
            .split('\n')
            .map(|l| text::field(l, ':', 2))
        {
            if pkg.is_empty() {
                continue;
            }
            let p = format!("/sdcard/Android/data/{pkg}");
            if c.var("emulate_vold_app_data") == "1" && tools::susfs(&["add_sus_path", &p], Out::Inherit) {
                app_data += 1;
                c.log1(&format!("[sus_path]: nyxsusfs/boot-completed {p}"));
            }
            if c.var("emulate_vold_app_data") == "2" && tools::susfs(&["add_sus_path_loop", &p], Out::Inherit) {
                app_data += 1;
                c.log1(&format!("[sus_path_loop]: nyxsusfs/boot-completed {p}"));
            }
        }
    }

    let sus_path = add_sus_paths(c, &format!("{PERSISTENT_DIR}/sus_path.txt"), "add_sus_path", "sus_path");
    let sus_path_loop = add_sus_paths(
        c,
        &format!("{PERSISTENT_DIR}/sus_path_loop.txt"),
        "add_sus_path_loop",
        "sus_path_loop",
    );
    let total = sus_path + sus_path_loop + app_data;
    fsx::edit_lines(&stats, |l| {
        if l.starts_with("sus_path=") {
            format!("sus_path={total}")
        } else {
            l.to_string()
        }
    });

    let snapshot = tools::dmesg();
    let lines: Vec<&str> = crate::dmesg::from_marker(&snapshot, end)
        .into_iter()
        .filter(|l| crate::dmesg::is_susfs_line(l))
        .collect();
    fsx::append_lines(LOG, &lines);
}

fn add_sus_paths(c: &Ctx, file: &str, subcmd: &str, tag: &str) -> usize {
    let Some(lines) = fsx::read_terminated_lines(file) else { return 0 };
    let mut count = 0;
    for raw in &lines {
        let i = text::trim(raw);
        if i.is_empty() || i.starts_with('#') {
            continue;
        }
        let path = text::column(i, 1);
        let mut tries = text::column(i, 2).to_string();
        while !tries.is_empty() && text::int(&tries).is_none_or(|v| v > 0) && !fsx::exists(path) {
            tries = (text::int(&tries).unwrap_or(0) - 1).to_string();
            tools::nap(1);
        }
        if tools::susfs(&[subcmd, path], Out::Inherit) {
            count += 1;
            c.log1(&format!("[{tag}]: nyxsusfs/boot-completed {path}"));
        }
    }
    count
}

fn spoof_cmdline(c: &Ctx) {
    if !text::word_eq(c.var("spoof_cmdline"), "1") {
        return;
    }
    c.log1("nyxsusfs/boot-completed: [spoof_cmdline]");
    let cmdline = std::fs::read_to_string("/proc/cmdline").unwrap_or_default();
    let name = tools::getprop("ro.product.name");
    let mnt_cmdline = c.mnt("cmdline");
    let mnt_bootconfig = c.mnt("bootconfig");

    if cmdline.contains("androidboot.verifiedbootstate") {
        let patched = cmdline.replace("androidboot.verifiedbootstate=orange", "androidboot.verifiedbootstate=green");
        std::fs::write(&mnt_cmdline, patched).ok();
    } else {
        let bootconfig = std::fs::read_to_string("/proc/bootconfig").unwrap_or_default();
        let patched = replace_spaced_assign(
            &bootconfig,
            "androidboot.verifiedbootstate",
            "\"orange\"",
            "androidboot.verifiedbootstate = \"green\"",
        );
        std::fs::write(&mnt_bootconfig, patched).ok();
    }

    if fsx::is_file(&mnt_cmdline) {
        fsx::edit_lines(&mnt_cmdline, |l| {
            l.replace("androidboot.warranty_bit=1", "androidboot.warranty_bit=0")
        });
    }
    if fsx::is_file(&mnt_bootconfig) {
        fsx::edit_lines(&mnt_bootconfig, |l| {
            replace_spaced_assign(l, "androidboot.warranty_bit", "\"1\"", "androidboot.warranty_bit = \"0\"")
        });
    }

    let cmdline_now = std::fs::read_to_string("/proc/cmdline").unwrap_or_default();
    if cmdline_now.contains("androidboot.hwname") || cmdline_now.contains("androidboot.product.hardware.sku") {
        fsx::edit_lines(&mnt_cmdline, |l| {
            let l = replace_assign_nospace(l, "androidboot.hwname", &format!("androidboot.hwname={name}"));
            replace_assign_nospace(
                &l,
                "androidboot.product.hardware.sku",
                &format!("androidboot.product.hardware.sku={name}"),
            )
        });
    } else {
        fsx::edit_lines(&mnt_bootconfig, |l| {
            let l = replace_spaced_any(l, "androidboot.hwname", &format!("androidboot.hwname = \"{name}\""));
            replace_spaced_any(
                &l,
                "androidboot.product.hardware.sku",
                &format!("androidboot.product.hardware.sku = \"{name}\""),
            )
        });
    }

    let set = |file: &str| {
        if fsx::is_file(file) {
            tools::susfs(&["set_cmdline_or_bootconfig", file], Out::Inherit);
        }
    };
    set(&mnt_cmdline);
    set(&mnt_bootconfig);
}

fn replace_spaced_assign(text: &str, key: &str, val: &str, repl: &str) -> String {
    let mut out = String::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if text[i..].starts_with(key) {
            let mut j = i + key.len();
            let after_key = j;
            while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                j += 1;
            }
            if j < b.len() && b[j] == b'=' {
                j += 1;
                while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                    j += 1;
                }
                if text[j..].starts_with(val) {
                    out.push_str(repl);
                    i = j + val.len();
                    continue;
                }
            }
            let _ = after_key;
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn replace_spaced_any(text: &str, key: &str, repl: &str) -> String {
    let mut out = String::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if text[i..].starts_with(key) {
            let mut j = i + key.len();
            while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                j += 1;
            }
            if j < b.len() && b[j] == b'=' {
                j += 1;
                while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                    j += 1;
                }
                if j < b.len() && b[j] == b'"' {
                    let mut k = j + 1;
                    while k < b.len() && b[k] != b'"' {
                        k += 1;
                    }
                    if k < b.len() {
                        out.push_str(repl);
                        i = k + 1;
                        continue;
                    }
                }
            }
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn replace_assign_nospace(text: &str, key: &str, repl: &str) -> String {
    let needle = format!("{key}=");
    let Some(pos) = text.find(&needle) else { return text.to_string() };
    let rest = &text[pos + needle.len()..];
    let end = rest.find(' ').map(|e| pos + needle.len() + e).unwrap_or(text.len());
    format!("{}{}{}", &text[..pos], repl, &text[end..])
}

fn ksu_mount_targets() -> Vec<String> {
    let text = std::fs::read_to_string("/proc/1/mountinfo").unwrap_or_default();
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(sep) = line.find(" - ") else { continue };
        let pre = &line[..sep];
        let post = &line[sep + 3..];
        let a: Vec<&str> = text::words(pre);
        let b: Vec<&str> = text::words(post);
        let root = a.get(3).copied().unwrap_or("");
        let target = a.get(4).copied().unwrap_or("");
        let source = b.get(1).copied().unwrap_or("");
        if source == "KSU" || target.starts_with("/data/adb/modules") || root.starts_with("/adb/modules/") {
            out.push(target.to_string());
        }
    }
    out
}

fn has_line(file: &str, needle: &str) -> bool {
    fsx::read_lines(file).unwrap_or_default().iter().any(|l| l == needle)
}

fn file_contains(file: &str, needle: &str) -> bool {
    std::fs::read_to_string(file).is_ok_and(|t| t.contains(needle))
}

fn count_matching_lines(text: &str, needles: &[&str]) -> usize {
    text.lines()
        .filter(|l| {
            let low = l.to_ascii_lowercase();
            needles.iter().any(|n| low.contains(n))
        })
        .count()
}

fn wait_for(path: &str, max: i32) {
    let mut count = 0;
    while !fsx::is_dir(path) && count < max {
        tools::nap(1);
        count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_objects_and_pairs() {
        let j = "[\n  {\n    \"path\": \"/x\",\n    \"ino\": \"12\"\n  },\n  {\n    \"path\": \"\",\n    \"ino\": \"3\"\n  }\n]";
        let objs = brace_objects(j);
        assert_eq!(objs.len(), 2);
        let p = extract_pairs(&objs[0]);
        assert_eq!(p[0], ("path".to_string(), "/x".to_string()));
        assert_eq!(p[1], ("ino".to_string(), "12".to_string()));
    }

    #[test]
    fn first_key_wins() {
        let p = extract_pairs("{ \"ino\": \"1\", \"ino\": \"2\" }");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].1, "1");
    }

    #[test]
    fn cmdline_rewrites() {
        assert_eq!(
            replace_assign_nospace("a androidboot.hwname=a15x b", "androidboot.hwname", "androidboot.hwname=NEW"),
            "a androidboot.hwname=NEW b"
        );
        assert_eq!(
            replace_spaced_assign(
                "x androidboot.warranty_bit = \"1\" y",
                "androidboot.warranty_bit",
                "\"1\"",
                "androidboot.warranty_bit = \"0\""
            ),
            "x androidboot.warranty_bit = \"0\" y"
        );
        assert_eq!(
            replace_spaced_any(
                "a androidboot.hwname = \"old\" b",
                "androidboot.hwname",
                "androidboot.hwname = \"NEW\""
            ),
            "a androidboot.hwname = \"NEW\" b"
        );
    }

    #[test]
    fn mount_scan() {
        assert!(exclude_matcher(".(apk|jar)|/vendor/bin/hw/")("/system/app/x.apk"));
        assert!(exclude_matcher(".(apk|jar)|/vendor/bin/hw/")("/vendor/bin/hw/svc"));
        assert!(!exclude_matcher(".(apk|jar)|/vendor/bin/hw/")("/system/lib/x.so"));
    }
}
