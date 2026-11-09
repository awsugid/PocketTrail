//! Emailed invitation links: token encoding and the hash that is stored.
//! Raw tokens are never persisted — D1 keeps only the SHA-256 hash, so a
//! database leak cannot mint acceptance links.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// 32 random bytes -> 43-char unpadded base64url token (URL-safe by design).
pub fn encode(random: [u8; 32]) -> String {
    URL_SAFE_NO_PAD.encode(random)
}

/// Fixed-width, non-reversible lookup key for a raw token.
pub fn hash(raw: &str) -> String {
    Sha256::digest(raw.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_url_safe_and_fixed_width() {
        let t = encode([0u8; 32]);
        assert_eq!(t.len(), 43);
        assert!(t
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_eq!(encode([0xff; 32]).len(), 43);
    }

    #[test]
    fn hash_matches_known_vector() {
        assert_eq!(
            hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(hash("").len(), 64);
        assert_ne!(hash("a"), hash("b"));
    }
}
