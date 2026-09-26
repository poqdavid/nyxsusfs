pub fn is_susfs_line(line: &str) -> bool {
    let l = line.to_ascii_lowercase();
    l.contains("susfs_auto_add") || l.contains("ksu_susfs") || l.contains("susfs:")
}

pub fn susfs_lines(snapshot: &str) -> Vec<&str> {
    crate::text::lines(snapshot).filter(|l| is_susfs_line(l)).collect()
}

pub fn from_marker<'a>(snapshot: &'a str, marker: &str) -> Vec<&'a str> {
    let lines: Vec<&str> = crate::text::lines(snapshot).collect();
    let start = lines.iter().position(|l| match l.strip_prefix('[') {
        Some(rest) => crate::text::re_lite_prefix(rest.trim_start_matches(' '), marker),
        None => false,
    });
    match start {
        Some(i) => lines[i..].to_vec(),
        None => Vec::new(),
    }
}

pub fn endmsg(snapshot: &str) -> String {
    let mut last = String::new();
    for line in crate::text::lines(snapshot) {
        let Some(rest) = line.strip_prefix('[') else { continue };
        if !rest.trim_start_matches(' ').starts_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        let f = crate::text::field(line, ']', 1);
        let f = f.strip_prefix('[').unwrap_or(f).trim_start_matches(' ');
        last = crate::text::field(f, ' ', 1).to_string();
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAP: &str =
        "[    0.000000] boot\n[    1.234567] susfs: init\nno bracket susfs: x\n[   12.345678] SUSFS: upper\n[  101.000001] susfs: marker 1";

    #[test]
    fn picks_susfs_lines() {
        assert_eq!(
            susfs_lines(SNAP),
            vec![
                "[    1.234567] susfs: init",
                "no bracket susfs: x",
                "[   12.345678] SUSFS: upper",
                "[  101.000001] susfs: marker 1"
            ]
        );
    }

    #[test]
    fn endmsg_is_last_timestamp() {
        assert_eq!(endmsg(SNAP), "101.000001");
        assert_eq!(endmsg(""), "");
    }

    #[test]
    fn range_from_marker() {
        assert_eq!(from_marker(SNAP, "12.345678").len(), 2);
        assert_eq!(from_marker(SNAP, "0").len(), 5);
        assert!(from_marker(SNAP, "99").is_empty());
        assert_eq!(from_marker(SNAP, "").len(), 5);
    }
}
