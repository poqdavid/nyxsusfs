use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

pub fn append_line(path: &str, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(format!("{line}\n").as_bytes());
    }
}

pub fn append_lines<S: AsRef<str>>(path: &str, lines: &[S]) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let mut buf = String::new();
        for l in lines {
            buf.push_str(l.as_ref());
            buf.push('\n');
        }
        let _ = f.write_all(buf.as_bytes());
    }
}

pub fn write_lines<S: AsRef<str>>(path: &str, lines: &[S]) {
    if let Ok(mut f) = File::create(path) {
        let mut buf = String::new();
        for l in lines {
            buf.push_str(l.as_ref());
            buf.push('\n');
        }
        let _ = f.write_all(buf.as_bytes());
    }
}

pub fn touch(path: &str) -> bool {
    OpenOptions::new().create(true).append(true).open(path).is_ok()
}

pub fn rm_f(path: &str) {
    let _ = fs::remove_file(path);
}

pub fn mkdir_p(path: &str) {
    let _ = fs::create_dir_all(path);
}

pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

pub fn is_file(path: &str) -> bool {
    Path::new(path).is_file()
}

pub fn is_dir(path: &str) -> bool {
    Path::new(path).is_dir()
}

pub fn basename(path: &str) -> &str {
    let t = path.trim_end_matches('/');
    t.rsplit('/').next().unwrap_or(t)
}

pub fn read_lines(path: &str) -> Option<Vec<String>> {
    let text = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&text);
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    if text.ends_with('\n') || text.is_empty() {
        lines.pop();
    }
    Some(lines)
}

pub fn read_lines_bytes(path: &str) -> Option<Vec<Vec<u8>>> {
    let raw = fs::read(path).ok()?;
    let mut lines: Vec<Vec<u8>> = raw.split(|b| *b == b'\n').map(<[u8]>::to_vec).collect();
    if raw.ends_with(b"\n") || raw.is_empty() {
        lines.pop();
    }
    Some(lines)
}

pub fn write_lines_bytes(path: &str, lines: &[&Vec<u8>]) {
    if let Ok(mut f) = File::create(path) {
        let mut buf = Vec::new();
        for l in lines {
            buf.extend_from_slice(l);
            buf.push(b'\n');
        }
        let _ = f.write_all(&buf);
    }
}

pub fn read_terminated_lines(path: &str) -> Option<Vec<String>> {
    let raw = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    lines.pop();
    Some(lines)
}

pub fn lines_without_hash(path: &str) -> Option<Vec<String>> {
    read_lines(path).map(|ls| ls.into_iter().filter(|l| !l.contains('#')).collect())
}

pub fn edit_lines(path: &str, edit: impl Fn(&str) -> String) {
    let Ok(raw) = fs::read(path) else { return };
    let text = String::from_utf8_lossy(&raw);
    let trailing = text.ends_with('\n');
    let mut lines: Vec<&str> = text.split('\n').collect();
    if trailing {
        lines.pop();
    }
    let mut out: Vec<String> = lines.iter().map(|l| edit(l)).collect::<Vec<_>>();
    let mut joined = out.join("\n");
    if trailing {
        joined.push('\n');
    }
    out.clear();
    if let Ok(mut f) = OpenOptions::new().write(true).truncate(true).open(path) {
        let _ = f.write_all(joined.as_bytes());
    }
}

pub fn glob_star(dir: &str) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort();
    names.into_iter().map(|n| format!("{dir}/{n}")).collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    File,
    Dir,
    Other,
}

pub struct Found<'a> {
    pub path: &'a str,
    pub name: &'a str,
    pub kind: Kind,
}

pub fn find(roots: &[&str], maxdepth: Option<usize>, mut pred: impl FnMut(&Found) -> bool) -> Vec<String> {
    let mut out = Vec::new();
    for root in roots {
        walk(root, 0, maxdepth, &mut pred, &mut out);
    }
    out
}

fn kind_of(m: &fs::Metadata) -> Kind {
    let t = m.file_type();
    if t.is_file() {
        Kind::File
    } else if t.is_dir() {
        Kind::Dir
    } else {
        Kind::Other
    }
}

fn walk(path: &str, depth: usize, maxdepth: Option<usize>, pred: &mut impl FnMut(&Found) -> bool, out: &mut Vec<String>) {
    let Ok(meta) = fs::symlink_metadata(path) else { return };
    let kind = kind_of(&meta);
    if pred(&Found {
        path,
        name: basename(path),
        kind,
    }) {
        out.push(path.to_string());
    }
    if kind != Kind::Dir || maxdepth.is_some_and(|m| depth >= m) {
        return;
    }
    let Ok(rd) = fs::read_dir(path) else { return };
    for e in rd.flatten() {
        let child = format!("{}/{}", path, e.file_name().to_string_lossy());
        walk(&child, depth + 1, maxdepth, pred, out);
    }
}

pub fn sus_kstat_fields(path: &str) -> Vec<String> {
    match fs::symlink_metadata(path) {
        Ok(m) => vec![
            m.ino().to_string(),
            m.dev().to_string(),
            "default".into(),
            "default".into(),
            m.atime().to_string(),
            "0".into(),
            m.mtime().to_string(),
            "0".into(),
            m.ctime().to_string(),
            "0".into(),
            m.blocks().to_string(),
            "512".into(),
        ],
        Err(_) => Vec::new(),
    }
}

pub fn clone_mode_owner(to: &str, from: &str) {
    let Ok(m) = fs::symlink_metadata(from) else { return };
    let _ = fs::set_permissions(to, fs::Permissions::from_mode(m.mode() & 0o7777));
    let _ = std::os::unix::fs::chown(to, Some(m.uid()), Some(m.gid()));
}
