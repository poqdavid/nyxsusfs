use crate::config::Vars;
use crate::ctx::{self, Ctx, Version, CONFIG, PERSISTENT_DIR, TMP_DIR};
use crate::fsx;
use crate::text;
use crate::tools;
use std::os::unix::fs::MetadataExt;
use std::process::ExitCode;

pub const LIST: &str = "priority_uid_filter.txt";
const APP_UIDS: std::ops::RangeInclusive<u32> = 10000..=19999;
const MAX_ARG: usize = 65534;

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Off,
    Empty,
    Applied(usize),
    NoBinary,
    Unsupported,
    Failed,
}

pub fn status_path() -> String {
    format!("{TMP_DIR}/priority_uid_filter")
}

pub fn enabled(c: &Ctx) -> bool {
    matches!(c.var("priority_uid_filter"), "1" | "2")
}

pub fn command(moddir: &str) -> ExitCode {
    let mut vars = Vars::with_defaults(&[("priority_uid_filter", "0")]);
    if fsx::is_file(CONFIG) {
        vars.source(CONFIG);
    }
    let c = Ctx::new(moddir, Version::query(), ctx::features(), vars);
    if let Some(why) = c.version.unsupported() {
        println!("state=susfs\ndetail={why}");
        return ExitCode::FAILURE;
    }
    let outcome = apply(&c, "webui");
    if outcome == Outcome::Off {
        println!("state=off");
    } else {
        for l in fsx::read_lines(&status_path()).unwrap_or_default() {
            println!("{l}");
        }
    }
    if matches!(outcome, Outcome::Off | Outcome::Empty | Outcome::Applied(_)) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

pub fn wait_unlocked() -> bool {
    for _ in 0..450 {
        if tools::getprop("sys.user.0.ce_available") == "true" || fsx::is_dir("/data/data/android") {
            return true;
        }
        tools::nap(2);
    }
    false
}

pub fn apply(c: &Ctx, tag: &str) -> Outcome {
    let wanted = match c.var("priority_uid_filter") {
        "1" => list_file(),
        "2" => user_apps(),
        _ => {
            fsx::rm_f(&status_path());
            return Outcome::Off;
        }
    };

    let mut kept: Vec<String> = Vec::new();
    let mut skipped = 0;
    let mut len = 0;
    for pkg in wanted {
        if kept.contains(&pkg) {
            continue;
        }
        let reason = if !valid_name(&pkg) {
            Some("not a package name".to_string())
        } else {
            match data_uid(&pkg) {
                None => Some("not installed".to_string()),
                Some(uid) if !APP_UIDS.contains(&uid) => Some(format!("uid {uid} is not an app uid")),
                Some(_) if len + pkg.len() + 1 > MAX_ARG => Some("list too long".to_string()),
                Some(_) => None,
            }
        };
        if let Some(reason) = reason {
            skipped += 1;
            c.log1(&format!("[priority_uid_filter skipped]: nyxsusfs/{tag} {pkg} ({reason})"));
            continue;
        }
        len += pkg.len() + 1;
        kept.push(pkg);
    }

    let outcome = if kept.is_empty() {
        c.log1(&format!("[priority_uid_filter]: nyxsusfs/{tag} no installed apps to hide"));
        Outcome::Empty
    } else if !binary_has_filter() {
        c.log1(&format!(
            "[priority_uid_filter failed]: nyxsusfs/{tag} the installed ksu_susfs has no set_priority_uid_filter"
        ));
        Outcome::NoBinary
    } else {
        let (ok, out) = tools::output(tools::SUSFS_BIN, &["set_priority_uid_filter", &kept.join(",")]);
        if ok {
            for pkg in &kept {
                c.log1(&format!("[priority_uid_filter]: nyxsusfs/{tag} {pkg}"));
            }
            Outcome::Applied(kept.len())
        } else if out.contains("not supported") {
            c.log1(&format!(
                "[priority_uid_filter failed]: nyxsusfs/{tag} the kernel's SuSFS has no priority uid filter"
            ));
            Outcome::Unsupported
        } else {
            c.log1(&format!("[priority_uid_filter failed]: nyxsusfs/{tag} {}", text::trim(&out)));
            Outcome::Failed
        }
    };
    write_status(&outcome, skipped, tag);
    outcome
}

fn write_status(outcome: &Outcome, skipped: usize, tag: &str) {
    let (state, apps) = match outcome {
        Outcome::Off => return,
        Outcome::Empty => ("empty", 0),
        Outcome::Applied(n) => ("applied", *n),
        Outcome::NoBinary => ("nobinary", 0),
        Outcome::Unsupported => ("unsupported", 0),
        Outcome::Failed => ("failed", 0),
    };
    fsx::write_lines(
        &status_path(),
        &[
            format!("state={state}"),
            format!("apps={apps}"),
            format!("skipped={skipped}"),
            format!("from={tag}"),
        ],
    );
}

fn list_file() -> Vec<String> {
    fsx::read_terminated_lines(&format!("{PERSISTENT_DIR}/{LIST}"))
        .unwrap_or_default()
        .iter()
        .map(|l| text::column(text::trim(l), 1).to_string())
        .filter(|p| !p.is_empty() && !p.starts_with('#'))
        .collect()
}

fn user_apps() -> Vec<String> {
    tools::capture("pm", &["list", "packages", "-3"])
        .split('\n')
        .map(|l| text::trim(text::field(l, ':', 2)).to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

fn valid_name(pkg: &str) -> bool {
    !pkg.is_empty()
        && pkg.len() <= 255
        && pkg != "."
        && pkg != ".."
        && pkg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
}

fn data_uid(pkg: &str) -> Option<u32> {
    let m = std::fs::metadata(format!("/data/data/{pkg}")).ok()?;
    m.is_dir().then_some(m.uid())
}

fn binary_has_filter() -> bool {
    tools::output(tools::SUSFS_BIN, &[])
        .1
        .lines()
        .any(|l| l.starts_with(' ') && text::words(l).first() == Some(&"set_priority_uid_filter"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_names_match_the_kernel() {
        for ok in ["com.termux", "org.frknkrc44.hma_oss", "a", "A_B.9"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", ".", "..", "com/evil", "com.x y", "com,x", "../../etc", &"a".repeat(256)] {
            assert!(!valid_name(bad), "{bad}");
        }
    }
}
