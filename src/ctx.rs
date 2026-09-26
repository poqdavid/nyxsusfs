use crate::config::Vars;
use crate::fsx;
use crate::text;
use crate::tools::{self, Out};

pub const PERSISTENT_DIR: &str = "/data/adb/nyxsusfs";
pub const TMP_DIR: &str = "/data/adb/ksu/nyxsusfs";
pub const LOG_DIR: &str = "/data/adb/ksu/nyxsusfs/logs";
pub const LOG: &str = "/data/adb/ksu/nyxsusfs/logs/susfs.log";
pub const LOG1: &str = "/data/adb/ksu/nyxsusfs/logs/susfs1.log";
pub const STAGE_TIME: &str = "/data/adb/ksu/nyxsusfs/logs/boot_stage_time.sh";
pub const CONFIG: &str = "/data/adb/nyxsusfs/config.sh";

#[derive(Clone, Default)]
pub struct Version {
    pub raw: String,
    pub main: String,
    pub sub: String,
}

impl Version {
    pub fn parse(raw: &str) -> Self {
        let field = |n: usize| -> String {
            let parts: Vec<String> = text::lines(raw)
                .map(|l| text::field(l.strip_prefix('v').unwrap_or(l), '.', n).to_string())
                .collect();
            text::strip_newlines(parts.join("\n"))
        };
        Version {
            raw: raw.to_string(),
            main: field(1),
            sub: field(2),
        }
    }

    pub fn query() -> Self {
        let out = tools::capture_ok(tools::SUSFS_BIN, &["show", "version"]).unwrap_or_default();
        Self::parse(if is_version(&out) { &out } else { "" })
    }

    pub fn supported(&self) -> bool {
        text::int(&self.main).is_some_and(|m| m > 2 || (m == 2 && text::ge(&self.sub, 1)))
    }

    pub fn unsupported(&self) -> Option<String> {
        if self.supported() {
            None
        } else if self.raw.is_empty() {
            Some("no SuSFS detected".to_string())
        } else {
            Some(format!("SuSFS {} is not supported (needs v2.1.0+)", self.raw))
        }
    }
}

fn is_version(out: &str) -> bool {
    let s = out.trim();
    let s = s.strip_prefix('v').unwrap_or(s);
    let mut parts = s.split('.');
    let num = |p: Option<&str>| p.is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    !s.contains('\n') && num(parts.next()) && num(parts.next())
}

pub fn features() -> String {
    tools::capture_ok(tools::SUSFS_BIN, &["show", "enabled_features"])
        .map(|out| {
            out.lines()
                .map(str::trim)
                .filter(|l| l.starts_with("CONFIG_KSU_SUSFS"))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

pub struct Ctx {
    pub moddir: String,
    pub version: Version,
    pub features: String,
    pub vars: Vars,
    pub mntfolder: Option<String>,
}

impl Ctx {
    pub fn new(moddir: &str, version: Version, features: String, vars: Vars) -> Self {
        let mut mntfolder = None;
        if tools::writable("/mnt") {
            mntfolder = Some("/mnt/nyxsusfs".to_string());
        }
        if tools::writable("/mnt/vendor") {
            mntfolder = Some("/mnt/vendor/nyxsusfs".to_string());
        }
        Ctx {
            moddir: moddir.to_string(),
            version,
            features,
            vars,
            mntfolder,
        }
    }

    pub fn feature(&self, name: &str) -> bool {
        self.features.contains(name)
    }

    pub fn var(&self, name: &str) -> &str {
        self.vars.get(name)
    }

    pub fn mnt(&self, name: &str) -> String {
        format!("{}/{}", self.mntfolder.as_deref().unwrap_or(""), name)
    }

    pub fn log1(&self, line: &str) {
        fsx::append_line(LOG1, line);
    }

    pub fn susfs_log(&self, args: &[&str], line: &str) -> bool {
        let ok = tools::susfs(args, Out::Inherit);
        if ok {
            self.log1(line);
        }
        ok
    }

    pub fn ksud_log(&self, args: &[&str], line: &str) -> bool {
        let ok = tools::ksud(args);
        if ok {
            self.log1(line);
        }
        ok
    }
}

pub fn kernel_log_checkpoint(since: &str, stage_key: &str) -> String {
    let snapshot = tools::dmesg();
    let lines: Vec<&str> = crate::dmesg::from_marker(&snapshot, since)
        .into_iter()
        .filter(|l| crate::dmesg::is_susfs_line(l))
        .collect();
    fsx::append_lines(LOG, &lines);
    let end = crate::dmesg::endmsg(&snapshot);
    fsx::append_line(STAGE_TIME, &format!("{stage_key}={end}"));
    end
}

pub fn stage_marker(key: &str) -> String {
    let mut v = Vars::with_defaults(&[(key, "0")]);
    if fsx::is_file(STAGE_TIME) {
        v.source(STAGE_TIME);
    }
    v.get(key).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_fields() {
        let v = Version::parse("v2.3.0");
        assert_eq!((v.main.as_str(), v.sub.as_str()), ("2", "3"));
        let v = Version::parse("v2");
        assert_eq!((v.main.as_str(), v.sub.as_str()), ("2", "2"));
    }

    #[test]
    fn supported_versions() {
        for raw in ["v2.1.0", "v2.3.0", "v2.10.1", "v3.0.0", "2.1.0"] {
            assert!(Version::parse(raw).supported(), "{raw}");
            assert_eq!(Version::parse(raw).unsupported(), None, "{raw}");
        }
        for raw in ["v2.0.0", "v1.5.12", "v1.5.2", ""] {
            assert!(!Version::parse(raw).supported(), "{raw}");
        }
        assert_eq!(
            Version::parse("v2.0.0").unsupported().as_deref(),
            Some("SuSFS v2.0.0 is not supported (needs v2.1.0+)")
        );
        assert_eq!(Version::parse("").unsupported().as_deref(), Some("no SuSFS detected"));
    }

    #[test]
    fn version_output() {
        for out in ["v2.3.0", "v2.1.0\n", "2.1.0", "v2.3.0-dev"] {
            assert!(is_version(out), "{out}");
        }
        for out in [
            "",
            "[-] CMD: '0x555e1', SUSFS operation not supported, please enable it in kernel",
            "v2",
            "v2.3.0\nv2.3.0",
            "unknown",
        ] {
            assert!(!is_version(out), "{out}");
        }
    }
}
