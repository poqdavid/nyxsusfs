use std::env;
use std::ffi::CString;
use std::path::Path;
use std::process::{Command, Stdio};

pub const KSU_BIN_DIR: &str = "/data/adb/ksu/bin";
pub const SUSFS_BIN: &str = "/data/adb/ksu/bin/ksu_susfs";
pub const KSUD: &str = "/data/adb/ksu/bin/ksud";
const KSU_BUSYBOX: &str = "/data/adb/ksu/bin/busybox";

pub fn prepend_ksu_path() {
    let old = env::var("PATH").unwrap_or_default();
    let new = if old.is_empty() {
        KSU_BIN_DIR.to_string()
    } else {
        format!("{KSU_BIN_DIR}:{old}")
    };
    env::set_var("PATH", new);
}

#[derive(Clone, Copy)]
pub enum Out {
    Inherit,
    Null,
}

fn command(prog: &str, args: &[&str]) -> Command {
    let mut c = Command::new(prog);
    c.args(args);
    c
}

pub fn run_cmd(mut c: Command, out: Out) -> bool {
    if let Out::Null = out {
        c.stdout(Stdio::null());
    }
    c.status().is_ok_and(|s| s.success())
}

pub fn run(prog: &str, args: &[&str], out: Out) -> bool {
    run_cmd(command(prog, args), out)
}

pub fn capture_cmd(mut c: Command) -> String {
    c.stdout(Stdio::piped());
    match c.output() {
        Ok(o) => crate::text::strip_newlines(String::from_utf8_lossy(&o.stdout).into_owned()),
        Err(_) => String::new(),
    }
}

pub fn capture(prog: &str, args: &[&str]) -> String {
    capture_cmd(command(prog, args))
}

pub fn output(prog: &str, args: &[&str]) -> (bool, String) {
    let mut c = command(prog, args);
    c.stdout(Stdio::piped());
    match c.output() {
        Ok(o) => (
            o.status.success(),
            crate::text::strip_newlines(String::from_utf8_lossy(&o.stdout).into_owned()),
        ),
        Err(_) => (false, String::new()),
    }
}

pub fn capture_ok(prog: &str, args: &[&str]) -> Option<String> {
    match output(prog, args) {
        (true, out) => Some(out),
        _ => None,
    }
}

pub fn susfs(args: &[&str], out: Out) -> bool {
    run(SUSFS_BIN, args, out)
}

pub fn ksud(args: &[&str]) -> bool {
    run(KSUD, args, Out::Inherit)
}

pub fn applet(name: &str, args: &[&str]) -> Command {
    if Path::new(KSU_BUSYBOX).exists() {
        let mut c = Command::new(KSU_BUSYBOX);
        c.arg(name).args(args);
        c
    } else {
        command(name, args)
    }
}

pub fn dmesg() -> String {
    capture_cmd(applet("dmesg", &[]))
}

pub fn getprop(name: &str) -> String {
    capture("getprop", &[name])
}

pub fn rp_get(name: &str) -> String {
    match env::var("NYX_RP_BIN") {
        Ok(bin) if !bin.is_empty() => {
            let mut c = command(&bin, &[name]);
            c.stderr(Stdio::null());
            capture_cmd(c)
        }
        _ => {
            let mut c = command("resetprop", &[name]);
            c.stderr(Stdio::null());
            capture_cmd(c)
        }
    }
}

extern "C" {
    fn access(path: *const std::os::raw::c_char, mode: std::os::raw::c_int) -> std::os::raw::c_int;
}

pub fn nap(secs: u64) {
    if std::env::var_os("NYX_NO_SLEEP").is_none() {
        std::thread::sleep(std::time::Duration::from_secs(secs));
    }
}

pub fn writable(path: &str) -> bool {
    match CString::new(path) {
        Ok(c) => unsafe { access(c.as_ptr(), 2) == 0 },
        Err(_) => false,
    }
}
