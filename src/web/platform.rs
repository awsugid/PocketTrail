//! Platform administration does not confer organization membership.
//!
//! Every mutation writes its audit event in the same D1 batch as the change.
use super::*;
use serde::{Deserialize, Serialize};

pub async fn form(login: &Login, req: &mut Request) -> Result<FormData, Response> {
    same_origin(req)?;
    let form = req.form_data().await.map_err(werr)?;
    if form_str(&form, "csrf_token").as_deref() != Some(login.session.csrf.as_str()) {
        return Err(fail(403, "CSRF token invalid."));
    }
    Ok(form)
}

async fn admin(app: App, req: &Request) -> Result<Login, Response> {
    let login = require_login(app, req).await?;
    if login.user.is_platform_admin == 0 {
        return Err(fail(403, "Platform administrator required."));
    }
    Ok(login)
}

#[derive(Deserialize, serde::Serialize)]
pub struct Template {
    pub id: i64,
    pub name: String,
    pub permissions: String,
}
#[derive(Deserialize, serde::Serialize)]
pub struct Event {
    pub id: i64,
    pub actor_id: Option<String>,
    pub org_id: Option<i64>,
    pub action: String,
    pub target: String,
    pub outcome: String,
    pub created_at: i64,
}

#[derive(Deserialize)]
struct Count {
    n: i64,
}

use crate::audit_rules::{page_number, PAGE_SIZE};

fn pages(total: i64) -> i64 {
    (total.clamp(1, i64::MAX) + PAGE_SIZE - 1) / PAGE_SIZE
}

/// 1-based window shown for a page of `count` rows; empty pages clamp to 1–0.
fn window(page: i64, count: usize) -> (i64, i64) {
    let from = (page - 1) * PAGE_SIZE + 1;
    (from, from + count as i64 - 1)
}

impl Template {
    fn labels(&self) -> Vec<String> {
        crate::domain_map::parse_role_permissions(&self.permissions)
            .into_iter()
            .map(|p| crate::domain_map::perm_label(p).to_string())
            .collect()
    }
}

pub async fn page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let login = try_resp!(admin(ctx.data.clone(), &req).await);
    let db = &login.app.db;
    let users_total: Count = db::q_one(db, "SELECT COUNT(*) AS n FROM users", vec![])
        .await?
        .unwrap_or(Count { n: 0 });
    let events_total: Count = db::q_one(
        db,
        "SELECT COUNT(*) AS n FROM audit_events WHERE org_id IS NULL",
        vec![],
    )
    .await?
    .unwrap_or(Count { n: 0 });
    let users_page =
        i64::from(page_number(query_param(&req, "users").as_deref())).min(pages(users_total.n));
    let events_page =
        i64::from(page_number(query_param(&req, "events").as_deref())).min(pages(events_total.n));
    let users: Vec<UserRow> = db::q_all(
        db,
        "SELECT * FROM users ORDER BY name LIMIT ?1 OFFSET ?2",
        vec![db::i(PAGE_SIZE), db::i((users_page - 1) * PAGE_SIZE)],
    )
    .await?;
    let (users_from, users_to) = window(users_page, users.len());
    let events: Vec<Event> =
        audit::list_platform(&login.app, u32::try_from(events_page).unwrap_or(1)).await?;
    let (events_from, events_to) = window(events_page, events.len());
    // Cross-links keep the other section's page while paginating one.
    let users_at = |n: i64| format!("/platform?events={events_page}&users={n}");
    let events_at = |n: i64| format!("/platform?users={users_page}&events={n}");
    let organizations: Vec<OrgAdminRow> = db::q_all(db,
        "SELECT o.slug, o.name, o.created_at, (SELECT COUNT(*) FROM memberships m WHERE m.org_id=o.id AND m.removed_at IS NULL) AS members FROM organizations o ORDER BY o.name LIMIT 200", vec![]).await?;
    let templates: Vec<Template> = db::q_all(
        db,
        "SELECT id, name, permissions FROM role_templates ORDER BY name",
        vec![],
    )
    .await?;

    let body = serde_json::json!({
        "user":{"name":login.user.name,"email":login.user.email,"picture":login.user.picture.as_deref().and_then(crate::profile::google_picture),"is_platform_admin":true},
        "csrf_token":login.session.csrf,
        "organizations":organizations,
        "users":users.iter().map(|u|serde_json::json!({"id":u.id,"name":u.name,"email":u.email,"admin":u.is_platform_admin!=0,"is_self":u.id==login.user.id})).collect::<Vec<_>>(),
        "users_page":users_page,"users_pages":pages(users_total.n),
        "users_from":users_from,"users_to":users_to,"users_total":users_total.n,
        "users_prev":users_page.gt(&1).then(|| users_at(users_page - 1)),
        "users_next":(users_page < pages(users_total.n)).then(|| users_at(users_page + 1)),
        "role_templates":templates.iter().map(|t|serde_json::json!({"id":t.id,"name":t.name,"labels":t.labels()})).collect::<Vec<_>>(),
        "events":events,
        "events_page":events_page,"events_pages":pages(events_total.n),
        "events_from":events_from,"events_to":events_to,"events_total":events_total.n,
        "events_prev":events_page.gt(&1).then(|| events_at(events_page - 1)),
        "events_next":(events_page < pages(events_total.n)).then(|| events_at(events_page + 1)),
        "permissions":crate::domain_map::permission_options().into_iter().map(|(id,label)|serde_json::json!({"id":id,"label":label})).collect::<Vec<_>>(),
    });
    Ok(super::page(&login.app, "platform", body))
}

#[derive(Deserialize, Serialize)]
struct OrgAdminRow {
    slug: String,
    name: String,
    created_at: i64,
    members: i64,
}

pub async fn set_admin(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let login = try_resp!(admin(ctx.data.clone(), &req).await);
    let form = try_resp!(form(&login, &mut req).await);
    let id = form_str(&form, "user_id").unwrap_or_default();
    let enabled = match form_str(&form, "admin").as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => return Ok(fail(400, "Choose grant or revoke explicitly.")),
    };
    if id == login.user.id {
        return Ok(fail(
            400,
            "Use another administrator to change your own platform access.",
        ));
    }
    let exists: Option<Count> = db::q_one(
        &login.app.db,
        "SELECT 1 AS n FROM users WHERE id=?1",
        vec![db::s(&id)],
    )
    .await?;
    if exists.is_none() {
        return Ok(fail(404, "User not found."));
    }
    // Authorization is re-checked inside the batch: every statement carries
    // an actor-is-admin predicate, so a grant paused before a concurrent
    // demotion of its actor writes nothing (and audits nothing). The trailing
    // probe — read from the same batch results, never a later query — decides
    // the outcome. The count guard prevents removing the final administrator;
    // the actor guard rejects a paused request after its actor is demoted.
    let actor_guard =
        "EXISTS(SELECT 1 FROM users actor WHERE actor.id=?2 AND actor.is_platform_admin=1)";
    let count_guard = if enabled {
        "1=1".to_string()
    } else {
        "(SELECT COUNT(*) FROM users WHERE is_platform_admin=1) - EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) >= 1".to_string()
    };
    let statements = vec![
        login.app.db.prepare(&format!("INSERT INTO audit_events(actor_id,action,target,outcome,created_at) SELECT ?2,'platform.admin',id,?3,?4 FROM users WHERE id=?1 AND is_platform_admin!=?5 AND {actor_guard} AND ({count_guard})"))
            .bind(&[db::s(&id), db::s(&login.user.id), db::s(if enabled { "granted" } else { "revoked" }), db::i(db::now_ms()), db::i(i64::from(enabled))])?,
        login.app.db.prepare(&format!("UPDATE users SET is_platform_admin=?3 WHERE id=?1 AND is_platform_admin!=?3 AND {actor_guard} AND ({count_guard})"))
            .bind(&[db::s(&id), db::s(&login.user.id), db::i(i64::from(enabled))])?,
        login.app.db.prepare("SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) AS actor_admin, EXISTS(SELECT 1 FROM users WHERE id=?2 AND is_platform_admin=?3) AS target_is_requested")
            .bind(&[db::s(&login.user.id), db::s(&id), db::i(i64::from(enabled))])?,
    ];
    let results = login.app.db.batch(statements).await?;
    #[derive(serde::Deserialize)]
    struct Probe {
        actor_admin: i64,
        target_is_requested: i64,
    }
    let probe = results
        .last()
        .and_then(|r| r.results::<Probe>().ok())
        .and_then(|rows| rows.into_iter().next());
    match probe {
        Some(p) if p.actor_admin == 0 => Ok(fail(
            403,
            "Your platform access was revoked while you were working. Reload and try again.",
        )),
        Some(p) if p.target_is_requested == 1 => Ok(redirect("/platform")),
        _ => Ok(fail(
            409,
            "Platform access did not change: at least one other platform administrator must keep access.",
        )),
    }
}

pub async fn save_template(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let login = try_resp!(admin(ctx.data.clone(), &req).await);
    let form = try_resp!(form(&login, &mut req).await);
    let name = form_str(&form, "name")
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() || name.len() > 100 {
        return Ok(fail(400, "Template name must be 1–100 characters."));
    }
    let permissions = try_resp!(settings::permission_bundle(&form));
    // Both upsert branches carry the actor-is-admin predicate, so a save
    // paused before a concurrent demotion of its actor writes nothing. The
    // audit row is gated on the upsert actually changing rows (changes()
    // reads the preceding statement in the same batch), and the trailing
    // probe decides the outcome from the batch results themselves.
    let actor_guard =
        "EXISTS(SELECT 1 FROM users actor WHERE actor.id=?3 AND actor.is_platform_admin=1)";
    let statements = vec![
        login.app.db.prepare(&format!("INSERT INTO role_templates(name,permissions) SELECT ?1,?2 WHERE {actor_guard} ON CONFLICT(name) DO UPDATE SET permissions=excluded.permissions WHERE {actor_guard}"))
            .bind(&[db::s(&name), db::s(&permissions), db::s(&login.user.id)])?,
        login.app.db.prepare("INSERT INTO audit_events(actor_id,action,target,outcome,created_at) SELECT ?1,'platform.template',?2,'committed',?3 WHERE (SELECT changes())>0")
            .bind(&[db::s(&login.user.id), db::s(&name), db::i(db::now_ms())])?,
        login.app.db.prepare("SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) AS actor_admin")
            .bind(&[db::s(&login.user.id)])?,
    ];
    let results = login.app.db.batch(statements).await?;
    #[derive(serde::Deserialize)]
    struct Probe {
        actor_admin: i64,
    }
    let probe = results
        .last()
        .and_then(|r| r.results::<Probe>().ok())
        .and_then(|rows| rows.into_iter().next());
    match probe {
        Some(p) if p.actor_admin == 0 => Ok(fail(
            403,
            "Your platform access was revoked while you were working. Reload and try again.",
        )),
        _ => Ok(redirect("/platform")),
    }
}

/// Copy a platform template into one organization as a separate role. The
/// copy snapshots name and permissions; later template edits never change it.
pub async fn apply_template(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageRoles).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let id = form_str(&form, "template_id")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let template: Option<Template> = db::q_one(
        &g.app.db,
        "SELECT id, name, permissions FROM role_templates WHERE id=?1",
        vec![db::i(id)],
    )
    .await?;
    let Some(template) = template else {
        return Ok(fail(404, "Role template not found."));
    };
    if roles_of_org(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|r| r.name.eq_ignore_ascii_case(&template.name))
    {
        return Ok(fail(
            400,
            "An organization role already uses that name. Rename it or create the role manually.",
        ));
    }
    let statements = vec![
        g.app.db.prepare("INSERT INTO roles(org_id,name,permissions) SELECT ?1,name,permissions FROM role_templates WHERE id=?2")
            .bind(&[db::i(g.org.id), db::i(id)])?,
        audit::committed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "org.roles",
            &template.name,
        )?,
    ];
    g.app.db.batch(statements).await?;
    Ok(redirect(&format!("/org/{slug}/settings")))
}
