//! Transaction routes: list, detail, manual create, documentation edits,
//! submit/approve/request-changes, comments, evidence, suppression.
//!
//! Domain decisions flow through pockettrail-domain; this module owns
//! persistence and the HTTP shape. Bank records keep signed amounts; purpose
//! splits are positive magnitudes summing to abs(bank amount).

use super::*;
use pockettrail_domain::{
    approve_transaction, request_changes as dom_request_changes, submit_transaction, Permission,
    Transaction as DomTxn,
};

async fn load_full(
    db: &D1Database,
    org: &OrgRow,
    txn_id: i64,
) -> worker::Result<Option<(TxnRow, Vec<SplitRow>, Vec<CommentRow>, Vec<DocRow>)>> {
    let Some(t) = txn_by_id(db, org.id, txn_id).await? else {
        return Ok(None);
    };
    let splits = splits_of(db, txn_id).await?;
    let comments = comments_of(db, txn_id).await?;
    let evidence = evidence_of(db, txn_id).await?;
    Ok(Some((t, splits, comments, evidence)))
}

/// Parent invariant: every assigned responsible member (transaction-level and
/// explicit split-level) must be an active member of this organization.
fn validate_responsibles_active(
    t: &TxnRow,
    splits: &[SplitRow],
    mems: &[MemRow],
) -> Result<(), String> {
    let check = |id: Option<i64>, what: &str| -> Result<(), String> {
        if let Some(id) = id {
            let m = mems.iter().find(|m| m.id == id);
            match m {
                None => return Err(format!("{what} references an unknown member")),
                Some(m) if !m.active() => {
                    return Err(format!("{what} is assigned to removed member {}", m.name))
                }
                _ => {}
            }
        }
        Ok(())
    };
    check(t.responsible_membership_id, "Responsible member")?;
    for s in splits {
        check(s.responsible_membership_id, "Purpose responsible member")?;
    }
    Ok(())
}

/// Parent invariant: reassignment must not launder self-approval. Approval is
/// denied to anyone who was EVER responsible for this transaction (the domain
/// aggregate carries the same exclusions; this pre-check gives a clear 403).
async fn responsible_history_ids(db: &D1Database, txn_id: i64) -> worker::Result<Vec<i64>> {
    aggregate::history_of(db, txn_id).await
}

async fn record_responsible_history(
    db: &D1Database,
    txn_id: i64,
    t: &TxnRow,
    splits: &[SplitRow],
) -> worker::Result<()> {
    let now = db::now_ms();
    let mut ids: Vec<i64> = Vec::new();
    if let Some(id) = t.responsible_membership_id {
        ids.push(id);
    }
    for s in splits {
        if let Some(id) = s.responsible_membership_id {
            ids.push(id);
        }
    }
    for id in ids {
        db::exec(
            db,
            "INSERT OR IGNORE INTO responsible_history (transaction_id, membership_id, since) VALUES (?1, ?2, ?3)",
            vec![db::i(txn_id), db::i(id), db::i(now)],
        )
        .await?;
    }
    Ok(())
}

/// Parsed split rows from the parallel form arrays after validation.
struct ValidSplit {
    label: String,
    amount_minor: i64,
    responsible: Option<i64>,
}

/// Parse + validate the split form arrays. Purpose amounts are positive
/// magnitudes (bank record carries the sign); blanks form rows are dropped.
fn parse_splits(
    labels: &[String],
    amounts: &[String],
    members: &[String],
    bank_abs: i64,
) -> Result<Vec<ValidSplit>, String> {
    if labels.len() != amounts.len() || labels.len() != members.len() {
        return Err("purpose rows are malformed".into());
    }
    if labels.len() > 100 {
        return Err("At most 100 purposes can be recorded on one transaction.".into());
    }
    let mut out = Vec::new();
    for (i, ((label, amount), member)) in labels.iter().zip(amounts).zip(members).enumerate() {
        let label_t = label.trim();
        let amount_t = amount.trim();
        if label_t.is_empty() && amount_t.is_empty() {
            continue; // untouched default row
        }
        if label_t.is_empty() {
            return Err(format!("purpose row {} has an empty label", i + 1));
        }
        if label_t.len() > 300 {
            return Err(format!("purpose row {} label too long", i + 1));
        }
        let parsed = crate::fmt::parse_rupiah(amount_t)
            .ok_or_else(|| format!("purpose row {} has an invalid amount", i + 1))?;
        if parsed <= 0 {
            return Err(format!(
                "purpose row {} amount must be a positive magnitude (the bank record carries the sign)",
                i + 1
            ));
        }
        let responsible = match member.trim() {
            "" => None,
            m => Some(
                m.parse::<i64>()
                    .map_err(|_| "purpose row has an invalid member")?,
            ),
        };
        out.push(ValidSplit {
            label: label_t.to_string(),
            amount_minor: parsed,
            responsible,
        });
    }
    // Overflow-checked total (parent invariant).
    let total = out
        .iter()
        .try_fold(0i128, |acc, s| acc.checked_add(s.amount_minor as i128))
        .ok_or("purpose total overflows")?;
    if !out.is_empty() && total != bank_abs as i128 {
        return Err(format!(
            "Purpose allocations must add up to {}.",
            crate::fmt::fmt_money(bank_abs)
        ));
    }
    Ok(out)
}

fn build_dom_from_rows(
    g: &Ctx,
    t: &TxnRow,
    splits: &[SplitRow],
    comments: &[CommentRow],
    evidence: &[DocRow],
    exclusions: &[i64],
) -> DomTxn {
    build_dom_txn(
        &g.org, &g.dom_org, t, splits, comments, evidence, &g.mems, exclusions,
    )
}

// ------------------------------------------------------------------ list

pub async fn list(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let status = query_param(&req, "status").filter(|s| !s.is_empty() && s != "all");
    let g = try_resp!(require_member(app, &req, &slug, Permission::ViewTransactions).await);
    let page_number = query_param(&req, "page")
        .and_then(|n| n.parse::<i64>().ok())
        .filter(|n| (1..=1_000_000).contains(n))
        .unwrap_or(1);
    let mut rows = txn_list_page(
        &g.app.db,
        g.org.id,
        status.as_deref(),
        (page_number - 1) * 50,
        51,
    )
    .await?;
    let has_next = rows.len() > 50;
    rows.truncate(50);
    let txns: Vec<serde_json::Value> = rows
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id,
                "date": t.txn_date,
                "time": t.txn_time.clone().unwrap_or_default(),
                "counterparty": t.counterparty,
                "counterparty_display": pockettrail_jago_parser::counterparty_display(&t.counterparty),
                "pocket_name": t.pocket_name,
                "transaction_type": t.transaction_type,
                "amount_minor": t.amount_minor,
                "balance_minor": t.balance_minor.unwrap_or(0),
                "status": t.status,
                "needs_details": t.needs_details(),
                "suppressed": db::flag(t.suppressed),
                "responsible_name": t.responsible_name.clone(),
            })
        })
        .collect();
    let mut body = g
        .base_json("transactions", query_param(&req, "msg").as_deref(), None)
        .await;
    body["txns"] = serde_json::json!(txns);
    body["filters"] = serde_json::json!({"status": status.clone().unwrap_or_else(|| "all".into())});
    body["page_number"] = serde_json::json!(page_number);
    body["has_next"] = serde_json::json!(has_next);
    body["can_import"] = serde_json::json!(g.can(Permission::ImportStatements));
    Ok(page(&g.app, "transactions", body))
}

// ------------------------------------------------------------------ create

pub async fn new_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::ViewTransactions).await);
    let pockets = pockets_of(&g.app.db, g.org.id).await?;
    let mut body = g.base_json("transactions", None, None).await;
    body["pockets"] = serde_json::json!(pockets
        .iter()
        .map(|p| serde_json::json!({"id": p.id, "name": p.name}))
        .collect::<Vec<_>>());
    body["members"] = serde_json::json!(active_members_json(&g));
    Ok(page(&g.app, "transaction_new", body))
}

fn active_members_json(g: &Ctx) -> Vec<serde_json::Value> {
    g.mems
        .iter()
        .filter(|m| m.active())
        .map(|m| serde_json::json!({"id": m.id, "name": m.name, "handle":m.handle}))
        .collect()
}

pub async fn create(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let g = try_resp!(require_member(app, &req, &slug, Permission::DocumentTransactions).await);
    let form = try_resp!(form_post(&g, &mut req).await);
    let pocket_id: i64 = form_str(&form, "pocket_id")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let pockets = pockets_of(&g.app.db, g.org.id).await?;
    if !pockets.iter().any(|p| p.id == pocket_id) {
        return Ok(fail(400, "Unknown pocket for this organization."));
    }
    let date = form_str(&form, "date").unwrap_or_default();
    let time = form_str(&form, "time").unwrap_or_default();
    if !crate::fmt::valid_date(&date) {
        return Ok(fail(400, "Date must be YYYY-MM-DD."));
    }
    let time = if time.is_empty() {
        None
    } else if crate::fmt::valid_time(&time) {
        Some(time)
    } else {
        return Ok(fail(400, "Time must be HH:MM."));
    };
    let counterparty = form_str(&form, "counterparty")
        .unwrap_or_default()
        .trim()
        .to_string();
    if counterparty.is_empty() {
        return Ok(fail(400, "Counterparty is required."));
    }
    let amount = match form_str(&form, "amount_minor")
        .as_deref()
        .and_then(crate::fmt::parse_minor)
    {
        Some(v) if v != 0 => v,
        _ => {
            return Ok(fail(
                400,
                "Amount (minor units) must be a nonzero integer; negative = outflow.",
            ))
        }
    };
    let balance = form_str(&form, "balance_minor")
        .as_deref()
        .and_then(crate::fmt::parse_minor);
    let responsible: Option<i64> =
        form_str(&form, "responsible_member_id").and_then(|s| s.parse().ok());
    if let Some(id) = responsible {
        if aggregate::active_mem(&g.mems, Some(id)).is_none() {
            return Ok(fail(
                400,
                "Responsible member must be an active member of this organization.",
            ));
        }
    }
    let now = db::now_ms();
    db::exec(
        &g.app.db,
        "INSERT INTO transactions (org_id, pocket_id, bank_id, txn_date, txn_time, counterparty, transaction_type, bank_notes, amount_minor, balance_minor, explanation, responsible_membership_id, status, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?12)",
        vec![
            db::i(g.org.id), db::i(pocket_id), db::s(&date), db::opt_s(time.as_deref()),
            db::s(&counterparty), db::s(&form_str(&form, "transaction_type").unwrap_or_default()),
            db::s(&form_str(&form, "notes").unwrap_or_default()), db::i(amount), db::opt_i(balance),
            db::s(&form_str(&form, "explanation").unwrap_or_default()), db::opt_i(responsible), db::i(now),
        ],
    )
    .await?;
    let created: Option<TxnRow> = db::q_one(
        &g.app.db,
        "SELECT * FROM transactions WHERE org_id = ?1 ORDER BY id DESC LIMIT 1",
        vec![db::i(g.org.id)],
    )
    .await?;
    if let (Some(t), Some(_)) = (&created, responsible) {
        record_responsible_history(&g.app.db, t.id, t, &[]).await?;
    }
    let id = created.map(|t| t.id).unwrap_or(0);
    Ok(redirect(&format!(
        "/org/{}/transactions/{id}?msg=Created",
        slug
    )))
}

// ------------------------------------------------------------------ detail

pub async fn detail(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let app = ctx.data.clone();
    let slug = path_param(&ctx, "org");
    let txn_id: i64 = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(require_member(app, &req, &slug, Permission::ViewTransactions).await);
    let Some((t, splits, comments, evidence)) = load_full(&g.app.db, &g.org, txn_id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    let pocket: Option<PocketRow> = db::q_one(
        &g.app.db,
        "SELECT * FROM pockets WHERE id = ?1",
        vec![db::i(t.pocket_id)],
    )
    .await?;
    let exclusions = aggregate::history_of(&g.app.db, t.id).await?;
    let dom = build_dom_txn(
        &g.org,
        &g.dom_org,
        &t,
        &splits,
        &comments,
        &evidence,
        &g.mems,
        &exclusions,
    );

    // Approval eligibility probed with the real domain rule.
    let mut probe = dom.clone();
    let approval = match approve_transaction(&g.dom_org, &mut probe, &g.uid()) {
        Ok(()) => serde_json::json!({"eligible": true}),
        Err(e) => serde_json::json!({"eligible": false, "ineligible_reason": e.to_string()}),
    };

    let split_total = splits.iter().map(|s| s.amount_minor as i128).sum::<i128>();
    let bank_abs = t.amount_minor.checked_abs().unwrap_or(0);
    let totals = if splits.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::json!({
            "amount_minor": bank_abs,
            "split_total_minor": split_total,
            "balanced": split_total == bank_abs as i128,
        })
    };

    // needs_details: documentation still owed (Draft/ChangesRequested domain
    // states), derived from completeness without splits (badge approximation;
    // submit/approve enforce the full rule).
    let docs_complete = pockettrail_domain::validate_documentation(&dom).is_ok()
        && validate_responsibles_active(&t, &splits, &g.mems).is_ok()
        && active_mem(&g.mems, t.responsible_membership_id).is_some();
    let needs_details = crate::domain_map::documentation_owed(&t.status, docs_complete);
    let txn_json = serde_json::json!({
        "id": t.id,
        "revision": t.revision,
        "date": t.txn_date,
        "time": t.txn_time.clone().unwrap_or_default(),
        "counterparty": t.counterparty,
        "counterparty_display": pockettrail_jago_parser::counterparty_display(&t.counterparty),
        "transaction_type": t.transaction_type,
        "notes": t.bank_notes,
        "amount_minor": t.amount_minor,
        "amount_magnitude_minor": bank_abs,
        "balance_minor": t.balance_minor,
        "bank_id": t.bank_id.clone().unwrap_or_default(),
        "pocket_name": pocket.map(|p| p.name).unwrap_or_default(),
        "explanation": t.explanation,
        "evidence_unavailable_reason": t.evidence_unavailable_reason,
        "responsible_name": g.mem_name(t.responsible_membership_id),
        "responsible_member_id": t.responsible_membership_id,
        "responsible_inactive": t.responsible_membership_id.is_some()
            && active_mem(&g.mems,t.responsible_membership_id).is_none(),
        "status": t.status,
        "needs_details": needs_details,
        "suppressed": db::flag(t.suppressed),
        "suppressed_reason": t.suppressed_reason,
    });

    let splits_json: Vec<serde_json::Value> = splits
        .iter()
        .map(|s| {
            serde_json::json!({
                "label": s.label,
                "amount_minor": s.amount_minor,
                "amount_rupiah": crate::fmt::rupiah_input(s.amount_minor),
                "responsible_name": g.mem_name(s.responsible_membership_id),
                "responsible_member_id": s.responsible_membership_id,
            })
        })
        .collect();
    let evidence_json: Vec<serde_json::Value> = evidence
        .iter()
        .map(|d| {
            serde_json::json!({
                "filename": d.filename,
                "size": d.size_bytes,
                "size_display": crate::fmt::fmt_size(d.size_bytes),
                "note": d.note,
                "url": format!("/org/{}/documents/{}", slug, d.id),
            })
        })
        .collect();
    let comments_json: Vec<serde_json::Value> = comments
        .iter()
        .map(|c| {
            serde_json::json!({
                "author_name": c.author_name,
                "body": c.body,
                "created_at": crate::fmt::fmt_ts(c.created_at),
            })
        })
        .collect();

    let mut body = g
        .base_json("transactions", query_param(&req, "msg").as_deref(), None)
        .await;
    body["txn"] = txn_json;
    body["splits"] = serde_json::json!(splits_json);
    body["totals"] = totals;
    body["members"] = serde_json::json!(active_members_json(&g));
    body["evidence"] = serde_json::json!(evidence_json);
    body["comments"] = serde_json::json!(comments_json);
    body["approval"] = approval;
    let audit:Vec<AuditView>=db::q_all(&g.app.db,
        "SELECT a.action,a.previous_status,a.new_status,a.details,a.created_at,u.name AS author_name FROM transaction_audit a JOIN memberships m ON m.id=a.actor_membership_id JOIN users u ON u.id=m.user_id WHERE a.org_id=?1 AND a.transaction_id=?2 ORDER BY a.id DESC LIMIT 100",
        vec![db::i(g.org.id),db::i(txn_id)]).await?;
    // Keep the latest review decision readable without opening raw audit history.
    if let Some(decision) = audit
        .iter()
        .find(|a| matches!(a.action.as_str(), "approved" | "changes_requested"))
    {
        let details: serde_json::Value =
            serde_json::from_str(&decision.details).unwrap_or_default();
        body["review_decision"] = serde_json::json!({
            "status": decision.new_status,
            "author_name": decision.author_name,
            "created_at": crate::fmt::fmt_ts(decision.created_at),
            "note": details.get("note").and_then(|v| v.as_str()).unwrap_or_default(),
        });
    }
    body["audit"]=serde_json::json!(audit.iter().map(|a|serde_json::json!({
        "action":a.action,"previous_status":a.previous_status,"new_status":a.new_status,
        "details":a.details,"author_name":a.author_name,"created_at":crate::fmt::fmt_ts(a.created_at)
    })).collect::<Vec<_>>());
    body["can"] = serde_json::json!({
        "edit": g.can(Permission::DocumentTransactions),
        "approve": g.can(Permission::ApproveTransactions),
        "request_changes": g.can(Permission::ApproveTransactions),
        "comment": g.can(Permission::CommentTransactions),
        "suppress": g.can(Permission::SuppressNotifications),
        "upload": g.can(Permission::DocumentTransactions),
        "submit": g.can(Permission::DocumentTransactions) && docs_complete
            && t.status=="changes_requested",
    });
    Ok(page(&g.app, "transaction", body))
}

#[derive(serde::Deserialize)]
struct AuditView {
    action: String,
    previous_status: String,
    new_status: String,
    details: String,
    author_name: String,
    created_at: i64,
}

fn random_token() -> worker::Result<String> {
    let mut bytes = [0_u8; 24];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| worker::Error::RustError("Random identifier unavailable".into()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn destination(g: &Ctx, id: i64, message: &str) -> Response {
    redirect(&format!(
        "/org/{}/transactions/{id}?msg={}",
        g.org.slug,
        url::form_urlencoded::byte_serialize(message.as_bytes()).collect::<String>()
    ))
}

fn require_revision(form: &FormData, t: &TxnRow) -> Result<(), Response> {
    if form_str(form, "revision").and_then(|s| s.parse::<i64>().ok()) != Some(t.revision) {
        return Err(fail(
            409,
            "This form is out of date. Reload the transaction before changing or reviewing it.",
        ));
    }
    Ok(())
}

fn snapshot(t: &TxnRow, splits: &[SplitRow]) -> serde_json::Value {
    serde_json::json!({
        "explanation":t.explanation,
        "responsible_member_id":t.responsible_membership_id,
        "evidence_unavailable_reason":t.evidence_unavailable_reason,
        "purposes":splits.iter().map(|s|serde_json::json!({
            "label":s.label,"amount_minor":s.amount_minor,
            "responsible_member_id":s.responsible_membership_id
        })).collect::<Vec<_>>()
    })
}

fn audit_statement(
    g: &Ctx,
    t: &TxnRow,
    action: &str,
    status: &str,
    details: serde_json::Value,
    token: &str,
) -> worker::Result<D1PreparedStatement> {
    g.app.db.prepare(
        "INSERT INTO transaction_audit (org_id,transaction_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS (SELECT 1 FROM transactions WHERE id=?2 AND org_id=?1 AND mutation_token=?9)"
    ).bind(&[
        db::i(g.org.id),db::i(t.id),db::i(g.me().id),db::s(action),db::s(&t.status),
        db::s(status),db::s(&details.to_string()),db::i(db::now_ms()),db::s(token)
    ])
}

async fn commit_mutation(g:&Ctx,id:i64,token:&str,mut statements:Vec<D1PreparedStatement>)->worker::Result<bool>{
    // D1 meta.changes includes trigger writes. Read the operation token inside
    // the same atomic batch instead of interpreting that aggregate count.
    #[derive(serde::Deserialize)]
    struct Winner { won:i64 }
    statements.push(g.app.db.prepare(
        "SELECT mutation_token=?1 AS won FROM transactions WHERE id=?2 AND org_id=?3"
    ).bind(&[db::s(token),db::i(id),db::i(g.org.id)])?);
    let results=g.app.db.batch(statements).await?;
    let rows=results.last().ok_or_else(||worker::Error::RustError("Mutation result missing".into()))?
        .results::<Winner>()?;
    Ok(rows.first().is_some_and(|r|r.won==1))
}

pub async fn save_details(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::DocumentTransactions
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let Some((t, old_splits, _, evidence)) = load_full(&g.app.db, &g.org, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    try_resp!(require_revision(&form, &t));
    let explanation = form_str(&form, "explanation")
        .unwrap_or_default()
        .trim()
        .to_string();
    let reason = form_str(&form, "evidence_unavailable_reason")
        .unwrap_or_default()
        .trim()
        .to_string();
    if explanation.is_empty() || explanation.len() > 16000 || reason.len() > 2000 {
        return Ok(fail(400,"Supply an explanation of up to 16,000 characters and a document note of up to 2,000 characters."));
    }
    let responsible = form_str(&form, "responsible_member_id").and_then(|s| s.parse::<i64>().ok());
    if active_mem(&g.mems, responsible).is_none() {
        return Ok(fail(
            400,
            "Choose an active responsible member of this organization.",
        ));
    }
    let Some(magnitude) = t.amount_minor.checked_abs().filter(|n| *n > 0) else {
        return Ok(fail(400, "The bank amount cannot be allocated."));
    };
    let parsed = match parse_splits(
        &form_strings(&form, "split_label[]"),
        &form_strings(&form, "split_amount[]"),
        &form_strings(&form, "split_member[]"),
        magnitude,
    ) {
        Ok(rows) => rows,
        Err(message) => return Ok(fail(400, &message)),
    };
    let now = db::now_ms();
    let splits: Vec<SplitRow> = parsed
        .iter()
        .enumerate()
        .map(|(i, s)| SplitRow {
            id: -(i as i64 + 1),
            transaction_id: id,
            label: s.label.clone(),
            amount_minor: s.amount_minor,
            responsible_membership_id: s.responsible,
            created_at: now,
        })
        .collect();
    let mut next = t.clone();
    next.explanation = explanation;
    next.evidence_unavailable_reason = reason;
    next.responsible_membership_id = responsible;
    if let Err(message) = validate_responsibles_active(&next, &splits, &g.mems) {
        return Ok(fail(400, &message));
    }
    if snapshot(&t, &old_splits) == snapshot(&next, &splits) {
        return Ok(destination(&g, id, "Details unchanged"));
    }
    let token = random_token()?;
    let mut statements=vec![g.app.db.prepare(
        "UPDATE transactions SET explanation=?1,evidence_unavailable_reason=?2,responsible_membership_id=?3,status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note='',updated_at=?4,revision=revision+1,mutation_token=?5 WHERE id=?6 AND org_id=?7 AND revision=?8"
    ).bind(&[db::s(&next.explanation),db::s(&next.evidence_unavailable_reason),db::opt_i(responsible),
        db::i(now),db::s(&token),db::i(id),db::i(g.org.id),db::i(t.revision)])?];
    statements.push(g.app.db.prepare(
        "DELETE FROM transaction_splits WHERE transaction_id=?1 AND EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?2)"
    ).bind(&[db::i(id),db::s(&token)])?);
    for split in &splits {
        statements.push(g.app.db.prepare(
            "INSERT INTO transaction_splits(transaction_id,label,amount_minor,responsible_membership_id,created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?6)"
        ).bind(&[db::i(id),db::s(&split.label),db::i(split.amount_minor),
            db::opt_i(split.responsible_membership_id),db::i(now),db::s(&token)])?);
    }
    let mut all_responsibles = std::collections::BTreeSet::new();
    all_responsibles.extend(t.responsible_membership_id);
    all_responsibles.extend(next.responsible_membership_id);
    for split in old_splits.iter().chain(splits.iter()) {
        all_responsibles.extend(split.responsible_membership_id);
    }
    for member in all_responsibles {
        statements.push(g.app.db.prepare(
            "INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?4)"
        ).bind(&[db::i(id),db::i(member),db::i(now),db::s(&token)])?);
    }
    statements.push(audit_statement(
        &g,
        &t,
        "details_updated",
        "pending",
        serde_json::json!({"before":snapshot(&t,&old_splits),"after":snapshot(&next,&splits)}),
        &token,
    )?);
    if !commit_mutation(&g,id,&token,statements).await? {
        return Ok(fail(409,"This transaction changed while you were editing it. Reload and review the latest details."));
    }
    let _ = evidence;
    let recipients = |record: &TxnRow, parts: &[SplitRow]| {
        let mut ids = std::collections::BTreeSet::new();
        ids.extend(record.responsible_membership_id);
        for part in parts {
            ids.extend(part.responsible_membership_id);
        }
        ids
    };
    if recipients(&next, &splits) != recipients(&t, &old_splits) {
        notify::enqueue_assignment(&g, &next).await?;
    }
    Ok(destination(
        &g,
        id,
        "Details saved; approval requires current documentation",
    ))
}

pub async fn submit(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::DocumentTransactions
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let Some((t, splits, comments, evidence)) = load_full(&g.app.db, &g.org, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    try_resp!(require_revision(&form, &t));
    if let Err(message) = validate_responsibles_active(&t, &splits, &g.mems) {
        return Ok(fail(400, &message));
    }
    let history = responsible_history_ids(&g.app.db, id).await?;
    let mut dom = build_dom_from_rows(&g, &t, &splits, &comments, &evidence, &history);
    if dom.status == pockettrail_domain::DocumentationStatus::Submitted {
        return Ok(destination(&g, id, "Documentation is ready for review"));
    }
    if let Err(error) = submit_transaction(&g.dom_org, &mut dom, &g.uid()) {
        return Ok(fail(400, &error.to_string()));
    }
    let token = random_token()?;
    let update=g.app.db.prepare("UPDATE transactions SET status='pending',revision=revision+1,updated_at=?1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5")
        .bind(&[db::i(db::now_ms()),db::s(&token),db::i(id),db::i(g.org.id),db::i(t.revision)])?;
    let audit = audit_statement(
        &g,
        &t,
        "documentation_submitted",
        "pending",
        serde_json::json!({}),
        &token,
    )?;
    if !commit_mutation(&g,id,&token,vec![update,audit]).await? {
        return Ok(fail(
            409,
            "The transaction changed during submission. Reload and try again.",
        ));
    }
    Ok(destination(&g, id, "Documentation submitted"))
}

pub async fn approve(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    review(req, ctx, false).await
}

pub async fn request_changes(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    review(req, ctx, true).await
}

async fn review(
    mut req: Request,
    ctx: RouteContext<App>,
    changes: bool,
) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::ApproveTransactions
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let note = form_str(&form, "note")
        .unwrap_or_default()
        .trim()
        .to_string();
    if note.len() > 8000 || (changes && note.is_empty()) {
        return Ok(fail(400, "Supply a review note of up to 8,000 characters."));
    }
    let Some((t, splits, comments, evidence)) = load_full(&g.app.db, &g.org, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    try_resp!(require_revision(&form, &t));
    if !changes {
        if let Err(message) = validate_responsibles_active(&t, &splits, &g.mems) {
            return Ok(fail(400, &message));
        }
    }
    let history = responsible_history_ids(&g.app.db, id).await?;
    let mut dom = build_dom_from_rows(&g, &t, &splits, &comments, &evidence, &history);
    let decision = if changes {
        dom_request_changes(&g.dom_org, &mut dom, &g.uid())
    } else {
        approve_transaction(&g.dom_org, &mut dom, &g.uid())
    };
    if let Err(error) = decision {
        let status = if matches!(error, pockettrail_domain::DomainError::SelfApprovalDenied) {
            403
        } else {
            400
        };
        return Ok(fail(status, &error.to_string()));
    }
    let token = random_token()?;
    let status = if changes {
        "changes_requested"
    } else {
        "approved"
    };
    let now = db::now_ms();
    let update=g.app.db.prepare(
        "UPDATE transactions SET status=?1,approved_by_membership_id=?2,approved_at=?3,approval_note=?4,updated_at=?5,revision=revision+1,mutation_token=?6 WHERE id=?7 AND org_id=?8 AND revision=?9"
    ).bind(&[db::s(status),db::opt_i((!changes).then_some(g.me().id)),
        db::opt_i((!changes).then_some(now)),db::s(&note),db::i(now),db::s(&token),
        db::i(id),db::i(g.org.id),db::i(t.revision)])?;
    let audit = audit_statement(
        &g,
        &t,
        status,
        status,
        serde_json::json!({"note":note}),
        &token,
    )?;
    if !commit_mutation(&g,id,&token,vec![update,audit]).await? {
        return Ok(fail(
            409,
            "The transaction changed during review. Reload before deciding.",
        ));
    }
    if changes {
        let mut next = t.clone();
        next.status = status.into();
        notify::enqueue_assignment(&g, &next).await?;
    }
    Ok(destination(
        &g,
        id,
        if changes {
            "Changes requested"
        } else {
            "Transaction approved"
        },
    ))
}

pub async fn add_comment(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::CommentTransactions
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let Some(t) = txn_by_id(&g.app.db, g.org.id, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    let body = form_str(&form, "body")
        .unwrap_or_default()
        .trim()
        .to_string();
    if body.is_empty() || body.len() > 16000 {
        return Ok(fail(400, "Write a comment of up to 16,000 characters."));
    }
    db::exec(&g.app.db,
        "INSERT INTO comments(org_id,transaction_id,author_membership_id,body,created_at) VALUES(?1,?2,?3,?4,?5)",
        vec![db::i(g.org.id),db::i(id),db::i(g.me().id),db::s(&body),db::i(db::now_ms())]).await?;
    // Comments do not modify the transaction revision or approval.
    notify::enqueue_mentions(&g, &t, &body).await?;
    Ok(destination(&g, id, "Comment added"))
}

pub async fn suppress(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    set_suppression(req, ctx, true).await
}

pub async fn unsuppress(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    set_suppression(req, ctx, false).await
}

async fn set_suppression(
    mut req: Request,
    ctx: RouteContext<App>,
    suppress: bool,
) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::SuppressNotifications
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let Some(t) = txn_by_id(&g.app.db, g.org.id, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    let reason = form_str(&form, "reason")
        .unwrap_or_default()
        .trim()
        .to_string();
    try_resp!(require_revision(&form, &t));
    if suppress && (reason.is_empty() || reason.len() > 2000) {
        return Ok(fail(
            400,
            "Supply a suppression reason of up to 2,000 characters.",
        ));
    }
    let token = random_token()?;
    let now = db::now_ms();
    let update=g.app.db.prepare(
        "UPDATE transactions SET suppressed=?1,suppressed_by_membership_id=?2,suppressed_reason=?3,suppressed_at=?4,revision=revision+1,mutation_token=?5 WHERE id=?6 AND org_id=?7 AND revision=?8"
    ).bind(&[db::i(i64::from(suppress)),db::opt_i(suppress.then_some(g.me().id)),
        db::s(&reason),db::opt_i(suppress.then_some(now)),db::s(&token),
        db::i(id),db::i(g.org.id),db::i(t.revision)])?;
    let action = if suppress {
        "notifications_suppressed"
    } else {
        "notifications_resumed"
    };
    let audit = audit_statement(
        &g,
        &t,
        action,
        &t.status,
        serde_json::json!({"reason":reason}),
        &token,
    )?;
    let mut statements = vec![update, audit];
    if suppress {
        statements.push(g.app.db.prepare(
            "UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND cancelled_at IS NULL AND (transaction_id=?3 OR kind='digest') AND EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?4)"
        ).bind(&[db::i(now),db::i(g.org.id),db::i(id),db::s(&token)])?);
    }
    if !commit_mutation(&g,id,&token,statements).await? {
        return Ok(fail(
            409,
            "The transaction changed. Reload before changing notification settings.",
        ));
    }
    Ok(destination(
        &g,
        id,
        if suppress {
            "All transaction notifications suppressed"
        } else {
            "Future transaction notifications resumed"
        },
    ))
}

pub async fn upload_document(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(
            ctx.data.clone(),
            &req,
            &slug,
            Permission::DocumentTransactions
        )
        .await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    let Some(t) = txn_by_id(&g.app.db, g.org.id, id).await? else {
        return Ok(fail(404, "Transaction not found."));
    };
    let Some(file) = form_file(&form, "file") else {
        return Ok(fail(400, "Choose a supporting document."));
    };
    try_resp!(require_revision(&form, &t));
    if file.size() == 0 || file.size() > 10 * 1024 * 1024 {
        return Ok(fail(
            400,
            "Supporting documents must be between 1 byte and 10 MB.",
        ));
    }
    let bytes = file.bytes().await?;
    let content_type = if bytes.starts_with(b"%PDF-") {
        "application/pdf"
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else {
        return Ok(fail(400, "Upload a PDF, PNG, or JPEG document."));
    };
    let note = form_str(&form, "note").unwrap_or_default();
    if note.len() > 2000 {
        return Ok(fail(400, "Document note must be at most 2,000 characters."));
    }
    let Some(bucket) = &g.app.r2 else {
        return Ok(fail(503, "Private document storage is not configured."));
    };
    let token = random_token()?;
    let key = format!("org/{}/transactions/{id}/{token}", g.org.id);
    bucket.put(&key, bytes.clone()).execute().await?;
    let now = db::now_ms();
    let update=g.app.db.prepare(
        "UPDATE transactions SET status='pending',approved_at=NULL,approved_by_membership_id=NULL,approval_note='',updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5"
    ).bind(&[db::i(now),db::s(&token),db::i(id),db::i(g.org.id),db::i(t.revision)])?;
    let insert=g.app.db.prepare(
        "INSERT INTO documents(org_id,transaction_id,kind,r2_key,filename,content_type,size_bytes,note,uploaded_by_membership_id,created_at) SELECT ?1,?2,'evidence',?3,?4,?5,?6,?7,?8,?9 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?2 AND mutation_token=?10)"
    ).bind(&[db::i(g.org.id),db::i(id),db::s(&key),db::s(&file.name()),db::s(content_type),
        db::i(bytes.len() as i64),db::s(&note),db::i(g.me().id),db::i(now),db::s(&token)])?;
    let audit = audit_statement(
        &g,
        &t,
        "evidence_attached",
        "pending",
        serde_json::json!({"filename":file.name(),"note":note}),
        &token,
    )?;
    if !commit_mutation(&g,id,&token,vec![update,insert,audit]).await? {
        // Retain the unattached private object for recovery rather than delete evidence.
        return Ok(fail(
            409,
            "The transaction changed during upload. Reload and attach the document again.",
        ));
    }
    Ok(destination(
        &g,
        id,
        "Evidence retained; transaction requires review",
    ))
}

pub async fn download_document(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ViewTransactions).await
    );
    let Some(document) = doc_by_id(&g.app.db, g.org.id, id).await? else {
        return Ok(fail(404, "Document not found."));
    };
    let Some(bucket) = &g.app.r2 else {
        return Ok(fail(503, "Private document storage unavailable."));
    };
    let Some(object) = bucket.get(&document.r2_key).execute().await? else {
        return Ok(fail(
            404,
            "Document content is unavailable; its historical record is retained.",
        ));
    };
    let Some(body) = object.body() else {
        return Ok(fail(404, "Document content unavailable."));
    };
    let bytes = body.bytes().await?;
    let filename: String = document
        .filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .take(160)
        .collect();
    let headers = Headers::new();
    headers.set("Content-Type", "application/octet-stream")?;
    headers.set(
        "Content-Disposition",
        &format!(
            "attachment; filename=\"{}\"",
            if filename.is_empty() {
                "document"
            } else {
                &filename
            }
        ),
    )?;
    headers.set("Cache-Control", "private, no-store")?;
    headers.set("X-Content-Type-Options", "nosniff")?;
    Ok(Response::builder().with_headers(headers).fixed(bytes))
}
