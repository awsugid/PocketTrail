//! @mention extraction from comment bodies. Pure, testable natively.

/// Extract @handle tokens: `@` followed by [a-z0-9._-]+. Lowercased, deduped,
/// in first-appearance order. Caller intersects with the org's member handles.
pub fn extract_mentions(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let lower = body.to_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' && (i == 0 || !is_handle_char(bytes[i - 1])) {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && is_handle_char(bytes[end]) {
                end += 1;
            }
            if end > start {
                let handle = &lower[start..end];
                if !out.iter().any(|h| h == handle) {
                    out.push(handle.to_string());
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

fn is_handle_char(b: u8) -> bool {
    b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
}

/// Map extracted handles to membership IDs of ACTIVE members, excluding the
/// author. Caller passes (handle, membership_id) for active members.
pub fn resolve_mentions(mentions: &[String], members: &[(String, i64)]) -> Vec<i64> {
    members
        .iter()
        .filter(|(h, _)| mentions.iter().any(|m| m == h))
        .map(|(_, id)| *id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions() {
        assert_eq!(
            extract_mentions("cc @Bob and @alice_c, email bob@x.com"),
            vec!["bob", "alice_c"]
        );
        // email address must not count as mention (preceded by word char)
        assert_eq!(
            extract_mentions("mail bob@example.test"),
            Vec::<String>::new()
        );
        assert_eq!(extract_mentions("@alice@again"), vec!["alice"]);
        assert_eq!(extract_mentions("no one"), Vec::<String>::new());
    }

    #[test]
    fn resolution() {
        let members = vec![("alice".to_string(), 1), ("bob".to_string(), 2)];
        assert_eq!(
            resolve_mentions(&["alice".into(), "ghost".into()], &members),
            vec![1]
        );
    }
}
