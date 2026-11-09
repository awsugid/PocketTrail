//! Login/logout routes: Google ID-token exchange, loopback-only fixture login.

use super::*;

pub async fn login_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    // Already signed in -> orgs.
    if session_from(&req, &app).is_some_and(|s| !s.uid.starts_with("preauth:")) {
        return Ok(redirect("/orgs"));
    }
    // Dev fixture identities: only when LOCAL_DEV, loopback host, secret set.
    let dev_allowed = app.local_dev && app.secret.is_some() && host_is_loopback(&req);
    let users: Vec<UserRow> = if dev_allowed {
        db::q_all(
            &app.db,
            "SELECT id, email, name, google_sub, is_platform_admin, created_at FROM users WHERE google_sub IS NULL ORDER BY id",
            vec![],
        )
        .await
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let challenge = if let Some(secret) = &app.secret {
        let mut nonce = [0_u8; 32];
        getrandom::getrandom(&mut nonce)
            .map_err(|_| worker::Error::RustError("Login challenge unavailable".into()))?;
        let nonce: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        Some(auth::new_session(
            secret,
            &format!("preauth:{nonce}"),
            db::now_secs(),
        ))
    } else {
        None
    };
    let csrf = challenge
        .as_ref()
        .map(|s| s.csrf.clone())
        .unwrap_or_default();
    let body = serde_json::json!({
        "user": serde_json::Value::Null,
        "organizations": [],
        "dev_login_enabled": dev_allowed && !users.is_empty(),
        "google_configured": app.google_client_id.is_some(),
        "google_client_id": app.google_client_id.clone().unwrap_or_default(),
        "users": users.iter().map(|u| serde_json::json!({"id": u.id, "name": u.name, "email": u.email})).collect::<Vec<_>>(),
        "csrf_token": csrf,
        "local_mode": app.local_dev,
        "is_synthetic": false,
        "error": query_param(&req, "error").unwrap_or_default(),
    });
    let response = page(&app, "login", body);
    Ok(match challenge {
        Some(session) => with_cookie(
            response,
            &auth::set_cookie_header(
                app.secret.as_deref().unwrap_or_default(),
                &session,
                is_https(&req),
            ),
        ),
        None => response,
    })
}

fn is_https(req: &Request) -> bool {
    req.url().is_ok_and(|url| url.scheme() == "https")
}

fn verify_login_csrf(req: &Request, app: &App, form: &FormData) -> Result<(), Response> {
    let Some(challenge) = session_from(req, app).filter(|s| s.uid.starts_with("preauth:")) else {
        return Err(fail(
            403,
            "Sign-in session expired. Reload the sign-in page.",
        ));
    };
    let sent = form_str(form, "csrf_token").unwrap_or_default();
    if sent.is_empty() || sent != challenge.csrf {
        return Err(fail(403, "CSRF token missing or invalid."));
    }
    same_origin(req)
}

fn require_dev_login(req: &Request, app: &App) -> Result<(), Response> {
    if !app.local_dev {
        return Err(fail(403, "Dev login disabled (LOCAL_DEV not set)."));
    }
    if app.secret.is_none() {
        return Err(fail(
            503,
            "SECRET_SESSION_KEY not configured; fails closed.",
        ));
    }
    if !host_is_loopback(&req) {
        return Err(fail(403, "Dev login is restricted to loopback hostnames."));
    }
    Ok(())
}

pub async fn login_dev(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    try_resp!(require_dev_login(&req, &app));
    let form = try_resp!(req.form_data().await.map_err(werr));
    try_resp!(verify_login_csrf(&req, &app, &form));
    let user_id = form_str(&form, "user_id").unwrap_or_default();
    let user: Option<UserRow> = db::q_one(
        &app.db,
        "SELECT id, email, name, google_sub, is_platform_admin, created_at FROM users WHERE id = ?1 AND google_sub IS NULL",
        vec![db::s(&user_id)],
    )
    .await?;
    let Some(user) = user else {
        return Ok(fail(403, "Unknown fixture identity."));
    };
    let secret = app.secret.clone().unwrap_or_default();
    let session = auth::new_session(&secret, &user.id, db::now_secs());
    let cookie = auth::set_cookie_header(&secret, &session, is_https(&req));
    Ok(with_cookie(redirect("/orgs"), &cookie))
}

pub async fn login_google(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let Some(client_id) = app.google_client_id.clone() else {
        return Ok(fail(503, "Google sign-in is not configured."));
    };
    let Some(secret) = app.secret.clone() else {
        return Ok(fail(
            503,
            "SECRET_SESSION_KEY not configured; fails closed.",
        ));
    };
    let form = try_resp!(req.form_data().await.map_err(werr));
    try_resp!(verify_login_csrf(&req, &app, &form));
    let credential = form_str(&form, "credential").unwrap_or_default();
    if credential.is_empty() {
        return Ok(fail(400, "Missing Google credential."));
    }
    let nonce = form_str(&form, "csrf_token").unwrap_or_default();
    let verified = google::verify_id_token(&credential, &client_id, &nonce).await;
    let Ok(claims) = verified else {
        return Ok(fail(403, "Google sign-in failed: invalid ID token."));
    };
    // Upsert user keyed by the stable Google subject.
    let uid = format!("g:{}", claims.sub);
    let owner: Option<UserRow> = db::q_one(
        &app.db,
        "SELECT * FROM users WHERE LOWER(email)=LOWER(?1)",
        vec![db::s(&claims.email)],
    )
    .await?;
    if owner.is_some_and(|user| user.id != uid) {
        return Ok(fail(409,"This email is associated with another account record. Contact a platform administrator."));
    }
    db::exec(
        &app.db,
        "INSERT INTO users (id, email, name, google_sub, is_platform_admin, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name",
        vec![db::s(&uid), db::s(&claims.email), db::s(&claims.name), db::s(&claims.sub), db::i(db::now_ms())],
    )
    .await?;
    let session = auth::new_session(&secret, &uid, db::now_secs());
    let cookie = auth::set_cookie_header(&secret, &session, is_https(&req));
    Ok(with_cookie(redirect("/orgs"), &cookie))
}

pub async fn logout(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    // CSRF-protected when a session exists; otherwise just redirect.
    if let Some(session) = session_from(&req, &app) {
        try_resp!(same_origin(&req));
        let form = try_resp!(req.form_data().await.map_err(werr));
        let sent = form_str(&form, "csrf_token").unwrap_or_default();
        if sent.is_empty() || sent != session.csrf {
            return Ok(fail(403, "CSRF token missing or invalid."));
        }
    }
    Ok(with_cookie(
        redirect("/login"),
        &auth::clear_cookie_header(),
    ))
}
