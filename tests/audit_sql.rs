//! SQLite-level checks for audit-trail SQL semantics against the real
//! migration schema. D1 executes batched statements sequentially inside one
//! transaction (Cloudflare D1 docs, D1Database::batch), so a plain SQLite
//! connection reproduces the `changes()` chains, the append-only triggers,
//! and the scope-isolation queries faithfully.

use rusqlite::{params, Connection};

const MIGRATIONS: [&str; 8] = [
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_import_review.sql"),
    include_str!("../migrations/0003_transaction_history.sql"),
    include_str!("../migrations/0004_outbox_cancellation.sql"),
    include_str!("../migrations/0005_notification_snapshots.sql"),
    include_str!("../migrations/0006_profile_picture.sql"),
    include_str!("../migrations/0007_invitations.sql"),
    include_str!("../migrations/0008_platform_audit.sql"),
];

/// Exact statement shapes from src/web/audit.rs.
const AUDIT_COMMITTED: &str =
    "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)";
const AUDIT_COMMITTED_IF_CHANGED: &str =
    "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,?3,?4,'committed',?5 WHERE changes()=1";

fn db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    for sql in MIGRATIONS {
        conn.execute_batch(sql).expect("migration applies");
    }
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

/// users -> org -> role -> membership -> pocket, returning their ids.
fn seed_org(conn: &Connection, slug: &str, user_id: &str) -> (i64, i64, i64) {
    conn.execute(
        "INSERT INTO users (id, email, name, created_at) VALUES (?1, ?2, 'Actor', 1)",
        params![user_id, format!("{user_id}@example.test")],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO organizations (slug, name, created_at) VALUES (?1, ?2, 1)",
        params![slug, format!("Org {slug}")],
    )
    .unwrap();
    let org: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO roles (org_id, name, permissions) VALUES (?1, 'Admin', '[]')",
        params![org],
    )
    .unwrap();
    let role: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO memberships (org_id, user_id, role_id, handle, created_at) VALUES (?1, ?2, ?3, ?4, 1)",
        params![org, user_id, role, format!("handle-{slug}")],
    )
    .unwrap();
    let member: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO pockets (org_id, name) VALUES (?1, 'Main Pocket')",
        params![org],
    )
    .unwrap();
    (org, role, member)
}

fn audit_row(conn: &Connection, actor: &str, org: Option<i64>, action: &str, target: &str) {
    conn.execute(
        AUDIT_COMMITTED,
        params![actor, org, action, target, 1_i64],
    )
    .unwrap();
}

#[test]
fn migrations_apply_and_audit_is_append_only() {
    let conn = db();
    let (org, _, _) = seed_org(&conn, "acme", "u:actor");
    audit_row(&conn, "u:actor", Some(org), "role.created", "role:Admin");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);
    // The append-only triggers must reject history edits.
    assert!(conn
        .execute(
            "UPDATE audit_events SET outcome='denied' WHERE action='role.created'",
            [],
        )
        .is_err());
    assert!(conn
        .execute("DELETE FROM audit_events WHERE action='role.created'", [])
        .is_err());
}

#[test]
fn gated_audit_skips_zero_row_update_and_delete() {
    let conn = db();
    let (org, role, member) = seed_org(&conn, "acme", "u:actor");
    conn.execute(
        "INSERT INTO actor_mappings (org_id, pattern, membership_id, created_by_membership_id, created_at) VALUES (?1, 'label', ?2, ?2, 1)",
        params![org, member],
    )
    .unwrap();
    let mapping: i64 = conn.query_row(
        "SELECT id FROM actor_mappings WHERE org_id=?1",
        params![org],
        |row| row.get(0),
    )
    .unwrap();

    // set_role shape: UPDATE matching zero rows records no committed event.
    conn.execute(
        "UPDATE memberships SET role_id=?1 WHERE id=?2 AND org_id=?3",
        params![role, -999_i64, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "member.role_changed", "membership:-999", 1_i64]).unwrap();
    // save_role shape: zero-row role update is likewise silent.
    conn.execute(
        "UPDATE roles SET name=?1,permissions=?2 WHERE id=?3 AND org_id=?4",
        params!["Renamed", "[]", -999_i64, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "role.updated", "role:-999", 1_i64]).unwrap();
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events"),
        0,
        "zero-row UPDATE must not record committed events"
    );

    // A real DELETE records exactly one event; repeating it is silent.
    conn.execute(
        "DELETE FROM actor_mappings WHERE id=?1 AND org_id=?2",
        params![mapping, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "mapping.deleted", &format!("mapping:{mapping}"), 1_i64]).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);
    conn.execute(
        "DELETE FROM actor_mappings WHERE id=?1 AND org_id=?2",
        params![mapping, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "mapping.deleted", &format!("mapping:{mapping}"), 1_i64]).unwrap();
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events"),
        1,
        "deleting an already-deleted mapping records nothing"
    );

    // The same statements matching real rows do record events.
    conn.execute(
        "UPDATE memberships SET role_id=?1 WHERE id=?2 AND org_id=?3",
        params![role, member, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "member.role_changed", &format!("membership:{member}"), 1_i64]).unwrap();
    conn.execute(
        "UPDATE roles SET name=?1,permissions=?2 WHERE id=?3 AND org_id=?4",
        params!["Renamed", "[]", role, org],
    )
    .unwrap();
    conn.execute(AUDIT_COMMITTED_IF_CHANGED, params!["u:actor", org, "role.updated", &format!("role:{role}"), 1_i64]).unwrap();
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events"),
        3,
        "1 real delete + 2 matched updates"
    );
}

#[test]
fn org_and_platform_lists_are_scope_isolated() {
    let conn = db();
    let (org1, _, _) = seed_org(&conn, "acme", "u:acme-admin");
    let (org2, _, _) = seed_org(&conn, "beta", "u:beta-admin");
    // Platform audit rows need a real actor row: actor_id references users(id).
    conn.execute(
        "INSERT INTO users (id, email, name, created_at) VALUES ('g:platform', 'platform@example.test', 'Platform Admin', 1)",
        [],
    )
    .unwrap();
    audit_row(&conn, "u:acme-admin", Some(org1), "role.created", "role:Admin");
    audit_row(&conn, "u:beta-admin", Some(org2), "pocket.created", "pocket:Ops");
    audit_row(&conn, "g:platform", None, "auth.login", "session");
    audit_row(&conn, "g:platform", None, "platform.admin", "user:g:target");

    // audit::list_org: own org only, newest first, paginated.
    let mut stmt = conn
        .prepare(
            "SELECT * FROM audit_events WHERE org_id=?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3",
        )
        .unwrap();
    let mut rows = stmt.query(params![org1, 50_i64, 0_i64]).unwrap();
    let mut seen = Vec::new();
    while let Some(row) = rows.next().unwrap() {
        seen.push((
            row.get::<_, Option<i64>>("org_id").unwrap(),
            row.get::<_, String>("action").unwrap(),
        ));
    }
    assert_eq!(
        seen,
        vec![(Some(org1), "role.created".to_string())]
    );

    // audit::list_platform: org_id IS NULL only, newest first, paginated.
    let mut stmt = conn
        .prepare(
            "SELECT * FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        )
        .unwrap();
    let mut rows = stmt.query(params![50_i64, 0_i64]).unwrap();
    let mut seen = Vec::new();
    while let Some(row) = rows.next().unwrap() {
        seen.push(row.get::<_, String>("action").unwrap());
    }
    assert_eq!(seen, vec!["platform.admin", "auth.login"]);

    // Pagination windows are disjoint.
    let page_one: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT action FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ?1 OFFSET ?2",
            )
            .unwrap();
        let mut rows = stmt.query(params![1_i64, 0_i64]).unwrap();
        let mut out = Vec::new();
        while let Some(row) = rows.next().unwrap() {
            out.push(row.get::<_, String>(0).unwrap());
        }
        out
    };
    assert_eq!(page_one, vec!["platform.admin"]);
    let page_two: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT action FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ?1 OFFSET ?2",
            )
            .unwrap();
        let mut rows = stmt.query(params![1_i64, 1_i64]).unwrap();
        let mut out = Vec::new();
        while let Some(row) = rows.next().unwrap() {
            out.push(row.get::<_, String>(0).unwrap());
        }
        out
    };
    assert_eq!(page_two, vec!["auth.login"]);
}

#[test]
fn stock_changes_chain_gates_movement_and_audit() {
    let conn = db();
    let (org, _, member) = seed_org(&conn, "acme", "u:stocker");
    conn.execute(
        "INSERT INTO inventory_items (org_id, name, variant) VALUES (?1, 'Desk', '')",
        params![org],
    )
    .unwrap();
    let item: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO inventory_locations (org_id, name) VALUES (?1, 'Warehouse')",
        params![org],
    )
    .unwrap();
    let location: i64 = conn.last_insert_rowid();

    // Exact update_stock batch shape: level, bounded update, movement gated on
    // the update's changes(), audit gated on the movement's changes().
    let apply = |conn: &Connection, delta: i64| {
        conn.execute(
            "INSERT OR IGNORE INTO inventory_levels (item_id, location_id, qty) VALUES (?1, ?2, 0)",
            params![item, location],
        )
        .unwrap();
        conn.execute(
            "UPDATE inventory_levels SET qty = qty + ?1 WHERE item_id = ?2 AND location_id = ?3 AND qty + ?1 >= 0 AND qty + ?1 <= 9000000000000000",
            params![delta, item, location],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO stock_movements (org_id, item_id, location_id, delta, from_qty, to_qty, reason, by_membership_id, created_at) SELECT ?1, ?2, ?3, ?4, qty - ?4, qty, ?5, ?6, ?7 FROM inventory_levels WHERE item_id = ?2 AND location_id = ?3 AND changes() = 1",
            params![org, item, location, delta, "cycle count", member, 1_i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO audit_events (actor_id, org_id, action, target, outcome, created_at) SELECT ?1, ?2, 'stock.changed', ?3, 'committed', ?4 FROM inventory_levels WHERE item_id = ?5 AND location_id = ?6 AND changes() = 1",
            params!["u:stocker", org, format!("item:{item} location:{location} delta:{delta}"), 1_i64, item, location],
        )
        .unwrap();
    };

    apply(&conn, 5);
    assert_eq!(
        count(&conn, "SELECT qty FROM inventory_levels"),
        5,
        "applied delta updates the level"
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM stock_movements"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);

    // A rejected delta records neither a movement nor an audit row.
    apply(&conn, -10);
    assert_eq!(count(&conn, "SELECT qty FROM inventory_levels"), 5);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM stock_movements"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);
}

#[test]
fn item_noop_readd_records_no_audit() {
    let conn = db();
    let (org, _, _) = seed_org(&conn, "acme", "u:stocker");
    let add = |conn: &Connection| {
        conn.execute(
            "INSERT OR IGNORE INTO inventory_items (org_id, name, variant) VALUES (?1, 'Desk', '')",
            params![org],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO audit_events (actor_id, org_id, action, target, outcome, created_at) SELECT ?1, ?2, 'item.added', ?3, 'committed', ?4 WHERE changes() = 1",
            params!["u:stocker", org, "item:Desk:", 1_i64],
        )
        .unwrap();
    };
    add(&conn);
    add(&conn);
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM inventory_items"),
        1,
        "unique constraint keeps one row"
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events"),
        1,
        "no-op re-add records no committed event"
    );
}

#[test]
fn audit_actor_fk_rejects_unknown_actor() {
    let conn = db();
    let (org, _, _) = seed_org(&conn, "acme", "u:real");
    // begin() filters "preauth:" challenge sessions because actor_id has a
    // foreign key; this documents why the filter exists.
    assert!(conn
        .execute(
            AUDIT_COMMITTED,
            params!["preauth:not-a-user", Some(org), "http.post", "/org/acme/settings", 1_i64],
        )
        .is_err());
    audit_row(&conn, "u:real", Some(org), "http.post", "/org/acme/settings");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);
}

#[test]
fn plain_committed_records_insert_events() {
    let conn = db();
    let (org, _, member) = seed_org(&conn, "acme", "u:actor");
    let _ = member;
    // add_member shape: INSERT followed by unconditional committed audit.
    conn.execute(
        "INSERT INTO users (id, email, name, created_at) VALUES ('u:newcomer', 'new@example.test', 'Newcomer', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memberships (org_id, user_id, role_id, handle, created_at) VALUES (?1, 'u:newcomer', (SELECT id FROM roles WHERE org_id=?1 AND name='Admin'), 'handle-new', 1)",
        params![org],
    )
    .unwrap();
    conn.execute(
        AUDIT_COMMITTED,
        params!["u:actor", org, "member.added", "membership:handle-new", 1_i64],
    )
    .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM audit_events"), 1);
    let _ = member;
}

#[test]
fn mapping_audit_target_stays_free_of_bank_labels() {
    let conn = db();
    let (org, _, member) = seed_org(&conn, "acme", "u:actor");
    // add_mapping shape (settings.rs): the bank actor label lands only in
    // actor_mappings; the audit row targets the mapped membership id.
    let pattern = "PT SUMBER REZEKI SURABAYA";
    conn.execute(
        "INSERT INTO actor_mappings(org_id,pattern,membership_id,created_by_membership_id,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![org, pattern, member, member, 1_i64],
    )
    .unwrap();
    conn.execute(
        AUDIT_COMMITTED,
        params!["u:actor", org, "mapping.created", format!("mapping:member-{member}"), 1_i64],
    )
    .unwrap();
    let leaked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action LIKE '%mapping%' AND (target LIKE '%' || ?1 || '%' OR outcome LIKE '%' || ?1 || '%')",
            params![pattern],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(leaked, 0, "bank actor label must never reach audit_events");
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM actor_mappings WHERE pattern = 'PT SUMBER REZEKI SURABAYA'"
        ),
        1,
        "the label itself is still stored where assignments need it"
    );
}

/// Exact confirm-batch statements (imports.rs): CAS flip ready -> guard, the
/// guarded audit row, a staged item insert, then the finalize that consumes
/// the guard. Regression for the ordering bug where the audit followed the
/// finalize and therefore never matched the guard again.
fn confirm_chain(conn: &Connection, org: i64, batch_id: i64, actor: &str, guard: &str) {
    // CAS: only a batch left in 'ready' adopts this confirmer's guard.
    conn.execute(
        "UPDATE import_batches SET status=?3 WHERE id=?1 AND org_id=?2 AND status='ready'",
        params![batch_id, org, guard],
    )
    .unwrap();
    // 1. The guarded audit row, immediately after the CAS.
    conn.execute(
        "INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,'import.committed',?3,'committed',?4 WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?5 AND org_id=?2 AND status=?6)",
        params![actor, org, format!("import_batch:{batch_id}"), 1_i64, batch_id, guard],
    )
    .unwrap();
    // 2. A staged item, gated on the guard like stage_statements does.
    conn.execute(
        "INSERT INTO import_items (batch_id, transaction_id, bank_id, status, counterparty, amount_minor, message) SELECT ?1, NULL, 'B-1', 'imported', 'Coffee Shop', 15000, '' WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)",
        params![batch_id, org, guard],
    )
    .unwrap();
    // 3. Finalize: consumes the guard (exact totals UPDATE from stage_statements).
    conn.execute(
        "UPDATE import_batches SET totals=(SELECT json_object('imported',COALESCE(SUM(status='imported'),0),'duplicate_unchanged',COALESCE(SUM(status='duplicate_unchanged'),0),'conflict',COALESCE(SUM(status='conflict'),0),'needs_review',COALESCE(SUM(status='needs_review'),0)) FROM import_items WHERE batch_id=?1),status=?4 WHERE id=?1 AND org_id=?2 AND status=?3",
        params![batch_id, org, guard, "committed"],
    )
    .unwrap();
}

fn seed_import_batch(conn: &Connection, org: i64, member: i64, pocket: i64) -> i64 {
    conn.execute(
        "INSERT INTO import_batches (org_id, pocket_id, filename, created_by_membership_id, created_at) VALUES (?1, ?2, 'statement.pdf', ?3, 1)",
        params![org, pocket, member],
    )
    .unwrap();
    let batch_id: i64 = conn.last_insert_rowid();
    conn.execute(
        "UPDATE import_batches SET status='ready' WHERE id=?1",
        params![batch_id],
    )
    .unwrap();
    batch_id
}

#[test]
fn import_confirm_records_audit_before_finalize() {
    let conn = db();
    let (org, _, member) = seed_org(&conn, "acme", "u:importer");
    conn.execute(
        "INSERT INTO pockets (org_id, name) VALUES (?1, 'Ops')",
        params![org],
    )
    .unwrap();
    let pocket: i64 = conn.last_insert_rowid();
    let batch_id = seed_import_batch(&conn, org, member, pocket);

    confirm_chain(&conn, org, batch_id, "u:importer", "confirming:won");
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events WHERE action='import.committed'"),
        1,
        "winning confirmer records the committed import"
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_items"), 1);
    let status: String = conn
        .query_row(
            "SELECT status FROM import_batches WHERE id=?1",
            params![batch_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "committed");

    // A losing confirmer runs the same chain against the batch the winner
    // already finalized: every gated statement matches zero rows.
    confirm_chain(&conn, org, batch_id, "u:importer", "confirming:lost");
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM audit_events WHERE action='import.committed'"),
        1,
        "losing confirmer records nothing"
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM import_items"), 1);
}
