//! Organization listing/creation and the root redirect.

use super::*;

pub async fn root(_req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    if app.secret.is_none() {
        return Ok(fail(503, "SECRET_SESSION_KEY is not configured."));
    }
    // Not logged in -> login; logged in -> orgs page.
    Ok(redirect("/orgs"))
}

pub async fn list(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let login = try_resp!(require_login(app, &req).await);
    let orgs = orgs_of_user(&login.app.db, &login.user.id).await?;
    let csrf = login.session.csrf.clone();
    let body = serde_json::json!({
        "user": {"name": login.user.name, "email": login.user.email},
        "organizations": [],
        "orgs": orgs.iter().map(|o| serde_json::json!({"slug": o.slug, "name": o.name})).collect::<Vec<_>>(),
        "can_create": login.user.is_platform_admin != 0,
        "csrf_token": csrf,
        "local_mode": login.app.local_dev,
        "is_synthetic": false,
        "flash": query_param(&req, "msg").unwrap_or_default(),
    });
    Ok(page(&login.app, "orgs", body))
}

fn valid_slug(s: &str) -> bool {
    let b = s.as_bytes();
    (2..=48).contains(&b.len())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

pub async fn create(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let login = try_resp!(require_login(app, &req).await);
    if login.user.is_platform_admin == 0 {
        return Ok(fail(
            403,
            "Only platform administrators can create organizations.",
        ));
    }
    try_resp!(same_origin(&req));
    let form = try_resp!(req.form_data().await.map_err(werr));
    let sent = form_str(&form, "csrf_token").unwrap_or_default();
    if sent != login.session.csrf {
        return Ok(fail(403, "CSRF token invalid."));
    }
    let name = form_str(&form, "name")
        .unwrap_or_default()
        .trim()
        .to_string();
    let slug = form_str(&form, "slug")
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() || name.len() > 120 {
        return Ok(fail(400, "Organization name required (max 120 chars)."));
    }
    if !valid_slug(&slug) {
        return Ok(fail(
            400,
            "Slug must be lowercase letters/digits/hyphens (2-48 chars).",
        ));
    }
    let exists: Option<OrgRow> = db::q_one(
        &login.app.db,
        "SELECT id, slug, name, is_synthetic, notifications_enabled, notification_cutoff_date, created_at FROM organizations WHERE slug = ?1",
        vec![db::s(&slug)],
    )
    .await?;
    if exists.is_some() {
        return Ok(fail(400, "Slug already in use."));
    }
    let now = db::now_ms();
    db::exec(
        &login.app.db,
        "INSERT INTO organizations (slug, name, is_synthetic, notifications_enabled, created_at) VALUES (?1, ?2, 0, 0, ?3)",
        vec![db::s(&slug), db::s(&name), db::i(now)],
    )
    .await?;
    let org: OrgRow = db::q_one(
        &login.app.db,
        "SELECT id, slug, name, is_synthetic, notifications_enabled, notification_cutoff_date, created_at FROM organizations WHERE slug = ?1",
        vec![db::s(&slug)],
    )
    .await?
    .expect("org just inserted");
    // Admin role with all permissions; creator becomes its first member.
    let all: Vec<String> = crate::domain_map::permission_options()
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    db::exec(
        &login.app.db,
        "INSERT INTO roles (org_id, name, permissions) VALUES (?1, 'Admin', ?2)",
        vec![
            db::i(org.id),
            db::s(&serde_json::to_string(&all).unwrap_or_default()),
        ],
    )
    .await?;
    db::exec(
        &login.app.db,
        "INSERT INTO memberships (org_id, user_id, role_id, handle, created_at) SELECT ?1, ?2, id, ?2, ?3 FROM roles WHERE org_id = ?1 AND name = 'Admin'",
        vec![db::i(org.id), db::s(&login.user.id), db::i(now)],
    )
    .await?;
    db::exec(
        &login.app.db,
        "INSERT INTO pockets (org_id, name, opening_balance_minor) VALUES (?1, 'Main Pocket', 0)",
        vec![db::i(org.id)],
    )
    .await?;
    Ok(redirect(&format!("/org/{slug}/transactions")))
}
