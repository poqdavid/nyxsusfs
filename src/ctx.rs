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
    pub patch: String,
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
            patch: field(3),
        }
    }

    pub fn query() -> Self {
        Self::parse(&tools::capture(tools::SUSFS_BIN, &["show", "version"]))
    }

    pub fn main_ge(&self, n: i64) -> bool {
        text::ge(&self.main, n)
    }

    pub fn v15_at_least(&self, p: i64) -> bool {
        !self.raw.is_empty() && text::ge(&self.main, 1) && text::ge(&self.sub, 5) && text::ge(&self.patch, p)
    }

    pub fn v15_or_v2(&self, p: i64) -> bool {
        self.v15_at_least(p) || self.main_ge(2)
    }
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
        assert_eq!((v.main.as_str(), v.sub.as_str(), v.patch.as_str()), ("2", "3", "0"));
        assert!(v.main_ge(2) && !v.v15_at_least(3) && v.v15_or_v2(9));
        let v = Version::parse("v1.5.12");
        assert!(v.v15_at_least(9) && !v.main_ge(2));
        let v = Version::parse("");
        assert!(!v.main_ge(0) && !v.v15_or_v2(0));
        let v = Version::parse("v2");
        assert_eq!((v.main.as_str(), v.sub.as_str(), v.patch.as_str()), ("2", "2", "2"));
    }
}
