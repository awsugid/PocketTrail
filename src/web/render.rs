//! minijinja environment: templates embedded at compile time (build.rs),
//! autoescape on for every template, shared filters.

use minijinja::{Environment, Value};
use std::sync::OnceLock;

include!(concat!(env!("OUT_DIR"), "/templates.rs"));

static ENV: OnceLock<Environment<'static>> = OnceLock::new();

fn env() -> &'static Environment<'static> {
    ENV.get_or_init(|| {
        let mut e = Environment::new();
        // Autoescape every template regardless of suffix (UI contract).
        e.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
        for (name, src) in TEMPLATES {
            e.add_template(name, src).expect("embedded template parse");
        }
        e.add_filter("money", money_filter);
        e.add_filter("ts", ts_filter);
        e
    })
}

fn money_filter(v: Value) -> String {
    crate::fmt::fmt_money(v.as_i64().unwrap_or(0))
}

fn ts_filter(v: Value) -> String {
    crate::fmt::fmt_ts(v.as_i64().unwrap_or(0))
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Render a template with a serde-serializable context.
pub fn render(name: &str, ctx: impl serde::Serialize) -> Result<String, String> {
    let tpl = env().get_template(name).map_err(|e| e.to_string())?;
    tpl.render(minijinja::value::Serde(ctx))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context() -> serde_json::Value {
        json!({
            "user": {"name":"Synthetic organizer","email":"organizer@example.test"},
            "org": {"slug":"demo","name":"Synthetic organization","notifications_enabled":false},
            "organizations": [], "orgs": [], "csrf_token":"test-only", "local_mode":true,
            "is_synthetic":true, "dev_login_enabled":true, "users":[],
            "google_configured":true, "google_client_id":"synthetic-client",
            "can_create":true, "active_nav":"transactions", "flash":null, "error":null,
            "txns":[], "filters":{"status":"all"}, "pockets":[], "members":[],
            "txn":{"id":1,"counterparty":"<script>unsafe()</script>",
                "date":"2026-01-01","time":"12:00","amount_minor":-10000,
                "balance_minor":100000,"status":"pending","explanation":"",
                "bank_id":"SYNTHETIC-1","notes":"","suppressed":false,"needs_details":true},
            "can":{"edit":true,"approve":true,"request_changes":true,"comment":true,
                "suppress":true,"upload":true,"roles":true,"members":true,
                "mappings":true,"notifications":true,"update_stock":true},
            "approval":{"eligible":false,"ineligible_reason":"Awaiting details"},
            "splits":[],"evidence":[],"comments":[],"totals":null,
            "batches":[],"batch":{"id":1,"counts":{"imported":0,"duplicate_unchanged":0,
                "conflict":0,"needs_review":0}},"items":[],
            "locations":[],"item":{"name":"Synthetic shirt","variant":"L"},"movements":[],
            "mappings":[],"roles":[],"permissions":[],"notifications":{"enabled":false},
            "outbox":[],"candidates":[]
        })
    }

    #[test]
    fn every_real_template_renders_with_native_minijinja() {
        for name in [
            "login",
            "orgs",
            "transactions",
            "transaction",
            "transaction_new",
            "import",
            "import_batch",
            "inventory",
            "inventory_item",
            "settings",
        ] {
            let body = render(name, context()).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(body.contains("<html"), "{name} is a complete page");
        }
    }

    #[test]
    fn discussion_navigation_preserves_permissions_and_comment_order() {
        for count in [0, 1, 3, 4, 7] {
            for can_comment in [false, true] {
                let mut ctx = context();
                ctx["can"]["comment"] = json!(can_comment);
                ctx["comments"] = json!((0..count)
                    .map(
                        |i| json!({"author_name":"Organizer", "created_at":"2026-01-01",
                        "body":format!("Comment {i} <unsafe>")})
                    )
                    .collect::<Vec<_>>());
                let body = render("transaction", ctx).unwrap();
                assert_eq!(
                    body.contains("data-dialog-open=\"add-comment\""),
                    can_comment
                );
                assert_eq!(body.contains("id=\"comment-body\""), can_comment);
                let discussion = body.split("id=\"discussion\"").nth(1).unwrap();
                assert!(!discussion.contains("Older comments ("));
                assert_eq!(discussion.contains("No comments yet."), count == 0);
                let mut previous = 0;
                for i in 0..count {
                    let text = format!("Comment {i} &lt;unsafe&gt;");
                    assert_eq!(discussion.matches(&text).count(), 1);
                    let position = discussion.find(&text).unwrap();
                    assert!(position > previous);
                    previous = position;
                }
            }
        }
    }

    #[test]
    fn transaction_panels_are_accessible_without_javascript() {
        let body = render("transaction", context()).unwrap();
        let overview = body
            .split("<nav class=\"transaction-actions\"")
            .next()
            .unwrap();
        assert!(overview.contains("Responsible: Unassigned"));
        assert!(overview.contains("Pending review"));
        assert!(!overview.contains("Complete transaction details"));
        for (id, label) in [
            ("bank-facts", "Bank details"),
            ("purposes", "Explanation &amp; purposes"),
            ("documents", "Documents"),
            ("review", "Review &amp; approval"),
            ("discussion", "Discussion"),
        ] {
            assert!(!body.contains(&format!("data-dialog-open=\"{id}\"")));
            let section =
                format!("<section class=\"panel\" id=\"{id}\" aria-labelledby=\"{id}-title\">");
            assert!(body.contains(&section));
            let panel = body
                .split(&section)
                .nth(1)
                .unwrap()
                .split("</section>")
                .next()
                .unwrap();
            assert!(panel.contains(&format!("id=\"{id}-title\">{label}</h2>")));
            assert!(!section.contains("hidden"));
        }
        let actions = body
            .split("<nav class=\"transaction-actions\"")
            .nth(1)
            .unwrap()
            .split("</nav>")
            .next()
            .unwrap();
        for id in [
            "edit-details",
            "upload-document",
            "review-actions",
            "add-comment",
            "history",
        ] {
            assert!(actions.contains(&format!("data-dialog-open=\"{id}\"")));
            assert!(body.contains(&format!("id=\"{id}\" data-dialog-panel")));
        }
        assert!(body.contains("No history yet."));
        assert!(!body.contains("<dialog"));
    }

    #[test]
    fn transaction_dialogs_preserve_forms_permissions_and_review_context() {
        for can_edit in [false, true] {
            for eligible in [false, true] {
                for can_approve in [false, true] {
                    let mut ctx = context();
                    ctx["can"]["edit"] = json!(can_edit);
                    ctx["can"]["approve"] = json!(can_approve);
                    ctx["approval"] =
                        json!({"eligible":eligible, "ineligible_reason":"Responsible member"});
                    ctx["txn"]["revision"] = json!(7);
                    ctx["txn"]["evidence_unavailable_reason"] = json!("No receipt <issued>");
                    ctx["evidence"] = json!([{"filename":"receipt.pdf", "url":"/private/receipt", "note":"Evidence"}]);
                    let body = render("transaction", ctx).unwrap();
                    assert_eq!(body.contains("/1/details\""), can_edit);
                    assert_eq!(body.contains("/1/approve\""), can_approve && eligible);
                    let review = body
                        .split("id=\"review\"")
                        .nth(1)
                        .unwrap()
                        .split("</section>")
                        .next()
                        .unwrap();
                    assert!(review.contains("href=\"#purposes\""));
                    assert!(review.contains("href=\"#documents\""));
                    assert!(review.contains("A member responsible for any part cannot approve it"));
                    let evidence_url = env()
                        .render_str("{{ url }}", minijinja::context!(url => "/private/receipt"))
                        .unwrap();
                    assert!(body.contains(&format!("href=\"{evidence_url}\">receipt.pdf</a>")));
                    assert!(body.contains("<dd>No receipt &lt;issued&gt;</dd>"));
                    let panels = body.split("id=\"bank-facts\"").nth(1).unwrap();
                    for form in panels.split("<form ").skip(1) {
                        let form = form.split("</form>").next().unwrap();
                        assert!(form.contains("name=\"csrf_token\" value=\"test-only\""));
                        if !form.contains("/comments\"") {
                            assert!(form.contains("name=\"revision\" value=\"7\""));
                        }
                    }
                    assert!(body.contains(
                        "enctype=\"multipart/form-data\" hx-encoding=\"multipart/form-data\""
                    ));
                    assert!(body.contains("id=\"evidence-file\" name=\"file\" required"));
                    assert!(
                        body.contains("id=\"changes-note\" name=\"note\" required") == can_approve
                    );
                }
            }
        }
    }

    #[test]
    fn suppression_and_history_remain_inside_relevant_panels() {
        for suppressed in [false, true] {
            for can_suppress in [false, true] {
                let mut ctx = context();
                ctx["txn"]["suppressed"] = json!(suppressed);
                ctx["txn"]["suppressed_reason"] = json!("Historical <reason>");
                ctx["can"]["suppress"] = json!(can_suppress);
                ctx["audit"] = json!([{"action":"details_saved","author_name":"Organizer",
                    "created_at":"2026-01-01","previous_status":"approved","new_status":"pending",
                    "details":"Previous <explanation>"}]);
                let body = render("transaction", ctx).unwrap();
                let review = body
                    .split("id=\"review-actions\"")
                    .nth(1)
                    .unwrap()
                    .split("</section>")
                    .next()
                    .unwrap();
                assert_eq!(
                    review.contains("/1/unsuppress\""),
                    suppressed && can_suppress
                );
                assert_eq!(
                    review.contains("/1/suppress\""),
                    !suppressed && can_suppress
                );
                if suppressed {
                    assert!(review.contains("Historical &lt;reason&gt;"));
                    assert!(review.contains("Suppression is not approval"));
                }
                let history = body.split("id=\"history\"").nth(1).unwrap();
                assert!(history.contains("Previous &lt;explanation&gt;"));
                assert!(!history.contains("No history yet."));
            }
        }
    }

    #[test]
    fn import_identity_uses_display_projection_without_changing_bank_data() {
        for raw in [
            "Name / Other Name / Jago 000123456789",
            "Name / Other Name",
            r"Name \ Other Name",
            "Name / Jago Savings",
        ] {
            let mut ctx = context();
            let display = pockettrail_jago_parser::counterparty_display(raw);
            ctx["items"] = json!([{"counterparty":raw,"counterparty_display":display,
                "bank_id":"SYNTHETIC-REF_0001_COMPLETE","status":"imported","amount_minor":100}]);
            for template in ["import_preview", "import_batch"] {
                let body = render(template, &ctx).unwrap();
                let escaped = env()
                    .render_str("{{ name }}", minijinja::context!(name => display.name))
                    .unwrap();
                assert!(body.contains(&format!("<strong>{escaped}</strong>")));
                assert!(body.contains("SYNTHETIC-REF_0001_COMPLETE"));
                if let Some(bank) = display.bank_account {
                    assert!(body.contains(&format!("<span class=\"cell__sub\">{bank}</span>")));
                }
                assert_eq!(ctx["items"][0]["counterparty"], raw);
            }
        }
    }

    #[test]
    fn review_note_is_visible_and_escaped_without_action_permission() {
        let mut ctx = context();
        ctx["can"] = json!({});
        ctx["review_decision"] = json!({"status":"changes_requested",
            "author_name":"Independent reviewer","created_at":"2026-01-01",
            "note":"Clarify purpose <unsafe>"});
        let body = render("transaction", ctx).unwrap();
        let review = body
            .split("id=\"review\"")
            .nth(1)
            .unwrap()
            .split("</section>")
            .next()
            .unwrap();
        assert!(review.contains("Independent reviewer"));
        assert!(review.contains("Clarify purpose &lt;unsafe&gt;"));
        assert!(!body.contains("data-dialog-open=\"review-actions\""));
        assert!(!body.contains("id=\"review-actions\" data-dialog-panel"));
    }

    #[test]
    fn bank_content_is_escaped_and_missing_templates_fail() {
        let body = render("transaction", context()).unwrap();
        assert!(!body.contains("<script>unsafe()"));
        assert!(body.contains("&lt;script&gt;"));
        assert!(render("does-not-exist", context()).is_err());
    }
}
