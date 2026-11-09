//! Only Google's HTTPS image hosts may supply account avatars.
pub fn google_picture(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && (host == "googleusercontent.com" || host.ends_with(".googleusercontent.com")))
    .then(|| url.to_string())
}

/// Conservative mailbox validation; no display names or SMTP command characters.
pub fn valid_email(value: &str) -> bool {
    let Some((local, domain)) = value.rsplit_once('@') else {
        return false;
    };
    value.len() <= 254
        && !local.is_empty()
        && local.len() <= 64
        && local
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&c))
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && domain.contains('.')
        && domain.split('.').all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
}

#[cfg(test)]
mod tests {
    #[test]
    fn mailbox_validation() {
        assert!(super::valid_email("organizer+test@example.test"));
        for value in [
            "bad",
            "a@@example.test",
            "a\r\n@example.test",
            "a@-example.test",
            "a..b@example.test",
        ] {
            assert!(!super::valid_email(value));
        }
    }
    #[test]
    fn google_avatar_hosts_only() {
        use super::google_picture;
        assert!(google_picture("https://lh3.googleusercontent.com/a/photo").is_some());
        for url in [
            "http://lh3.googleusercontent.com/a",
            "https://googleusercontent.com.evil.test/a",
            "https://evil.test/a",
            "https://user@lh3.googleusercontent.com/a",
            "https://lh3.googleusercontent.com:8443/a",
            "javascript:alert(1)",
        ] {
            assert!(google_picture(url).is_none(), "{url}");
        }
    }
    #[test]
    fn google_avatar_verified_host_handling() {
        use super::google_picture;
        // Apex host and any depth of subdomain on the exact Google image host.
        assert!(google_picture("https://googleusercontent.com/a").is_some());
        assert!(google_picture("https://a.b.googleusercontent.com/a").is_some());
        // Host matching is case-insensitive per URL normalization.
        assert!(google_picture("https://LH3.GOOGLEUSERCONTENT.COM/a").is_some());
        // Default HTTPS port is normalized away; query strings are harmless.
        assert!(google_picture("https://lh3.googleusercontent.com/a?sz=64").is_some());
        // Host-name spoof suffixes and look-alike prefixes stay rejected.
        for url in [
            "https://notgoogleusercontent.com/a",
            "https://googleusercontent.com.evil.test/a",
            "https://lh3.googleusercontent.com.evil.test:443/a",
            "https://evil.test/?u=https://lh3.googleusercontent.com/a",
            "https://lh3.googleusercontent.com.evil.test/a",
            "file:///etc/passwd",
            "https:///a",
            "",
        ] {
            assert!(google_picture(url).is_none(), "{url}");
        }
    }
}
