mod config;
mod ctx;
mod dmesg;
mod fsx;
mod hide;
mod stages;
mod text;
mod tools;

use std::path::Path;
use std::process::ExitCode;

const MODDIR_FALLBACK: &str = "/data/adb/modules/nyxsusfs";

fn moddir(argv0: &str) -> String {
    let p = Path::new(argv0);
    match p.parent().and_then(Path::parent) {
        Some(d) if !d.as_os_str().is_empty() && p.parent().is_some_and(|b| b.ends_with("bin")) => d.to_string_lossy().into_owned(),
        _ => MODDIR_FALLBACK.to_string(),
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: nyxsusfs stage <post-fs-data|post-mount|service|boot-completed>\n       nyxsusfs --version");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    tools::prepend_ksu_path();
    let argv0 = args.first().map(String::as_str).unwrap_or("");
    let moddir = moddir(argv0);
    match (args.get(1).map(String::as_str), args.get(2).map(String::as_str)) {
        (Some("--version"), _) => {
            println!("nyxsusfs {}", option_env!("NYX_MODULE_VERSION").unwrap_or("unknown"));
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("boot-completed")) => {
            stages::boot_completed::run(&moddir);
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("post-fs-data")) => {
            stages::post_fs_data::run(&moddir);
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("post-mount")) => {
            stages::post_mount::run();
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("service")) => {
            stages::service::run(&moddir);
            ExitCode::SUCCESS
        }
        _ => usage(),
    }
}

#[cfg(test)]
mod tests {
    use super::moddir;

    #[test]
    fn moddir_from_binary_path() {
        assert_eq!(moddir("/data/adb/modules/nyxsusfs/bin/nyxsusfs"), "/data/adb/modules/nyxsusfs");
        assert_eq!(
            moddir("/data/adb/modules_update/nyxsusfs/bin/nyxsusfs"),
            "/data/adb/modules_update/nyxsusfs"
        );
        assert_eq!(moddir("nyxsusfs"), "/data/adb/modules/nyxsusfs");
    }
}
