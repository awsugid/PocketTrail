//! Google GIS ID-token verification: RS256 JWT checked against Google's
//! published JWKS (fetched with Worker `Fetch`, edge-cached best-effort).

use super::*;
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};

const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_CACHE_KEY: &str = "https://pockettrail.local/cache/google-jwks-certs?v=1";
const JWKS_CACHE_TTL: &str = "public, max-age=21600"; // 6h

/// Claims the login route consumes. `sub` is the stable Google subject used
/// as the user key; `name` falls back to the email when Google omits it.
pub struct GoogleClaims {
    pub sub: String,
    pub email: String,
    pub name: String,
}

#[derive(Deserialize)]
struct RawClaims {
    sub: String,
    email: String,
    #[serde(default)] // absent -> false -> fails closed below
    email_verified: bool,
    name: Option<String>,
    nonce: Option<String>,
}

/// Verify a Google GIS ID token against `client_id`. Fails closed on every
/// malformed, mismatched, or unverifiable token; no debug or dummy path.
pub async fn verify_id_token(
    token: &str,
    client_id: &str,
    nonce: &str,
) -> Result<GoogleClaims, String> {
    match verify_inner(token, client_id, nonce).await {
        Ok(c) => Ok(c),
        Err(e) => {
            worker::console_error!("google id-token rejected: {}", e);
            Err(e)
        }
    }
}

async fn verify_inner(token: &str, client_id: &str, nonce: &str) -> Result<GoogleClaims, String> {
    let kid = header_kid(token)?;
    let key = decoding_key(&kid).await?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    validation.set_required_spec_claims(&["exp", "sub", "iss", "aud"]);
    validation.leeway = 60;
    let data =
        decode::<RawClaims>(token, &key, &validation).map_err(|e| format!("invalid token: {e}"))?;
    let raw = data.claims;
    if !raw.email_verified {
        return Err("email not verified".into());
    }
    if nonce.is_empty() || raw.nonce.as_deref() != Some(nonce) {
        return Err("login nonce mismatch".into());
    }
    let name = raw.name.unwrap_or_else(|| raw.email.clone());
    Ok(GoogleClaims {
        sub: raw.sub,
        email: raw.email,
        name,
    })
}

/// Decode the token header and admit only RS256 with a `kid` (which JWKS
/// key to use). Pure and sync so it stays unit-testable.
fn header_kid(token: &str) -> Result<String, String> {
    let header = decode_header(token).map_err(|e| format!("bad header: {e}"))?;
    if header.alg != Algorithm::RS256 {
        return Err("unsupported algorithm".into());
    }
    header.kid.ok_or_else(|| "missing kid".into())
}

/// Resolve `kid` to a signing key: cached JWKS first; on a miss assume a
/// recent Google key rotation and refetch bypassing the cache, throttled to
/// one bypass per 30s per isolate.
async fn decoding_key(kid: &str) -> Result<DecodingKey, String> {
    static LAST_FORCE_REFRESH: AtomicU64 = AtomicU64::new(0);
    let jwks = fetch_jwks(false).await?;
    if let Some(jwk) = jwks.find(kid) {
        return DecodingKey::from_jwk(jwk).map_err(|e| format!("bad signing key: {e}"));
    }
    let now = db::now_secs() as u64;
    if now.saturating_sub(LAST_FORCE_REFRESH.load(Ordering::Relaxed)) >= 30 {
        LAST_FORCE_REFRESH.store(now, Ordering::Relaxed);
        let fresh = fetch_jwks(true).await?;
        if let Some(jwk) = fresh.find(kid) {
            return DecodingKey::from_jwk(jwk).map_err(|e| format!("bad signing key: {e}"));
        }
    }
    Err("Google signing key not found".into())
}

async fn fetch_jwks(force_fresh: bool) -> Result<JwkSet, String> {
    if !force_fresh {
        if let Ok(Some(mut cached)) = worker::Cache::default().get(JWKS_CACHE_KEY, true).await {
            if let Ok(text) = cached.text().await {
                if let Ok(jwks) = serde_json::from_str::<JwkSet>(&text) {
                    return Ok(jwks);
                }
            }
        }
    }
    let headers = Headers::new();
    let _ = headers.set("Accept", "application/json");
    let req = Request::new_with_init(
        GOOGLE_JWKS_URL,
        &RequestInit {
            headers,
            method: Method::Get,
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let mut resp = Fetch::Request(req)
        .send()
        .await
        .map_err(|e| format!("JWKS fetch failed: {e}"))?;
    if resp.status_code() != 200 {
        return Err(format!("JWKS fetch status {}", resp.status_code()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let jwks: JwkSet = serde_json::from_str(&body).map_err(|e| format!("bad JWKS json: {e}"))?;
    // Best-effort edge cache; the Cache API may be unavailable in dev.
    if let Ok(mut cached) = worker::Response::ok(&body) {
        if cached
            .headers_mut()
            .set("Cache-Control", JWKS_CACHE_TTL)
            .is_ok()
        {
            let _ = worker::Cache::default().put(JWKS_CACHE_KEY, cached).await;
        }
    }
    Ok(jwks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    fn part(json: &str) -> String {
        URL_SAFE_NO_PAD.encode(json.as_bytes())
    }

    #[test]
    fn rejects_garbage_header() {
        assert!(header_kid("not-a-token").is_err());
    }

    #[test]
    fn rejects_non_rs256() {
        let t = format!("{}.{}.{}", part(r#"{"alg":"HS256"}"#), part("{}"), "x");
        assert!(header_kid(&t).is_err());
    }

    #[test]
    fn rejects_missing_kid() {
        let t = format!("{}.{}.{}", part(r#"{"alg":"RS256"}"#), part("{}"), "x");
        assert!(header_kid(&t).is_err());
    }

    #[test]
    fn email_verified_defaults_closed() {
        let raw: RawClaims = serde_json::from_str(r#"{"sub":"s","email":"e@x.y"}"#).unwrap();
        assert!(!raw.email_verified);
    }
}
