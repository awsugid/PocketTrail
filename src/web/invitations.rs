//! Pending invitations never grant access until explicitly accepted by
//! matching verified Google user, either from Organizations or through the
//! single-use emailed link. Delivery rows are durable: create/resend only
//! records send outcomes, they never undo the invitation itself.
use super::*;
use crate::audit_rules as rules;
use crate::tokens;
use serde::Deserialize;

#[path = "invitation_mail.rs"]
pub mod mail;

/// One pending invitation offered to the signed-in visitor (Organizations).
#[derive(Deserialize)]
pub struct Invitation {
    pub id: String,
    pub email: String,
    pub org_name: String,
    pub role_name: String,
    pub expires_at: i64,
}

pub async fn pending(db: &D1Database, email: &str) -> worker::Result<Vec<Invitation>> {
    db::q_all(db, "SELECT i.id,i.email,o.name AS org_name,r.name AS role_name,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.org_id JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.email=?1 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2", vec![db::s(email),db::i(db::now_ms())]).await
}

fn origin_of(req: &Request) -> String {
    req.url()
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default()
}

/// Random id (existing behavior) and random single-use link token.
/// Raw tokens live in the emailed link only; D1 stores the SHA-256 hash.
fn new_random() -> worker::Result<[u8; 32]> {
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random)
        .map_err(|_| worker::Error::RustError("Identifier unavailable".into()))?;
    Ok(random)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Still-open invitation a manager can resend, scoped to their org.
#[derive(Deserialize)]
struct OpenInvitation {
    email: String,
    role_name: String,
    expires_at: i64,
}

async fn open_invitation(
    db: &D1Database,
    org_id: i64,
    id: &str,
    now: i64,
) -> worker::Result<Option<OpenInvitation>> {
    db::q_one(
        db,
        "SELECT i.email,r.name AS role_name,i.expires_at FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?1 AND i.org_id=?2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3",
        vec![db::s(id), db::i(org_id), db::i(now)],
    )
    .await
}

pub async fn create(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let email = form_str(&form, "email")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !crate::profile::valid_email(&email) {
        return Ok(fail(400, "Enter a valid email address."));
    }
    let role = form_str(&form, "role_id")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let roles = roles_of_org(&g.app.db, g.org.id).await?;
    if !roles.iter().any(|r| r.id == role) {
        return Ok(fail(400, "Choose an organization role."));
    }
    if g.mems
        .iter()
        .any(|m| m.active() && m.email.eq_ignore_ascii_case(&email))
    {
        return Ok(fail(400, "This person is already an active member."));
    }
    let role_name = roles
        .iter()
        .find(|r| r.id == role)
        .map(|r| r.name.clone())
        .unwrap_or_default();
    let id = hex(&new_random()?);
    let token = tokens::encode(new_random()?);
    let now = db::now_ms();
    let expires_at = now + 7 * 86400000;
    let statements = vec![
      g.app.db.prepare("UPDATE invitations SET revoked_at=?1 WHERE org_id=?2 AND email=?3 COLLATE NOCASE AND revoked_at IS NULL AND accepted_at IS NULL").bind(&[db::i(now),db::i(g.org.id),db::s(&email)])?,
      g.app.db.prepare("INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)").bind(&[db::s(&id),db::i(g.org.id),db::s(&email),db::i(role),db::s(&g.user.id),db::i(now),db::i(expires_at)])?,
      g.app.db.prepare("INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) VALUES(?1,?2,'pending',?3)").bind(&[db::s(&id),db::s(&tokens::hash(&token)),db::i(now)])?,
      audit::committed(&g.app.db, Some(g.org.id), &g.user.id, "invitation.created", &rules::normalize_target(&req.path()))?,
    ];
    g.app.db.batch(statements).await?;
    let outcome = mail::deliver(
        &ctx.env,
        &g.app.db,
        &id,
        &token,
        &g.org.name,
        &role_name,
        expires_at,
        &email,
        &origin_of(&req),
    )
    .await?;
    Ok(redirect(&format!(
        "/org/{slug}/settings?{}",
        mail::msg_query(&outcome.message())
    )))
}

pub async fn resend(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let _ = try_resp!(form_post(&g, &mut req).await);
    let id = path_param(&ctx, "id");
    let now = db::now_ms();
    let Some(inv) = open_invitation(&g.app.db, g.org.id, &id, now).await? else {
        return Ok(fail(404, "Invitation not found."));
    };
    let token = tokens::encode(new_random()?);
    // The batch itself re-validates that the invitation is still open, so a
    // concurrent revoke/accept between the pre-check above and this batch
    // produces no supersede, no new delivery row, no audit event, no send.
    let statements = vec![
      g.app.db.prepare("UPDATE invitation_mail SET status='superseded' WHERE invitation_id=?1 AND status!='superseded' AND EXISTS(SELECT 1 FROM invitations i WHERE i.id=?1 AND i.org_id=?2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3)").bind(&[db::s(&id),db::i(g.org.id),db::i(now)])?,
      g.app.db.prepare("INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) SELECT ?1,?2,'pending',?3 WHERE EXISTS(SELECT 1 FROM invitations i WHERE i.id=?1 AND i.org_id=?4 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3)").bind(&[db::s(&id),db::s(&tokens::hash(&token)),db::i(now),db::i(g.org.id)])?,
      g.app.db.prepare("INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.resent',?2,'committed',?5 FROM invitations i WHERE i.id=?3 AND (SELECT changes())=1").bind(&[db::s(&g.user.id),db::s(&rules::normalize_target(&req.path())),db::s(&id),db::i(g.org.id),db::i(now)])?,
    ];
    let results = g.app.db.batch(statements).await?;
    let inserted = results
        .get(1)
        .and_then(|r| r.meta().ok().flatten())
        .and_then(|m| m.changes)
        .unwrap_or(0)
        == 1;
    if !inserted {
        return Ok(fail(404, "Invitation is no longer open."));
    }
    let outcome = mail::deliver(
        &ctx.env,
        &g.app.db,
        &id,
        &token,
        &g.org.name,
        &inv.role_name,
        inv.expires_at,
        &inv.email,
        &origin_of(&req),
    )
    .await?;
    Ok(redirect(&format!(
        "/org/{slug}/settings?{}",
        mail::msg_query(&outcome.message())
    )))
}

pub async fn revoke(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g =
        try_resp!(require_member(ctx.data.clone(), &req, &slug, Permission::ManageMembers).await);
    let _ = try_resp!(form_post(&g, &mut req).await);
    g.app.db.batch(vec![
      g.app.db.prepare("UPDATE invitations SET revoked_at=?1 WHERE id=?2 AND org_id=?3 AND accepted_at IS NULL AND revoked_at IS NULL").bind(&[db::i(db::now_ms()),db::s(&path_param(&ctx,"id")),db::i(g.org.id)])?,
      g.app.db.prepare("INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.revoked',?2,'committed',?5 FROM invitations i WHERE i.id=?3 AND i.org_id=?4 AND (SELECT changes())=1").bind(&[db::s(&g.user.id),db::s(&rules::normalize_target(&req.path())),db::s(&path_param(&ctx,"id")),db::i(g.org.id),db::i(db::now_ms())])?,
    ]).await?;
    Ok(redirect(&format!("/org/{slug}/settings")))
}

/// The two acceptance statements for an invitation: grant (restoring a
/// removed membership is allowed; an active membership is never touched) and
/// mark accepted only when the grant took effect. Both run atomically; no
/// stale invitation/role snapshot can grant access.
///
/// `gate` = Some(token_hash) for emailed-link acceptance: the grant AND the
/// acceptance are additionally joined/guarded on that hash still being a
/// `sent` delivery row, inside the same atomic batch — a concurrent resend
/// that supersedes the token between the earlier pre-check and this batch
/// makes both statements write nothing. In-app acceptance passes None
/// (id-keyed, unchanged foundation SQL).
fn accept_statements(
    db: &D1Database,
    user_id: &str,
    invitation_id: &str,
    email: &str,
    now: i64,
    gate: Option<&str>,
) -> worker::Result<Vec<D1PreparedStatement>> {
    if let Some(hash) = gate {
        return Ok(vec![
      db.prepare("INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) SELECT i.org_id,?1,i.role_id,?1,?2 FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id JOIN invitation_mail im ON im.invitation_id=i.id AND im.token_hash=?5 AND im.status='sent' WHERE i.id=?3 AND i.email=?4 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2 ON CONFLICT(org_id,user_id) DO UPDATE SET role_id=excluded.role_id,removed_at=NULL WHERE memberships.removed_at IS NOT NULL").bind(&[db::s(user_id),db::i(now),db::s(invitation_id),db::s(email),db::s(hash)])?,
      db.prepare("UPDATE invitations SET accepted_at=?1,accepted_by=?2 WHERE id=?3 AND email=?4 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=invitations.org_id AND m.user_id=?2 AND m.removed_at IS NULL) AND EXISTS(SELECT 1 FROM invitation_mail x WHERE x.invitation_id=invitations.id AND x.token_hash=?5 AND x.status='sent')").bind(&[db::i(now),db::s(user_id),db::s(invitation_id),db::s(email),db::s(hash)])?,
        ]);
    }
    Ok(vec![
      db.prepare("INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) SELECT i.org_id,?1,i.role_id,?1,?2 FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?3 AND i.email=?4 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2 ON CONFLICT(org_id,user_id) DO UPDATE SET role_id=excluded.role_id,removed_at=NULL WHERE memberships.removed_at IS NOT NULL").bind(&[db::s(user_id),db::i(now),db::s(invitation_id),db::s(email)])?,
      db.prepare("UPDATE invitations SET accepted_at=?1,accepted_by=?2 WHERE id=?3 AND email=?4 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=invitations.org_id AND m.user_id=?2 AND m.removed_at IS NULL)").bind(&[db::i(now),db::s(user_id),db::s(invitation_id),db::s(email)])?,
    ])
}

/// True when the acceptance UPDATE (batch statement index 1) actually wrote:
/// D1 meta `changes` proves the transition happened in THIS batch — replayed,
/// wrong-recipient, or superseded-token attempts write 0 and fail closed.
fn accepted_in_batch(results: &[worker::d1::D1Result]) -> bool {
    results
        .get(1)
        .and_then(|r| r.meta().ok().flatten())
        .and_then(|m| m.changes)
        .unwrap_or(0)
        == 1
}

/// Committed audit row that only lands when THIS batch actually accepted the
/// invitation. Runs last in the same D1 batch: the acceptance UPDATE right
/// before it writes a row only on a real transition, so `(SELECT changes())=1`
/// gates the audit to that write atomically - a rejected, replayed, or
/// already-accepted attempt (any timestamp, including the same millisecond)
/// writes no audit row. Org scope comes from the invitation row itself.
fn accept_audit(
    db: &D1Database,
    user_id: &str,
    invitation_id: &str,
    target: &str,
    now: i64,
) -> worker::Result<D1PreparedStatement> {
    db.prepare(
        "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.accepted',?2,'committed',?4 FROM invitations i WHERE i.id=?3 AND (SELECT changes())=1",
    )
    .bind(&[db::s(user_id), db::s(target), db::s(invitation_id), db::i(now)])
}

/// In-app acceptance from Organizations (POST /invitations/:id/accept).
pub async fn accept(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let login = try_resp!(require_login(ctx.data.clone(), &req).await);
    let _ = try_resp!(super::platform::form(&login, &mut req).await);
    if login.user.google_sub.is_none() {
        return Ok(fail(403, "Verified Google sign-in required."));
    }
    let id = path_param(&ctx, "id");
    let now = db::now_ms();
    // Explicit no-op: expired, revoked, already accepted, or wrong recipient
    // is a 404, never a silent redirect.
    let open: Option<serde_json::Value> = db::q_one(
        &login.app.db,
        "SELECT 1 AS ok FROM invitations WHERE id=?1 AND email=?2 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?3",
        vec![db::s(&id), db::s(&login.user.email), db::i(now)],
    )
    .await?;
    if open.is_none() {
        return Ok(fail(404, "This invitation is no longer available."));
    }
    let mut statements = accept_statements(&login.app.db, &login.user.id, &id, &login.user.email, now, None)?;
    statements.push(accept_audit(&login.app.db, &login.user.id, &id, &rules::normalize_target(&req.path()), now)?);
    let results = login.app.db.batch(statements).await?;
    if !accepted_in_batch(&results) {
        return Ok(fail(403, "This invitation could not be accepted."));
    }
    Ok(redirect("/orgs"))
}

/// One-time lookup binding an emailed token to a still-open invitation.
#[derive(Deserialize)]
struct TokenTarget {
    invitation_id: String,
}

async fn token_target(db: &D1Database, token: &str, now: i64) -> worker::Result<Option<TokenTarget>> {
    db::q_one(
        db,
        "SELECT im.invitation_id AS invitation_id FROM invitation_mail im JOIN invitations i ON i.id=im.invitation_id WHERE im.token_hash=?1 AND im.status='sent' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2",
        vec![db::s(&tokens::hash(token)), db::i(now)],
    )
    .await
}

/// Acceptance page for the emailed link (GET /invitations/accept?token=...).
/// No login required to VIEW the invitation; granting access still needs a
/// signed-in verified Google account whose email matches. Inline HTML until
/// a proper template exists (owned by the UX worker). The token never lands
/// in audit rows, logs, or redirects; the page is no-store and ships
/// `Referrer-Policy: no-referrer` so the link URL is never leaked onward.
pub async fn accept_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let Some(token) = query_param(&req, "token").filter(|t| !t.is_empty()) else {
        return Ok(fail(404, "This invitation link is not valid."));
    };
    let app = ctx.data.clone();
    let now = db::now_ms();
    let Some(target) = token_target(&app.db, &token, now).await? else {
        return Ok(fail(404, "This invitation link is no longer valid."));
    };
    let Some(inv) = pending_for(&app.db, &target.invitation_id, now).await? else {
        return Ok(fail(404, "This invitation link is no longer valid."));
    };
    let esc = crate::render::html_escape;
    let login = require_login(app, &req).await.ok();
    let action = match &login {
        None => format!(
            "<p><a href=\"/login\">Sign in</a> with the Google account for <strong>{}</strong> to accept.</p>",
            esc(&inv.email)
        ),
        Some(l) if l.user.google_sub.is_none() => {
            "<p>Acceptance requires a verified Google sign-in.</p>".to_string()
        }
        Some(l) if !l.user.email.eq_ignore_ascii_case(&inv.email) => format!(
            "<p>You are signed in as <strong>{}</strong>, but this invitation is for <strong>{}</strong>. Sign in with that Google account to accept.</p>",
            esc(&l.user.email),
            esc(&inv.email)
        ),
        Some(l) => format!(
            "<form method=\"post\" action=\"/invitations/accept\"><input type=\"hidden\" name=\"csrf_token\" value=\"{}\"><input type=\"hidden\" name=\"token\" value=\"{}\"><button class=\"btn btn--primary\" type=\"submit\">Accept invitation</button></form>",
            esc(&l.session.csrf),
            esc(&token)
        ),
    };
    let mut resp = html(
        200,
        format!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Invitation — {}</title></head><body><h1>Invitation to {}</h1><p>You are invited to join <strong>{}</strong> as <strong>{}</strong>.</p><p>Expires {}.</p>{}<p>This link is single-use and stops working when the invitation is revoked.</p></body></html>",
            esc(&inv.org_name),
            esc(&inv.org_name),
            esc(&inv.org_name),
            esc(&inv.role_name),
            esc(&crate::smtp::format_date_ms(inv.expires_at)),
            action
        ),
    );
    let _ = resp.headers_mut().set("Referrer-Policy", "no-referrer");
    Ok(resp)
}

/// Still-open invitation details for display (org/role names joined).
#[derive(Deserialize)]
struct InvitationDetail {
    email: String,
    org_name: String,
    role_name: String,
    expires_at: i64,
}

async fn pending_for(
    db: &D1Database,
    id: &str,
    now: i64,
) -> worker::Result<Option<InvitationDetail>> {
    db::q_one(
        db,
        "SELECT i.email,o.name AS org_name,r.name AS role_name,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.org_id JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2",
        vec![db::s(id), db::i(now)],
    )
    .await
}

/// Emailed-link acceptance (POST /invitations/accept, token in the form).
pub async fn accept_link(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let login = try_resp!(require_login(ctx.data.clone(), &req).await);
    let form = try_resp!(super::platform::form(&login, &mut req).await);
    if login.user.google_sub.is_none() {
        return Ok(fail(403, "Verified Google sign-in required."));
    }
    let Some(token) = form_str(&form, "token").filter(|t| !t.is_empty()) else {
        return Ok(fail(404, "This invitation link is not valid."));
    };
    let now = db::now_ms();
    let Some(target) = token_target(&login.app.db, &token, now).await? else {
        return Ok(fail(404, "This invitation link is no longer valid."));
    };
    let mut statements = accept_statements(&login.app.db, &login.user.id, &target.invitation_id, &login.user.email, now, Some(&tokens::hash(&token)))?;
    statements.push(accept_audit(&login.app.db, &login.user.id, &target.invitation_id, &rules::normalize_target(&req.path()), now)?);
    let results = login.app.db.batch(statements).await?;
    if !accepted_in_batch(&results) {
        return Ok(fail(403, "This invitation could not be accepted."));
    }
    Ok(redirect("/orgs"))
}
