//! Append-only audit trail (`audit_events`). The request layer records intent
//! (`attempt`), rejections (`denied`) and failures (`failed`); the statement
//! that performs a change records `committed` inside the same transaction.
//! Never store request bodies, query strings, credentials, or amounts.
use super::*;
use crate::audit_rules as rules;

pub struct Attempt {
    actor: Option<String>,
    org: Option<i64>,
    action: &'static str,
    target: String,
    /// True when an attempt row was written (mutations and private
    /// downloads); false for watched private page views, where only explicit
    /// denials are ever recorded.
    intent: bool,
    /// Watched requests resolve their org scope lazily: only a recorded
    /// denial needs it, so ordinary page views skip the lookup.
    watch_slug: Option<String>,
}

/// Decide what the request layer observes and, for real intents, write the
/// attempt row before the handler runs.
pub async fn begin(app: &App, req: &Request) -> worker::Result<Option<Attempt>> {
    let path = req.path();
    let Some((action, intent)) = rules::observe(&path, req.method() == Method::Post) else {
        return Ok(None);
    };
    // Fixture sign-in pages carry a "preauth:" challenge session, not a user
    // identity; actor_id references users(id), so only real sessions count.
    let actor = session_from(req, app)
        .filter(|s| rules::is_real_actor(&s.uid))
        .map(|s| s.uid);
    let slug = rules::org_slug(&path);
    let org = if intent {
        match slug {
            Some(slug) => org_by_slug(&app.db, slug).await?.map(|o| o.id),
            None => None,
        }
    } else {
        None
    };
    let attempt = Attempt {
        actor,
        org,
        action,
        target: rules::normalize_target(&path),
        intent,
        watch_slug: if intent { None } else { slug.map(|s| s.to_string()) },
    };
    if intent {
        record(app, &attempt, "attempt").await?;
    }
    Ok(Some(attempt))
}

/// Classify the outcome at request end; a `None` classification (watched page
/// view, or success owned by the mutation's own transaction) writes nothing.
pub async fn finish(app: &App, attempt: Option<Attempt>, status: u16) -> worker::Result<()> {
    let Some(a) = attempt else {
        return Ok(());
    };
    let Some(outcome) = rules::classify(&a.target, a.action, a.intent, a.actor.is_some(), status)
    else {
        return Ok(());
    };
    let mut a = a;
    if let Some(slug) = a.watch_slug.take() {
        a.org = org_by_slug(&app.db, &slug).await?.map(|o| o.id);
    }
    record(app, &a, outcome).await
}

async fn record(app: &App, a: &Attempt, outcome: &str) -> worker::Result<()> {
    db::exec(
        &app.db,
        "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        vec![
            db::opt_s(a.actor.as_deref()),
            db::opt_i(a.org),
            db::s(a.action),
            db::s(&a.target),
            db::s(outcome),
            db::i(db::now_ms()),
        ],
    )
    .await
}

/// Committed-outcome statement to append to a mutation's D1 batch, so the
/// audit row commits atomically with the change it describes. Scope rule:
/// org-scoped handlers pass `Some(org_id)`; platform/global events pass None.
pub fn committed(
    db: &D1Database,
    org: Option<i64>,
    actor: &str,
    action: &str,
    target: &str,
) -> worker::Result<D1PreparedStatement> {
    Ok(db
        .prepare(
            "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)",
        )
        .bind(&[
            db::s(actor),
            db::opt_i(org),
            db::s(action),
            db::s(target),
            db::i(db::now_ms()),
        ])?)
}

/// Change-gated variant for single-statement UPDATE/DELETE mutations: the
/// audit row is written only when the immediately preceding statement in the
/// same batch matched a row (`changes() = 1`). A zero-row update or delete
/// therefore records no committed event, and the batch stays atomic.
pub fn committed_if_changed(
    db: &D1Database,
    org: Option<i64>,
    actor: &str,
    action: &str,
    target: &str,
) -> worker::Result<D1PreparedStatement> {
    Ok(db
        .prepare(
            "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,?3,?4,'committed',?5 WHERE changes()=1",
        )
        .bind(&[
            db::s(actor),
            db::opt_i(org),
            db::s(action),
            db::s(target),
            db::i(db::now_ms()),
        ])?)
}

/// One-shot committed event outside any mutation (authentication lifecycle).
pub async fn event(
    app: &App,
    actor: Option<&str>,
    org: Option<i64>,
    action: &str,
    target: &str,
) -> worker::Result<()> {
    db::exec(
        &app.db,
        "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)",
        vec![
            db::opt_s(actor),
            db::opt_i(org),
            db::s(action),
            db::s(target),
            db::i(db::now_ms()),
        ],
    )
    .await
}

/// One page of an organization's audit trail (org-admin scope: own org only).
pub async fn list_org(app: &App, org: i64, page: u32) -> worker::Result<Vec<platform::Event>> {
    db::q_all(
        &app.db,
        "SELECT * FROM audit_events WHERE org_id=?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3",
        vec![
            db::i(org),
            db::i(rules::PAGE_SIZE),
            db::i(rules::page_offset(page)),
        ],
    )
    .await
}

/// One page of the global trail (platform scope: org_id IS NULL only).
pub async fn list_platform(app: &App, page: u32) -> worker::Result<Vec<platform::Event>> {
    db::q_all(
        &app.db,
        "SELECT * FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        vec![db::i(rules::PAGE_SIZE), db::i(rules::page_offset(page))],
    )
    .await
}
