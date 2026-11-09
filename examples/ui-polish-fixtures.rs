//! Render-only fixtures for scripts/ui-polish-smoke.cjs. No database or server.
use pockettrail_worker::render::render;
use serde_json::json;

fn main() {
    let context = json!({
        "user": {"name":"Synthetic organizer","email":"organizer@example.test"},
        "org": {"slug":"demo","name":"Synthetic organization","notifications_enabled":false},
        "csrf_token":"test-only", "local_mode":true, "is_synthetic":true,
        "can": {"roles":true,"members":true,"update_stock":true,"notifications":true},
        "roles":[{"id":1,"name":"Organizer","permissions":["view_transactions"]}],
        "permissions":[{"id":"view_transactions","label":"View transactions"}],
        "members":[{"id":1,"name":"Synthetic organizer","email":"organizer@example.test",
            "handle":"organizer","role_id":1,"active":true}],
        "notifications":{"enabled":false}, "mappings":[], "outbox":[], "pockets":[],
        "can_import":true, "filters":{"status":"all"},
        "txns":[{"id":1,"date":"2026-01-01","time":"12:00","counterparty":"DEMO Supplier",
            "counterparty_display":{"name":"DEMO Supplier","bank_account":"Synthetic account"},
            "pocket_name":"Community pocket","transaction_type":"Transfer",
            "amount_minor":-1500000000_i64,"balance_minor":2500000000_i64,
            "status":"pending","responsible_name":"Synthetic organizer",
            "needs_details":true,"suppressed":true}],
        "items":[{"id":1,"name":"DEMO T-shirt","variant":"L","total_qty":120,
            "levels":[{"location_name":"DEMO Storage room","qty":100},
                {"location_name":"Organizer holding stock","qty":20}]},
            {"id":2,"name":"Community tumbler","variant":null,"total_qty":0,"levels":[]}],
        "locations":[],
        "batches":[{"id":1,"created_at":"2026-01-01 12:00","by_name":"Synthetic organizer",
            "counts":{"imported":1,"duplicate_unchanged":2,"conflict":0,"needs_review":0}}]
    });
    let mut pages = serde_json::Map::new();
    for name in ["settings", "import", "inventory", "transactions"] {
        pages.insert(name.into(), json!(render(name, &context).unwrap()));
    }
    let mut settings = context.clone();
    settings["can"]["mappings"] = json!(true);
    settings["roles"] = json!([
        {"id":1,"name":"Organizer","permissions":["view_transactions"]},
        {"id":2,"name":"Unconfigured role","permissions":[]}
    ]);
    settings["members"] = json!([
        {"id":1,"name":"Synthetic organizer","email":"organizer@example.test",
            "handle":"organizer","role_id":1,"active":true},
        {"id":2,"name":"Former organizer","email":"former@example.test",
            "handle":"former","role_id":null,"active":false}
    ]);
    settings["pockets"] = json!([
        {"id":1,"name":"Community pocket","opening_balance_minor":2500000000_i64}
    ]);
    settings["mappings"] = json!([
        {"id":1,"pattern":"Main Pocket","member_name":"Synthetic organizer","member_id":1}
    ]);
    settings["notifications"] = json!({"enabled":false,"cutoff_date":"2026-01-01"});
    settings["notification_preview_cutoff"] = json!("2026-01-01");
    settings["preview_token"] = json!("synthetic-cutoff-token");
    settings["notification_preview"] = json!({
        "recipients":[{"name":"Synthetic organizer","pending":3}],"limited":false
    });
    settings["outbox"] = json!([{"to_name":"Synthetic organizer","kind":"digest",
        "subject":"Synthetic reminder","created_at":"2026-01-02 12:00"}]);
    pages.insert(
        "settings-populated".into(),
        json!(render("settings", &settings).unwrap()),
    );
    let mut readonly_settings = settings.clone();
    readonly_settings["can"] = json!({});
    // The server withholds recipient previews and outbox from read-only roles.
    readonly_settings["notification_preview"] = json!(null);
    readonly_settings["outbox"] = json!([]);
    pages.insert(
        "settings-readonly".into(),
        json!(render("settings", &readonly_settings).unwrap()),
    );
    settings["notification_preview_cutoff"] = json!("2026-02-02");
    settings["preview_token"] = json!("synthetic-new-cutoff-token");
    settings["notification_preview"] = json!({"recipients":[],"limited":true});
    pages.insert(
        "settings-preview".into(),
        json!(render("settings", &settings).unwrap()),
    );
    let raw = "Synthetic name / Other name / Jago 000123456789";
    let mut preview = context.clone();
    preview["batch"] = json!({"id":1,"status":"ready","counts":{"imported":1}});
    preview["items"] = json!([{
        "counterparty":raw,
        "counterparty_display":pockettrail_jago_parser::counterparty_display(raw),
        "bank_id":"SYNTHETIC-REF_2026-01-01_COMPLETE","date":"2026-01-01",
        "amount_minor":-1500000000_i64,"status":"imported"
    }]);
    pages.insert(
        "import-preview".into(),
        json!(render("import_preview", &preview).unwrap()),
    );
    let mut detail = context.clone();
    detail["txn"] = context["txns"][0].clone();
    for (key, value) in json!({
        "revision":1, "bank_id":"SYNTHETIC-REF_2026-01-01_COMPLETE",
        "notes":"Synthetic bank note, retained in full.",
        "explanation":"Synthetic venue and catering for the community meetup.",
        "amount_magnitude_minor":1500000000_i64, "responsible_member_id":1,
        "suppressed_reason":"Synthetic historical fixture"
    })
    .as_object()
    .unwrap()
    {
        detail["txn"][key] = value.clone();
    }
    detail["splits"] = json!([{"label":"Synthetic catering", "amount_minor":1500000000_i64,
        "amount_rupiah":15000000, "responsible_member_id":1,"responsible_name":"Synthetic organizer"}]);
    detail["evidence"] = json!([{"filename":"synthetic-invoice.pdf","url":"/synthetic-document",
        "size_display":"12 KB","note":"Synthetic catering invoice; original retained."}]);
    detail["comments"] = json!([{"author_name":"Synthetic organizer","created_at":"2026-01-02 12:00",
        "body":"Synthetic discussion. Does not change financial details."}]);
    detail["can"] = json!({"edit":true,"upload":true,"comment":true,"suppress":true,
        "approve":true,"request_changes":true});
    detail["approval"] =
        json!({"eligible":false,"ineligible_reason":"You are responsible for this transaction."});
    detail["review_decision"] = json!({"status":"changes_requested","author_name":"Synthetic reviewer",
        "created_at":"2026-01-02 13:00","note":"Synthetic review note: confirm the allocation."});
    pages.insert(
        "transaction".into(),
        json!(render("transaction", &detail).unwrap()),
    );
    detail["can"] = json!({});
    pages.insert(
        "transaction-readonly".into(),
        json!(render("transaction", &detail).unwrap()),
    );
    detail["can"] = json!({"edit":true,"upload":true});
    detail["evidence"] = json!([]);
    pages.insert(
        "transaction-empty".into(),
        json!(render("transaction", &detail).unwrap()),
    );
    println!("{}", serde_json::Value::Object(pages));
}
