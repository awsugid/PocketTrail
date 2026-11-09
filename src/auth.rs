//! Session-cookie codec and CSRF token derivation. Pure, testable natively.
//!
//! Cookie value: `<base64url(json payload)>.<hex hmac>` signed with
//! SECRET_SESSION_KEY. CSRF token derives from the same key so it is
//! unguessable to anyone without the secret.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const SESSION_TTL_SECS: i64 = 12 * 3600;
pub const COOKIE_NAME: &str = "pt_session";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub uid: String,
    pub csrf: String,
    /// Epoch seconds expiry.
    pub exp: i64,
}

fn hmac_hex(secret: &str, data: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(data);
    let out = mac.finalize().into_bytes();
    out.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn new_session(secret: &str, uid: &str, now_secs: i64) -> Session {
    let exp = now_secs + SESSION_TTL_SECS;
    let csrf = hmac_hex(secret, format!("csrf:{uid}:{exp}").as_bytes())[..32].to_string();
    Session {
        uid: uid.to_string(),
        csrf,
        exp,
    }
}

/// CSRF token for an unauthenticated page (e.g. the login form). Derived from
/// the secret so it is unguessable, stable per purpose.
pub fn csrf_for_secret(secret: &str, purpose: &str) -> String {
    hmac_hex(secret, format!("csrf-page:{purpose}").as_bytes())[..32].to_string()
}

pub fn encode_cookie(secret: &str, session: &Session) -> String {
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(session).expect("json"));
    let sig = hmac_hex(secret, payload.as_bytes());
    format!("{payload}.{sig}")
}

/// Decode + verify + expiry-check a session cookie. `now_secs` is epoch seconds.
pub fn decode_cookie(secret: &str, value: &str, now_secs: i64) -> Option<Session> {
    let (payload, sig) = value.split_once('.')?;
    if sig.len() != 64 || !sig.is_ascii() {
        return None;
    }
    let signature: Option<Vec<u8>> = (0..sig.len())
        .step_by(2)
        .map(|offset| u8::from_str_radix(&sig[offset..offset + 2], 16).ok())
        .collect();
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&signature?).ok()?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let s: Session = serde_json::from_slice(&bytes).ok()?;
    if s.exp <= now_secs {
        return None;
    }
    // re-derive csrf so a forged payload cannot smuggle a token in
    let expect = hmac_hex(secret, format!("csrf:{}:{}", s.uid, s.exp).as_bytes())[..32].to_string();
    if s.csrf != expect {
        return None;
    }
    Some(s)
}

/// Parse `Cookie:` header into (name, value) pairs.
pub fn parse_cookies(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|part| {
            let (k, v) = part.trim().split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

pub fn session_cookie_value(header: &str) -> Option<String> {
    parse_cookies(header)
        .into_iter()
        .find(|(k, _)| k == COOKIE_NAME)
        .map(|(_, v)| v)
}

pub fn set_cookie_header(secret: &str, session: &Session, secure: bool) -> String {
    format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax{}; Max-Age={}",
        COOKIE_NAME,
        encode_cookie(secret, session),
        if secure { "; Secure" } else { "" },
        SESSION_TTL_SECS
    )
}

pub fn clear_cookie_header() -> String {
    format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

/// Dev fixture login is allowed only on loopback hostnames, regardless of port.
pub fn host_is_loopback(host_header: &str) -> bool {
    let host = host_header
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(host_header)
        .trim_start_matches('[')
        .trim_end_matches(']');
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let s = new_session("k", "alice", 1000);
        let cookie = encode_cookie("k", &s);
        assert_eq!(decode_cookie("k", &cookie, 2000).unwrap().uid, "alice");
        assert!(decode_cookie("k", &cookie, s.exp).is_none(), "expired");
        assert!(decode_cookie("other", &cookie, 0).is_none(), "wrong key");
        // tampered payload rejected
        let mut parts = cookie.split('.');
        let payload = parts.next().unwrap();
        let sig = parts.next().unwrap();
        assert!(
            decode_cookie("k", &format!("{}x.{sig}", &payload[..payload.len() - 1]), 0).is_none()
        );
    }

    #[test]
    fn cookies() {
        assert_eq!(
            session_cookie_value("a=1; pt_session=x.y; b=2"),
            Some("x.y".into())
        );
        assert_eq!(session_cookie_value("other=1"), None);
    }

    #[test]
    fn loopback() {
        assert!(host_is_loopback("localhost:8787"));
        assert!(host_is_loopback("127.0.0.1:8787"));
        assert!(host_is_loopback("[::1]:8787"));
        assert!(!host_is_loopback("example.com"));
        assert!(!host_is_loopback("pockettrail.workers.dev"));
        assert!(!host_is_loopback("localhost.example.com"));
    }
}
