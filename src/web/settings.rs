//! Organization-scoped configuration. Every mutation checks its own permission.
use super::*;
use std::collections::BTreeSet;

fn back(g: &Ctx, message: &str) -> Response {
    redirect(&format!(
        "/org/{}/settings?msg={}",
        g.org.slug,
        url::form_urlencoded::byte_serialize(message.as_bytes()).collect::<String>()
    ))
}

pub async fn page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ViewTransactions).await
    );
    let roles = roles_of_org(&g.app.db, g.org.id).await?;
    let mappings = mappings_of(&g.app.db, g.org.id).await?;
    let pockets = pockets_of(&g.app.db, g.org.id).await?;
    let mut body = g
        .base_json("settings", query_param(&req, "msg").as_deref(), None)
        .await;
    body["roles"] = serde_json::json!(roles
        .iter()
        .map(|r| serde_json::json!({
            "id":r.id,"name":r.name,
            "permissions":crate::domain_map::parse_role_permissions(&r.permissions)
                .iter().map(|p|crate::domain_map::perm_variant(*p)).collect::<Vec<_>>()
        }))
        .collect::<Vec<_>>());
    body["members"] = serde_json::json!(g
        .mems
        .iter()
        .map(|m| serde_json::json!({
            "id":m.id,"name":m.name,"email":m.email,"handle":m.handle,
            "role_id":m.role_id,"active":m.active()
        }))
        .collect::<Vec<_>>());
    body["permissions"] = serde_json::json!(crate::domain_map::permission_options()
        .into_iter()
        .map(|(id, label)| serde_json::json!({"id":id,"label":label}))
        .collect::<Vec<_>>());
    body["mappings"] =
        serde_json::json!(mappings.iter().map(|m|serde_json::json!({
        "id":m.id,"pattern":m.pattern,"member_id":m.membership_id,"member_name":m.member_name
    })).collect::<Vec<_>>());
    body["pockets"] = serde_json::json!(pockets
        .iter()
        .map(|p| serde_json::json!({
            "id":p.id,"name":p.name,"opening_balance_minor":p.opening_balance_minor
        }))
        .collect::<Vec<_>>());
    body["notifications"] = serde_json::json!({
        "enabled":db::flag(g.org.notifications_enabled),
        "cutoff_date":g.org.notification_cutoff_date,
    });
    body["can"] = serde_json::json!({
        "roles":g.can(Permission::ManageRoles),"members":g.can(Permission::ManageMembers),
        "mappings":g.can(Permission::ImportStatements),
        "notifications":g.can(Permission::ManageNotifications)
    });
    if g.can(Permission::ManageRoles) {
        body["role_templates"] = serde_json::json!(
            db::q_all::<platform::Template>(
                &g.app.db,
                "SELECT * FROM role_templates ORDER BY name",
                vec![]
            )
            .await?
        );
    }
    if g.can(Permission::ManageMembers) {
        body["invitations"] = serde_json::json!(db::q_all::<serde_json::Value>(&g.app.db,"SELECT i.id,i.email,i.expires_at,im.status AS mail_status,im.error AS mail_error,im.attempts AS mail_attempts FROM invitations i LEFT JOIN invitation_mail im ON im.invitation_id=i.id AND im.id=(SELECT MAX(x.id) FROM invitation_mail x WHERE x.invitation_id=i.id) WHERE i.org_id=?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC",vec![db::i(g.org.id)]).await?);
    }
    if g.can(Permission::ManageMembers) {
        let page = crate::audit_rules::page_number(query_param(&req, "page").as_deref());
        let mut events = audit::list_org(&g.app, g.org.id, page).await?;
        let has_more = events.len() as i64 > crate::audit_rules::PAGE_SIZE;
        events.truncate(crate::audit_rules::PAGE_SIZE as usize);
        body["audit_events"] = serde_json::json!(events);
        body["audit_page"] = serde_json::json!(page);
        body["audit_has_more"] = serde_json::json!(has_more);
    }
    if g.can(Permission::ManageNotifications) {
        let preview_org = OrgRow {
            notification_cutoff_date: query_param(&req, "cutoff_date")
                .filter(|s| crate::fmt::valid_date(s))
                .or(g.org.notification_cutoff_date.clone()),
            id: g.org.id,
            slug: g.org.slug.clone(),
            name: g.org.name.clone(),
            is_synthetic: g.org.is_synthetic,
            notifications_enabled: g.org.notifications_enabled,
            created_at: g.org.created_at,
            notification_revision: g.org.notification_revision,
        };
        let targets = notify::digest_targets(&g.app.db, &preview_org, &g.dom_org, &g.mems).await?;
        body["notification_preview"] = notify::preview_json(&targets);
        let cutoff = preview_org
            .notification_cutoff_date
            .clone()
            .unwrap_or_default();
        body["notification_preview_cutoff"] = serde_json::json!(cutoff);
        body["preview_token"] = serde_json::json!(auth::csrf_for_secret(
            g.app.secret.as_deref().unwrap_or_default(),
            &format!("notifications:{}:{cutoff}", g.org.id)
        ));
        body["outbox"] = serde_json::json!(notify::outbox_view(&g.app.db, &g.org)
            .await?
            .iter()
            .map(|n| serde_json::json!({
                "kind":n.kind,"to_name":n.to_name,"subject":n.subject,
                "created_at":crate::fmt::fmt_ts(n.created_at)
            }))
            .collect::<Vec<_>>());
    }
    Ok(super::page(&g.app, "settings", body))
}

pub(super) fn permission_bundle(form: &FormData) -> Result<String, Response> {
    let allowed: BTreeSet<String> = crate::domain_map::permission_options()
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    let requested: BTreeSet<String> = form_strings(form, "perm").into_iter().collect();
    if !requested.is_subset(&allowed) {
        return Err(fail(400, "Unknown application permission."));
    }
    if !requested.is_empty() && !requested.contains("ViewTransactions") {
        return Err(fail(400,"Working roles require View transactions to open organization pages. Select that permission explicitly."));
    }
    serde_json::to_string(&requested).map_err(|_| fail(400, "Invalid permission bundle."))
}

pub async fn create_role(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    save_role(req, ctx, None).await
}
pub async fn update_role(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    save_role(req, ctx, Some(id)).await
}
async fn save_role(
    mut req: Request,
    ctx: RouteContext<App>,
    id: Option<i64>,
) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageRoles).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let name = form_str(&form, "name")
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() || name.len() > 100 {
        return Ok(fail(400, "Role name must be 1–100 characters."));
    }
    let permissions = try_resp!(permission_bundle(&form));
    let roles = roles_of_org(&g.app.db, g.org.id).await?;
    if id.is_some_and(|id| !roles.iter().any(|r| r.id == id)) {
        return Ok(fail(404, "Role not found in this organization."));
    }
    if roles
        .iter()
        .any(|r| Some(r.id) != id && r.name.eq_ignore_ascii_case(&name))
    {
        return Ok(fail(400, "An organization role already uses that name."));
    }
    let audit = |action: &str, target: String| {
        audit::committed(&g.app.db, Some(g.org.id), &g.user.id, action, &target)
    };
    // Change-gated audit for the UPDATE: a role deleted by a concurrent
    // request matches zero rows and must not record a committed event.
    let audit_changed = |action: &str, target: String| {
        audit::committed_if_changed(&g.app.db, Some(g.org.id), &g.user.id, action, &target)
    };
    match id {
        Some(id) => {
            g.app.db.batch(vec![
                g.app.db.prepare(
                    "UPDATE roles SET name=?1,permissions=?2 WHERE id=?3 AND org_id=?4",
                )
                .bind(&[
                    db::s(&name),
                    db::s(&permissions),
                    db::i(id),
                    db::i(g.org.id),
                ])?,
                audit_changed("role.updated", format!("role:{id}"))?,
            ])
            .await?;
        }
        None => {
            g.app.db.batch(vec![
                g.app.db.prepare(
                    "INSERT INTO roles(org_id,name,permissions) VALUES(?1,?2,?3)",
                )
                .bind(&[db::i(g.org.id), db::s(&name), db::s(&permissions)])?,
                audit("role.created", format!("role:{name}"))?,
            ])
            .await?;
        }
    }
    Ok(back(&g, "Role saved"))
}

pub async fn add_member(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let identity = form_str(&form, "user_id")
        .unwrap_or_default()
        .trim()
        .to_string();
    let role_id = form_str(&form, "role_id")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if !roles_of_org(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|r| r.id == role_id)
    {
        return Ok(fail(400, "Choose a role belonging to this organization."));
    }
    let user: Option<UserRow> = db::q_one(
        &g.app.db,
        "SELECT * FROM users WHERE id=?1 OR LOWER(email)=LOWER(?1)",
        vec![db::s(&identity)],
    )
    .await?;
    let Some(user) = user else {
        return Ok(fail(
            400,
            "The user must sign in with Google once before membership can be granted.",
        ));
    };
    if g.mems.iter().any(|m| m.user_id == user.id) {
        return Ok(fail(
            400,
            "Membership already exists. Change its role or restore it instead.",
        ));
    }
    let mut random = [0_u8; 8];
    getrandom::getrandom(&mut random)
        .map_err(|_| worker::Error::RustError("Identifier unavailable".into()))?;
    let handle = format!(
        "member-{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    g.app.db.batch(vec![
        g.app.db.prepare(
            "INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) VALUES(?1,?2,?3,?4,?5)",
        )
        .bind(&[
            db::i(g.org.id),
            db::s(&user.id),
            db::i(role_id),
            db::s(&handle),
            db::i(db::now_ms()),
        ])?,
        audit::committed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "member.added",
            &format!("membership:{handle}"),
        )?,
    ])
    .await?;
    Ok(back(&g, "Membership granted"))
}

pub async fn set_role(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    if !g.mems.iter().any(|m| m.id == id) {
        return Ok(fail(404, "Membership not found."));
    }
    let role_id = form_str(&form, "role_id")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if !roles_of_org(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|r| r.id == role_id)
    {
        return Ok(fail(400, "Choose a role belonging to this organization."));
    }
    g.app.db.batch(vec![
        g.app.db.prepare(
            "UPDATE memberships SET role_id=?1 WHERE id=?2 AND org_id=?3",
        )
        .bind(&[db::i(role_id), db::i(id), db::i(g.org.id)])?,
        audit::committed_if_changed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "member.role_changed",
            &format!("membership:{id}"),
        )?,
    ])
    .await?;
    Ok(back(&g, "Member role changed"))
}

pub async fn remove_member(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    set_membership_active(req, ctx, false).await
}
pub async fn restore_member(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    set_membership_active(req, ctx, true).await
}
async fn set_membership_active(
    mut req: Request,
    ctx: RouteContext<App>,
    active: bool,
) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let _form = try_resp!(form_post(&g, &mut req).await);
    if !g.mems.iter().any(|m| m.id == id) {
        return Ok(fail(404, "Membership not found."));
    }
    if !active && id == g.me().id {
        return Ok(fail(
            400,
            "Ask another membership manager to remove your membership.",
        ));
    }
    g.app.db.batch(vec![
        g.app.db.prepare(
            "UPDATE memberships SET removed_at=?1 WHERE id=?2 AND org_id=?3",
        )
        .bind(&[
            db::opt_i((!active).then_some(db::now_ms())),
            db::i(id),
            db::i(g.org.id),
        ])?,
        audit::committed_if_changed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            if active { "member.restored" } else { "member.removed" },
            &format!("membership:{id}"),
        )?,
    ])
    .await?;
    if !active {
        db::exec(&g.app.db,"UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND to_membership_id=?3 AND cancelled_at IS NULL",
            vec![db::i(db::now_ms()),db::i(g.org.id),db::i(id)]).await?;
    }
    Ok(back(
        &g,
        if active {
            "Membership restored"
        } else {
            "Access revoked; historical attribution retained"
        },
    ))
}

pub async fn add_mapping(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let pattern = form_str(&form, "pattern")
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let id = form_str(&form, "member_id").and_then(|s| s.parse::<i64>().ok());
    if pattern.is_empty() || pattern.len() > 300 || active_mem(&g.mems, id).is_none() {
        return Ok(fail(
            400,
            "Supply a statement label and an active member of this organization.",
        ));
    }
    if mappings_of(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|m| m.pattern.eq_ignore_ascii_case(&pattern))
    {
        return Ok(fail(
            400,
            "This label already has a mapping. Remove it before assigning another member.",
        ));
    }
    g.app.db.batch(vec![
        g.app.db.prepare(
            "INSERT INTO actor_mappings(org_id,pattern,membership_id,created_by_membership_id,created_at) VALUES(?1,?2,?3,?4,?5)",
        )
        .bind(&[db::i(g.org.id),db::s(&pattern),db::i(id.unwrap()),db::i(g.me().id),db::i(db::now_ms())])?,
        audit::committed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "mapping.created",
            // The pattern is a bank actor label: never enter the audit log.
            // The mapped membership is the stable, non-sensitive identity.
            &format!("mapping:member-{}", id.unwrap()),
        )?,
    ])
    .await?;
    Ok(back(
        &g,
        "Mapping saved; existing transaction assignments were not changed",
    ))
}
pub async fn delete_mapping(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let _form = try_resp!(form_post(&g, &mut req).await);
    g.app.db.batch(vec![
        g.app.db.prepare(
            "DELETE FROM actor_mappings WHERE id=?1 AND org_id=?2",
        )
        .bind(&[db::i(id), db::i(g.org.id)])?,
        audit::committed_if_changed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "mapping.deleted",
            &format!("mapping:{id}"),
        )?,
    ])
    .await?;
    Ok(back(&g, "Mapping removed; historical assignments retained"))
}

pub async fn add_pocket(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let name = form_str(&form, "name")
        .unwrap_or_default()
        .trim()
        .to_string();
    let opening = form_str(&form, "opening_balance")
        .as_deref()
        .and_then(crate::fmt::parse_rupiah);
    let Some(opening) = opening else {
        return Ok(fail(400, "Supply an opening balance in IDR."));
    };
    if name.is_empty() || name.len() > 120 {
        return Ok(fail(400, "Pocket name must be 1–120 characters."));
    }
    if pockets_of(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case(&name))
    {
        return Ok(fail(400, "A pocket already uses that name."));
    }
    g.app.db.batch(vec![
        g.app.db.prepare(
            "INSERT INTO pockets(org_id,name,opening_balance_minor) VALUES(?1,?2,?3)",
        )
        .bind(&[db::i(g.org.id), db::s(&name), db::i(opening)])?,
        audit::committed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "pocket.created",
            &format!("pocket:{name}"),
        )?,
    ])
    .await?;
    Ok(back(&g, "Pocket created"))
}

pub async fn save_notifications(
    mut req: Request,
    ctx: RouteContext<App>,
) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::ManageNotifications
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let enabled = form_str(&form, "enabled").is_some();
    let cutoff = form_str(&form, "cutoff_date").unwrap_or_default();
    if enabled && !crate::fmt::valid_date(&cutoff) {
        return Ok(fail(
            400,
            "Choose a valid transaction-date cutoff before enabling notifications.",
        ));
    }
    if enabled {
        let token = form_str(&form, "preview_token").unwrap_or_default();
        let expected = auth::csrf_for_secret(
            g.app.secret.as_deref().unwrap_or_default(),
            &format!("notifications:{}:{cutoff}", g.org.id),
        );
        if token != expected {
            return Ok(fail(
                400,
                "Preview recipients for the selected cutoff before enabling notifications.",
            ));
        }
    }
    g.app.db.batch(vec![
        g.app.db.prepare(
            "UPDATE organizations SET notifications_enabled=?1,notification_cutoff_date=?2 WHERE id=?3",
        )
        .bind(&[
            db::i(i64::from(enabled)),
            db::opt_s((!cutoff.is_empty()).then_some(cutoff.as_str())),
            db::i(g.org.id),
        ])?,
        audit::committed_if_changed(
            &g.app.db,
            Some(g.org.id),
            &g.user.id,
            "notifications.settings_changed",
            &format!("organization:{}", g.org.slug),
        )?,
    ])
    .await?;
    if !enabled {
        db::exec(&g.app.db,"UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND cancelled_at IS NULL",
            vec![db::i(db::now_ms()),db::i(g.org.id)]).await?;
    }
    Ok(back(
        &g,
        "Notification settings saved; delivery remains local-outbox only",
    ))
}

pub async fn send_digest(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::ManageNotifications
        )
        .await
    );
    let _form = try_resp!(form_post(&g, &mut req).await);
    if !db::flag(g.org.notifications_enabled) {
        return Ok(fail(400, "Organization notifications are disabled."));
    }
    let targets = notify::digest_targets(&g.app.db, &g.org, &g.dom_org, &g.mems).await?;
    let last = notify::last_digest_ms(&g.app.db, g.org.id).await?;
    let now = db::now_ms();
    for (member, items) in targets.groups {
        if !notify::digest_due(last.get(&member.id).copied(), now) {
            continue;
        }
        notify::insert_row(
            &g.app.db,
            g.org.id,
            "digest",
            member.id,
            None,
            &format!("Documentation digest — {}", g.org.name),
            &notify::digest_body(&g.org.name, &g.org.slug, &items),
            now,
            Some(g.org.notification_revision),
        )
        .await?;
    }
    Ok(back(
        &g,
        "Eligible weekly digests captured locally; no email was sent",
    ))
}
