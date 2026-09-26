pub fn int(s: &str) -> Option<i64> {
    let t = s.trim_matches(|c| c == ' ' || c == '\t' || c == '\n');
    let digits = t.strip_prefix(['-', '+']).unwrap_or(t);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    t.parse().ok()
}

pub fn ge(s: &str, n: i64) -> bool {
    int(s).is_some_and(|v| v >= n)
}

pub fn lt(s: &str, n: i64) -> bool {
    int(s).is_some_and(|v| v < n)
}

pub fn words(s: &str) -> Vec<&str> {
    s.split([' ', '\t', '\n']).filter(|w| !w.is_empty()).collect()
}

pub fn word_eq(s: &str, v: &str) -> bool {
    matches!(words(s).as_slice(), [w] if *w == v)
}

pub fn word_ge(s: &str, n: i64) -> bool {
    matches!(words(s).as_slice(), [w] if ge(w, n))
}

pub fn word_gt(s: &str, n: i64) -> bool {
    matches!(words(s).as_slice(), [w] if int(w).is_some_and(|v| v > n))
}

pub fn word_lt(s: &str, n: i64) -> bool {
    matches!(words(s).as_slice(), [w] if lt(w, n))
}

pub fn trim(line: &str) -> &str {
    line.trim_matches(|c| c == ' ' || c == '\t' || c == '\n')
}

pub fn column(line: &str, n: usize) -> &str {
    line.split([' ', '\t']).filter(|f| !f.is_empty()).nth(n - 1).unwrap_or("")
}

pub fn field(line: &str, d: char, n: usize) -> &str {
    if !line.contains(d) {
        return line;
    }
    line.split(d).nth(n - 1).unwrap_or("")
}

pub fn strip_newlines(mut s: String) -> String {
    while s.ends_with('\n') {
        s.pop();
    }
    s
}

pub fn lines(s: &str) -> std::str::Split<'_, char> {
    s.split('\n')
}

pub fn icontains(hay: &str, needle: &str) -> bool {
    hay.to_ascii_lowercase().contains(&needle.to_ascii_lowercase())
}

fn re_lite_at(text: &[char], pat: &[char]) -> Option<usize> {
    let mut ti = 0;
    let mut pi = 0;
    while pi < pat.len() {
        let (pc, wildcard) = match pat[pi] {
            '\\' if pi + 1 < pat.len() => {
                pi += 1;
                (pat[pi], false)
            }
            '.' => ('.', true),
            c => (c, false),
        };
        if ti >= text.len() || (!wildcard && text[ti] != pc) {
            return None;
        }
        ti += 1;
        pi += 1;
    }
    Some(ti)
}

pub fn re_lite_prefix(text: &str, pat: &str) -> bool {
    let t: Vec<char> = text.chars().collect();
    let p: Vec<char> = pat.chars().collect();
    re_lite_at(&t, &p).is_some()
}

pub fn re_lite_contains(text: &str, pat: &str) -> bool {
    let t: Vec<char> = text.chars().collect();
    let p: Vec<char> = pat.chars().collect();
    (0..=t.len()).any(|i| re_lite_at(&t[i..], &p).is_some())
}

pub fn glob_match(pat: &str, name: &str, fold: bool) -> bool {
    let (p, n): (Vec<char>, Vec<char>) = if fold {
        (
            pat.to_ascii_lowercase().chars().collect(),
            name.to_ascii_lowercase().chars().collect(),
        )
    } else {
        (pat.chars().collect(), name.chars().collect())
    };
    let (mut pi, mut ni) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ints_parse_strictly() {
        assert_eq!(int("2"), Some(2));
        assert_eq!(int(" -1 "), Some(-1));
        assert_eq!(int("+5"), Some(5));
        assert_eq!(int(""), None);
        assert_eq!(int("2.3"), None);
        assert_eq!(int("0-r1"), None);
        assert!(!ge("", 2));
    }

    #[test]
    fn single_word_comparisons() {
        assert!(word_eq("1", "1"));
        assert!(!word_eq("", "1"));
        assert!(!word_eq("1 1", "1"));
        assert!(word_ge(" 3", 1));
        assert!(!word_ge("abc", 1));
    }

    #[test]
    fn field_without_delimiter_is_whole_line() {
        assert_eq!(field("2", '.', 2), "2");
        assert_eq!(field("2.3.0", '.', 2), "3");
        assert_eq!(field("2.3", '.', 3), "");
        assert_eq!(field("package:com.x", ':', 2), "com.x");
    }

    #[test]
    fn columns_and_trim() {
        assert_eq!(column("  a \tb  c", 2), "b");
        assert_eq!(column("a", 3), "");
        assert_eq!(trim("  /x y  "), "/x y");
    }

    #[test]
    fn regex_lite() {
        assert!(re_lite_prefix("101.000001] x", "101.000001"));
        assert!(re_lite_prefix("101X000001] x", "101.000001"));
        assert!(re_lite_contains("a androidboot.hwname=x", "androidboot.hwname"));
    }

    #[test]
    fn globs() {
        assert!(glob_match("*gapps*xml", "google-GAPPS.XML", true));
        assert!(!glob_match("*gapps*xml", "google-GAPPS.XML", false));
        assert!(glob_match("*.so", "lib.so", false));
        assert!(glob_match("*framework-res.apk", "Pixel-framework-res.apk", true));
        assert!(!glob_match("*.rc", "x.rcx", true));
    }
}
