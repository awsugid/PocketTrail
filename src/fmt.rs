//! Pure formatting helpers, testable natively.

/// Format minor units per the UI contract: `Rp 15.000.000` (100 minor = 1 IDR,
/// dot thousands grouping). Nonzero fractions render as `,xx` (lossless).
pub fn fmt_money(minor: i64) -> String {
    let neg = minor < 0;
    let abs = minor.unsigned_abs();
    let whole = abs / 100;
    let frac = (abs % 100) as u32;
    let digits = whole.to_string();
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(c);
    }
    let sign = if neg { "-" } else { "" };
    if frac == 0 {
        format!("{sign}Rp {grouped}")
    } else {
        format!("{sign}Rp {grouped},{frac:0>2}")
    }
}

/// Epoch milliseconds -> "YYYY-MM-DD HH:MM" in UTC+7 (Jakarta, no DST).
// ponytail: fixed +07:00 offset; revisit only if another org timezone is needed.
pub fn fmt_ts(ms: i64) -> String {
    let secs = ms.div_euclid(1000) + 7 * 3600;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:0>4}-{:0>2}-{:0>2} {:0>2}:{:0>2}",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60
    )
}

/// Days since 1970-01-01 -> (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Strict integer parser for form amounts (minor units): optional leading `-`,
/// digits only, fits i64, magnitude under 9e15.
pub const MAX_SAFE_MINOR: i64 = 9_000_000_000_000_000;

pub fn parse_minor(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() || t.len() > 17 {
        return None;
    }
    let (neg, digits) = match t.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, t),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits
        .parse::<i64>()
        .ok()
        .filter(|v| *v <= MAX_SAFE_MINOR)
        .map(|v| if neg { -v } else { v })
}

/// Form-facing IDR amount to exact integer minor units; no floating point.
/// English number inputs use a decimal point and no grouping separators.
pub fn parse_rupiah(s: &str) -> Option<i64> {
    let text = s.trim();
    let (negative, digits) = text
        .strip_prefix('-')
        .map(|n| (true, n))
        .unwrap_or((false, text));
    let mut pieces = digits.split('.');
    let whole = pieces.next()?;
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let fraction = pieces.next().unwrap_or("");
    if pieces.next().is_some()
        || fraction.len() > 2
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole = whole.parse::<i64>().ok()?;
    let cents = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 10,
        _ => fraction.parse::<i64>().ok()?,
    };
    let value = whole.checked_mul(100)?.checked_add(cents)?;
    (value <= MAX_SAFE_MINOR).then_some(if negative { -value } else { value })
}

pub fn rupiah_input(minor: i64) -> String {
    let sign = if minor < 0 { "-" } else { "" };
    let value = minor.unsigned_abs();
    if value % 100 == 0 {
        format!("{sign}{}", value / 100)
    } else {
        format!("{sign}{}.{:02}", value / 100, value % 100)
    }
}

/// Validate an actual calendar date in YYYY-MM-DD form.
pub fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = s[..4].parse().unwrap_or(0);
    let month: u32 = s[5..7].parse().unwrap_or(0);
    let day: u32 = s[8..].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && (1..=days).contains(&day)
}

/// Validate HH:MM loosely.
pub fn valid_time(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return false;
    }
    b.iter().enumerate().all(|(i, c)| {
        if i == 2 {
            *c == b':'
        } else {
            c.is_ascii_digit()
        }
    }) && b[0] <= b'2'
        && (b[0] != b'2' || b[1] <= b'3')
        && b[3] <= b'5'
}

/// Human-readable file size: "12 B", "3.5 KB", "2.1 MB", "1.0 GB".
pub fn fmt_size(bytes: i64) -> String {
    let b = bytes.max(0) as f64;
    if b < 1024.0 {
        format!("{} B", bytes.max(0))
    } else if b < 1024.0 * 1024.0 {
        format!("{:.1} KB", b / 1024.0)
    } else if b < 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} MB", b / (1024.0 * 1024.0))
    } else {
        format!("{:.1} GB", b / (1024.0 * 1024.0 * 1024.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money() {
        assert_eq!(fmt_money(1_500_000_000), "Rp 15.000.000");
        assert_eq!(fmt_money(-150000000), "-Rp 1.500.000");
        assert_eq!(fmt_money(5), "Rp 0,05");
        assert_eq!(fmt_money(50), "Rp 0,50");
        assert_eq!(fmt_money(0), "Rp 0");
    }

    #[test]
    fn sizes() {
        assert_eq!(fmt_size(0), "0 B");
        assert_eq!(fmt_size(12), "12 B");
        assert_eq!(fmt_size(3584), "3.5 KB");
        assert_eq!(fmt_size(2_202_010), "2.1 MB");
        assert!(fmt_size(-5) == "0 B");
    }

    #[test]
    fn ts() {
        // 2025-06-01 00:00:00 UTC == 07:00 +07
        assert_eq!(fmt_ts(1_748_736_000_000), "2025-06-01 07:00");
        // UTC 2025-05-31 17:30 == +07 2025-06-01 00:30 (day rollover)
        assert_eq!(fmt_ts(1_748_712_600_000), "2025-06-01 00:30");
    }

    #[test]
    fn amounts() {
        assert_eq!(parse_minor("1500000000"), Some(1_500_000_000));
        assert_eq!(parse_minor(" -42 "), Some(-42));
        assert_eq!(parse_minor("1,000"), None);
        assert_eq!(parse_minor("12a"), None);
        assert_eq!(parse_minor(""), None);
        assert_eq!(parse_minor("9007199254740993"), None);
        assert_eq!(parse_minor("-9007199254740993"), None);
        assert_eq!(parse_rupiah("15000000"), Some(1_500_000_000));
        assert_eq!(parse_rupiah("120000.05"), Some(12_000_005));
        assert_eq!(parse_rupiah("0.1"), Some(10));
        assert_eq!(parse_rupiah("1e3"), None);
        assert_eq!(parse_rupiah("1,000"), None);
        assert_eq!(parse_rupiah("1.001"), None);
        assert_eq!(rupiah_input(12_000_005), "120000.05");
    }

    #[test]
    fn dates() {
        assert!(valid_date("2025-06-01"));
        assert!(!valid_date("2025-6-1"));
        assert!(!valid_date("2025/06/01"));
        assert!(!valid_date("2025-02-29"));
        assert!(valid_date("2024-02-29"));
        assert!(!valid_date("2025-13-01"));
        assert!(!valid_date("2025-04-31"));
        assert!(valid_time("09:05"));
        assert!(!valid_time("24:00"));
        assert!(!valid_time("9:05"));
    }
}
