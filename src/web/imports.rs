//! Private statement staging. Confirmation never updates an existing bank movement.
use super::aggregate::*;
use super::db::{self, i, q_all, q_one, s};
use super::*;
use pockettrail_jago_parser::{parse_statement, ParsedTransaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const FILE_LIMIT: usize = 10 * 1024 * 1024;
const TEXT_LIMIT: usize = 3 * 1024 * 1024;
const ROW_LIMIT: usize = 2000;

#[derive(Serialize, Deserialize)]
struct Payload {
    rows: Vec<ParsedTransaction>,
    warnings: Vec<String>,
    statement_text: String,
}

#[derive(Deserialize)]
struct Batch {
    id: i64,
    pocket_id: i64,
    filename: String,
    created_at: i64,
    by_name: String,
    status: String,
    payload: String,
    totals: String,
}

#[derive(Deserialize)]
struct Item {
    bank_id: Option<String>,
    transaction_id: Option<i64>,
    counterparty: String,
    amount_minor: Option<i64>,
    status: String,
    message: String,
}

fn token() -> worker::Result<String> {
    let mut bytes = [0; 24];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| worker::Error::RustError("Import identifier unavailable".into()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn invalid_payload(p: &Payload) -> bool {
    p.statement_text.is_empty()
        || p.statement_text.len() > TEXT_LIMIT
        || p.rows.is_empty()
        || p.rows.len() > ROW_LIMIT
        || p.rows.iter().any(|r| {
            r.amount_minor.unsigned_abs() > crate::fmt::MAX_SAFE_MINOR as u64
                || r.balance_minor.unsigned_abs() > crate::fmt::MAX_SAFE_MINOR as u64
                || !crate::fmt::valid_date(&r.date)
                || r.time
                    .as_deref()
                    .is_some_and(|t| !crate::fmt::valid_time(t))
        })
}

async fn batch_of(g: &Ctx, id: i64) -> worker::Result<Option<Batch>> {
    q_one(&g.app.db,
        "SELECT b.*,u.name AS by_name FROM import_batches b JOIN memberships m ON m.id=b.created_by_membership_id JOIN users u ON u.id=m.user_id WHERE b.org_id=?1 AND b.id=?2",
        vec![i(g.org.id), i(id)]).await
}

fn batch_json(b: &Batch) -> Value {
    json!({"id":b.id,"filename":b.filename,"created_at":crate::fmt::fmt_ts(b.created_at),
        "by_name":b.by_name,"status":b.status,
        "counts":serde_json::from_str::<Value>(&b.totals).unwrap_or(json!({}))})
}

async fn load_payload(g: &Ctx, b: &Batch) -> worker::Result<Payload> {
    let pointer: Value = serde_json::from_str(&b.payload)
        .map_err(|_| worker::Error::RustError("Invalid import staging metadata".into()))?;
    let key = pointer["r2_key"]
        .as_str()
        .filter(|k| k.starts_with(&format!("org/{}/imports/", g.org.id)))
        .ok_or_else(|| worker::Error::RustError("Invalid private import key".into()))?;
    let bucket = g
        .app
        .r2
        .as_ref()
        .ok_or_else(|| worker::Error::RustError("Private import storage unavailable".into()))?;
    let object = bucket
        .get(key)
        .execute()
        .await?
        .ok_or_else(|| worker::Error::RustError("Staged import unavailable".into()))?;
    let body = object
        .body()
        .ok_or_else(|| worker::Error::RustError("Staged import empty".into()))?;
    serde_json::from_slice(&body.bytes().await?)
        .map_err(|_| worker::Error::RustError("Invalid staged import".into()))
}

pub async fn list_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let batches: Vec<Batch> = q_all(&g.app.db,
        "SELECT b.*,u.name AS by_name FROM import_batches b JOIN memberships m ON m.id=b.created_by_membership_id JOIN users u ON u.id=m.user_id WHERE b.org_id=?1 ORDER BY b.id DESC LIMIT 100",
        vec![i(g.org.id)]).await?;
    let pockets = pockets_of(&g.app.db, g.org.id).await?;
    let mut view = g.base_json("imports", None, None).await;
    view["batches"] = json!(batches.iter().map(batch_json).collect::<Vec<_>>());
    view["pockets"] = json!(pockets
        .iter()
        .map(|p| json!({"id":p.id,"name":p.name}))
        .collect::<Vec<_>>());
    Ok(page(&g.app, "import.html", view))
}

// SQL classifies against the current ledger, inside the same batch as insertion.
// The complete opaque bank ID is always scoped to both organization and pocket.
const SAME: &str = "t.txn_date=json_extract(j.value,'$.date') AND t.txn_time IS json_extract(j.value,'$.time') AND t.counterparty=json_extract(j.value,'$.counterparty') AND t.transaction_type=json_extract(j.value,'$.transaction_type') AND t.bank_notes=json_extract(j.value,'$.notes') AND t.amount_minor=json_extract(j.value,'$.amount_minor') AND t.balance_minor IS json_extract(j.value,'$.balance_minor')";

/// Build bounded JSON parameters, keeping each D1 value below its 2 MB limit.
/// Duplicate IDs within the statement are all quarantined, not first-row-wins.
async fn row_chunks(g: &Ctx, pocket_id: i64, payload: &Payload) -> worker::Result<Vec<String>> {
    let mappings = mappings_of(&g.app.db, g.org.id).await?;
    let owner = pockets_of(&g.app.db, g.org.id)
        .await?
        .into_iter()
        .find(|p| p.id == pocket_id)
        .and_then(|p| p.owner_membership_id);
    let mut seen = BTreeSet::new();
    let mut repeated = BTreeSet::new();
    for row in &payload.rows {
        if !seen.insert(&row.bank_id) {
            repeated.insert(&row.bank_id);
        }
    }
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut size = 2;
    for row in &payload.rows {
        let responsible = if row.amount_minor < 0 {
            map_counterparty(&mappings, pocket_id, &row.counterparty)
                .and_then(|m| active_mem(&g.mems, Some(m.membership_id)))
                .or_else(|| active_mem(&g.mems, owner))
                .map(|m| m.id)
        } else {
            None
        };
        let mut value = serde_json::to_value(row)
            .map_err(|_| worker::Error::RustError("Import serialization failed".into()))?;
        value["responsible"] = json!(responsible);
        value["repeated"] = json!(repeated.contains(&row.bank_id));
        let encoded = value.to_string();
        if encoded.len() > 1_000_000 {
            return Err(worker::Error::RustError(
                "An import row exceeds the staging limit".into(),
            ));
        }
        if size + encoded.len() + 1 > 1_000_000 || current.len() == 50 {
            chunks.push(format!("[{}]", current.join(",")));
            current.clear();
            size = 2;
        }
        size += encoded.len() + 1;
        current.push(encoded);
    }
    if !current.is_empty() {
        chunks.push(format!("[{}]", current.join(",")));
    }
    Ok(chunks)
}

/// All statements after the CAS check its unguessable status token. A losing
/// confirmer cannot insert rows, change item results, or finalize another run.
fn stage_statements(
    g: &Ctx,
    batch_id: i64,
    pocket_id: i64,
    guard: &str,
    chunks: &[String],
    commit: bool,
) -> worker::Result<Vec<D1PreparedStatement>> {
    let mut statements = Vec::new();
    let now = db::now_ms();
    statements.push(g.app.db.prepare(
        "DELETE FROM import_items WHERE batch_id=?1 AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)"
    ).bind(&[i(batch_id), i(g.org.id), s(guard)])?);
    for chunk in chunks {
        // Every statement has the same first five parameters.
        let mut params = vec![i(batch_id), i(g.org.id), s(guard), i(pocket_id), s(chunk)];
        if commit {
            params.push(i(now));
            statements.push(g.app.db.prepare(
                "INSERT OR IGNORE INTO transactions(org_id,pocket_id,bank_id,txn_date,txn_time,counterparty,transaction_type,bank_notes,amount_minor,balance_minor,responsible_membership_id,import_batch_id,created_at,updated_at,mutation_token)
                 SELECT ?2,?4,json_extract(j.value,'$.bank_id'),json_extract(j.value,'$.date'),json_extract(j.value,'$.time'),json_extract(j.value,'$.counterparty'),json_extract(j.value,'$.transaction_type'),json_extract(j.value,'$.notes'),json_extract(j.value,'$.amount_minor'),json_extract(j.value,'$.balance_minor'),
                 CASE WHEN json_extract(j.value,'$.amount_minor')<0 THEN COALESCE((SELECT id FROM memberships WHERE id=json_extract(j.value,'$.responsible') AND org_id=?2 AND removed_at IS NULL),(SELECT owner_membership_id FROM pockets WHERE id=?4 AND org_id=?2)) ELSE NULL END,?1,?6,?6,?3
                 FROM json_each(?5) j WHERE json_extract(j.value,'$.bank_id')<>'' AND json_extract(j.value,'$.repeated')=0
                 AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)"
            ).bind(&params)?);
        }
        let status = format!(
            "CASE WHEN json_extract(j.value,'$.bank_id')='' THEN 'needs_review'
             WHEN json_extract(j.value,'$.repeated')=1 THEN 'conflict'
             WHEN t.id IS NULL THEN 'imported'
             {} WHEN {SAME} THEN 'duplicate_unchanged' ELSE 'conflict' END",
            if commit {
                "WHEN t.import_batch_id=?1 AND t.mutation_token=?3 THEN 'imported'"
            } else {
                ""
            }
        );
        let sql = format!(
            "INSERT INTO import_items(batch_id,transaction_id,bank_id,status,counterparty,amount_minor,message)
             SELECT ?1,t.id,NULLIF(json_extract(j.value,'$.bank_id'),''),{status},json_extract(j.value,'$.counterparty'),json_extract(j.value,'$.amount_minor'),
             CASE WHEN json_extract(j.value,'$.bank_id')='' THEN 'Missing bank ID; not imported.'
             WHEN json_extract(j.value,'$.repeated')=1 THEN 'Repeated bank ID within statement; not imported.'
             WHEN t.id IS NOT NULL AND NOT ({SAME}) THEN 'Bank fields differ; existing transaction retained.'
             ELSE '' END
             FROM json_each(?5) j LEFT JOIN transactions t ON t.org_id=?2 AND t.pocket_id=?4 AND t.bank_id=json_extract(j.value,'$.bank_id')
             WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)"
        );
        statements.push(g.app.db.prepare(&sql).bind(&params[..5])?);
    }
    if commit {
        statements.push(g.app.db.prepare(
            "INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since)
             SELECT id,responsible_membership_id,?4 FROM transactions WHERE org_id=?2 AND import_batch_id=?1 AND mutation_token=?3 AND responsible_membership_id IS NOT NULL
             AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND status=?3)"
        ).bind(&[i(batch_id), i(g.org.id), s(guard), i(now)])?);
    }
    statements.push(g.app.db.prepare(
        "UPDATE import_batches SET totals=(SELECT json_object('imported',COALESCE(SUM(status='imported'),0),'duplicate_unchanged',COALESCE(SUM(status='duplicate_unchanged'),0),'conflict',COALESCE(SUM(status='conflict'),0),'needs_review',COALESCE(SUM(status='needs_review'),0)) FROM import_items WHERE batch_id=?1),status=?4 WHERE id=?1 AND org_id=?2 AND status=?3"
    ).bind(&[i(batch_id), i(g.org.id), s(guard), s(if commit { "committed" } else { "ready" })])?);
    Ok(statements)
}

pub async fn create(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let form = try_resp!(form_post(&g, &mut req).await);
    if form.get_all("file").unwrap_or_default().len() != 1 {
        return Ok(fail(400, "Choose exactly one original statement PDF."));
    }
    let Some(file) = form_file(&form, "file") else {
        return Ok(fail(400, "An original statement PDF is required."));
    };
    if file.size() == 0 || file.size() > FILE_LIMIT {
        return Ok(fail(400, "The original PDF must be 1 byte to 10 MiB."));
    }
    let text = form_str(&form, "statement_text").unwrap_or_default();
    if text.trim().is_empty() || text.len() > TEXT_LIMIT {
        return Ok(fail(
            400,
            "Extracted statement text is required and must not exceed 3 MiB.",
        ));
    }
    let pocket_id = form_str(&form, "pocket_id")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if !pockets_of(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|p| p.id == pocket_id)
    {
        return Ok(fail(400, "Choose a pocket in the current organization."));
    }
    let parsed = match parse_statement(&text) {
        Ok(p) => p,
        Err(_) => {
            return Ok(fail(
                400,
                "Statement text was not recognized. Re-extract the original PDF.",
            ))
        }
    };
    let payload = Payload {
        rows: parsed.transactions,
        warnings: parsed.warnings,
        statement_text: text,
    };
    if invalid_payload(&payload) {
        return Ok(fail(400, "Statement must contain between 1 and 2,000 rows with valid dates, times, and amounts. Re-extract the original PDF if rows look wrong."));
    }
    let bytes = file.bytes().await?;
    if bytes.len() > FILE_LIMIT || !bytes.starts_with(b"%PDF-") {
        return Ok(fail(
            400,
            "The original file must be a PDF no larger than 10 MiB.",
        ));
    }
    let Some(bucket) = &g.app.r2 else {
        return Ok(fail(503, "Private document storage is not configured."));
    };
    let nonce = token()?;
    let root = format!("org/{}/imports/{nonce}", g.org.id);
    let original_key = format!("{root}/original.pdf");
    let payload_key = format!("{root}/payload.json");
    let pointer = json!({"r2_key":payload_key}).to_string();
    let chunks = row_chunks(&g, pocket_id, &payload).await?;
    bucket.put(&original_key, bytes.clone()).execute().await?;
    bucket
        .put(
            &payload_key,
            serde_json::to_vec(&payload)
                .map_err(|_| worker::Error::RustError("Import serialization failed".into()))?,
        )
        .execute()
        .await?;
    #[derive(Deserialize)]
    struct Id {
        id: i64,
    }
    let now = db::now_ms();
    let batch: Id = q_one(&g.app.db,
        "INSERT INTO import_batches(org_id,pocket_id,filename,created_by_membership_id,created_at,status,payload) VALUES(?1,?2,?3,?4,?5,'staging',?6) RETURNING id",
        vec![i(g.org.id),i(pocket_id),s(&file.name()),i(g.me().id),i(now),s(&pointer)]).await?
        .ok_or_else(|| worker::Error::RustError("Import staging failed".into()))?;
    let mut statements = vec![g.app.db.prepare(
        "INSERT INTO documents(org_id,import_batch_id,kind,r2_key,filename,content_type,size_bytes,uploaded_by_membership_id,created_at) VALUES(?1,?2,'statement',?3,?4,'application/pdf',?5,?6,?7)"
    ).bind(&[i(g.org.id),i(batch.id),s(&original_key),s(&file.name()),i(bytes.len() as i64),i(g.me().id),i(now)])?];
    statements.extend(stage_statements(
        &g, batch.id, pocket_id, "staging", &chunks, false,
    )?);
    statements.push(audit::committed(
        &g.app.db,
        Some(g.org.id),
        &g.user.id,
        "import.staged",
        &format!("import_batch:{}", batch.id),
    )?);
    g.app.db.batch(statements).await?;
    Ok(redirect(&format!("/org/{slug}/imports/{}", batch.id)))
}

pub async fn batch_page(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let Some(batch) = batch_of(&g, id).await? else {
        return Ok(fail(404, "Import not found."));
    };
    let items: Vec<Item> = q_all(
        &g.app.db,
        "SELECT * FROM import_items WHERE batch_id=?1 ORDER BY id",
        vec![i(id)],
    )
    .await?;
    let mut view = g.base_json("imports", None, None).await;
    view["batch"] = batch_json(&batch);
    let preview = batch.status != "committed";
    let payload = if preview {
        Some(load_payload(&g, &batch).await?)
    } else {
        None
    };
    let owner = pockets_of(&g.app.db, g.org.id)
        .await?
        .into_iter()
        .find(|p| p.id == batch.pocket_id)
        .and_then(|p| p.owner_membership_id);
    let mappings = mappings_of(&g.app.db, g.org.id).await?;
    view["items"] = json!(items
        .iter()
        .enumerate()
        .map(|(index, it)| {
            let row = payload.as_ref().and_then(|p| p.rows.get(index));
            let member = if it.amount_minor.is_some_and(|v| v < 0) {
                map_counterparty(&mappings, batch.pocket_id, &it.counterparty)
                    .and_then(|m| active_mem(&g.mems, Some(m.membership_id)))
                    .or_else(|| active_mem(&g.mems, owner))
            } else {
                None
            };
            json!({"bank_id":it.bank_id,"transaction_id":it.transaction_id,
            "counterparty":it.counterparty,"amount_minor":it.amount_minor,
            "counterparty_display":pockettrail_jago_parser::counterparty_display(&it.counterparty),
            "status":it.status,"message":it.message,"date":row.map(|r|&r.date),
            "time":row.and_then(|r|r.time.as_deref()),"responsible_name":member.map(|m|&m.name)})
        })
        .collect::<Vec<_>>());
    if let Some(payload) = payload {
        let blocked = !payload.warnings.is_empty()
            || invalid_payload(&payload)
            || payload.rows.iter().any(|r| r.bank_id.trim().is_empty());
        view["warnings"] = json!(payload.warnings);
        view["blocking_warnings"] = json!(blocked);
        view["owner_required"] = json!(active_mem(&g.mems, owner).is_none());
        view["ready"] =
            json!(!blocked && batch.status == "ready" && active_mem(&g.mems, owner).is_some());
        view["can_confirm"] = json!(true);
    }
    Ok(page(
        &g.app,
        if preview {
            "import_preview.html"
        } else {
            "import_batch.html"
        },
        view,
    ))
}

/// Parent router: POST /org/:org/imports/:id/confirm.
pub async fn confirm(mut req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let slug = path_param(&ctx, "org");
    let id = path_param(&ctx, "id").parse().unwrap_or(0);
    let g = try_resp!(
        require_member(ctx.data.clone(), &req, &slug, Permission::ImportStatements).await
    );
    let _form = try_resp!(form_post(&g, &mut req).await);
    let Some(batch) = batch_of(&g, id).await? else {
        return Ok(fail(404, "Import not found."));
    };
    let destination = format!("/org/{slug}/imports/{id}");
    if batch.status == "committed" {
        return Ok(redirect(&destination));
    }
    if batch.status != "ready" {
        return Ok(fail(409, "Import staging is incomplete."));
    }
    if !pockets_of(&g.app.db, g.org.id)
        .await?
        .iter()
        .any(|p| p.id == batch.pocket_id && active_mem(&g.mems, p.owner_membership_id).is_some())
    {
        return Ok(fail(
            409,
            "Choose an active pocket owner before confirming this import.",
        ));
    }
    let payload = load_payload(&g, &batch).await?;
    // No unsafe-import policy is authorized: every extraction warning blocks
    // the entire batch, including balance-chain failures and omitted rows.
    if invalid_payload(&payload)
        || !payload.warnings.is_empty()
        || payload.rows.iter().any(|r| r.bank_id.trim().is_empty())
    {
        return Ok(fail(409, "Resolve extraction warnings and missing IDs by re-extracting and importing again. Nothing was committed."));
    }
    let guard = format!("confirming:{}", token()?);
    let chunks = row_chunks(&g, batch.pocket_id, &payload).await?;
    let cas = g.app.db.prepare(
        "UPDATE import_batches SET status=?3 WHERE id=?1 AND org_id=?2 AND status='ready' AND EXISTS(SELECT 1 FROM pockets p JOIN memberships m ON m.id=p.owner_membership_id AND m.org_id=p.org_id AND m.removed_at IS NULL WHERE p.id=import_batches.pocket_id AND p.org_id=?2)"
    ).bind(&[i(id),i(g.org.id),s(&guard)])?;
    let mut statements = vec![cas];
    // Guarded by the unguessable status token and pushed BEFORE the staged
    // statements finalize the batch status: after the CAS, status still
    // equals the guard iff this confirmer won. Same transaction, so the row
    // vanishes if any later statement aborts the batch.
    statements.push(g.app.db.prepare(
        "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,'import.committed',?3,'committed',?4 WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?5 AND org_id=?2 AND status=?6)",
    ).bind(&[
        db::s(&g.user.id),
        db::i(g.org.id),
        db::s(&format!("import_batch:{id}")),
        db::i(db::now_ms()),
        db::i(id),
        db::s(&guard),
    ])?);
    statements.extend(stage_statements(
        &g,
        id,
        batch.pocket_id,
        &guard,
        &chunks,
        true,
    )?);
    let results = g.app.db.batch(statements).await?;
    let won = results
        .first()
        .and_then(|r| r.meta().ok().flatten())
        .and_then(|m| m.changes)
        .unwrap_or(0)
        == 1;
    if won {
        let new_rows: Vec<TxnRow> = q_all(&g.app.db,
            "SELECT * FROM transactions WHERE org_id=?1 AND import_batch_id=?2 AND mutation_token=?3",
            vec![i(g.org.id),i(id),s(&guard)]).await?;
        for row in new_rows {
            super::notify::enqueue_assignment(&g, &row).await?;
        }
    }
    Ok(redirect(&destination))
}
