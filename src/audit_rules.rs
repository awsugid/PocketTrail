//! Pure audit-trail decisions shared by the request layer and mutation
//! handlers. Kept free of worker types so native tests exercise them.

pub const PAGE_SIZE: i64 = 50;

/// What the request layer does with a request:
/// `("action", true)` writes an attempt row before the handler runs;
/// `("action", false)` only watches, recording explicit denials;
/// `None` is unscoped (login pages, hubs, static assets).
pub fn observe(path: &str, post: bool) -> Option<(&'static str, bool)> {
    if post {
        return Some(("http.post", true));
    }
    let seg: Vec<&str> = path.split('/').collect();
    // Private document download: GET /org/:slug/documents/:id
    if seg.get(1) == Some(&"org") && seg.get(3) == Some(&"documents") {
        return Some(("document.download", true));
    }
    // Private-scope page views are watched for explicit denials only,
    // never logged as page views.
    if (seg.get(1) == Some(&"org") && seg.len() > 2)
        || path == "/platform"
        || path.starts_with("/platform/")
    {
        return Some(("http.get", false));
    }
    None
}

/// Org slug for /org/:slug/... paths.
pub fn org_slug(path: &str) -> Option<&str> {
    let seg: Vec<&str> = path.split('/').collect();
    if seg.get(1) == Some(&"org") {
        seg.get(2).copied().filter(|s| !s.is_empty())
    } else {
        None
    }
}

/// The bounded set of non-org routes whose targets may persist verbatim.
fn known_shape(seg: &[&str]) -> bool {
    match seg {
        ["", "login", "dev" | "google"] => true,
        ["", "logout"] => true,
        ["", "orgs"] => true,
        ["", "platform"] => true,
        ["", "platform", "users", "admin"] => true,
        ["", "platform", "role-templates"] => true,
        ["", "invitations", "accept"] => true,
        _ => false,
    }
}

/// Resource ids are row identifiers: digits only, short enough for i64.
fn numeric(seg: Option<&str>) -> bool {
    seg.is_some_and(|s| !s.is_empty() && s.len() <= 18 && s.bytes().all(|b| b.is_ascii_digit()))
}

/// Invitation ids are opaque random hex (invitations.id is TEXT), so they
/// reduce to a placeholder instead of persisting like numeric ids do.
fn opaque_hex(seg: Option<&str>) -> bool {
    seg.is_some_and(|s| {
        !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

/// The bounded set of org route shapes after the slug segment. Every dynamic
/// resource id must be numeric; the slug itself is redacted by the caller.
fn known_org_shape(rest: &[&str]) -> bool {
    match rest {
        ["transactions"] => true,
        ["transactions", id] => numeric(Some(id)),
        ["transactions", id,
            "details" | "submit" | "approve" | "request-changes" | "comments"
            | "documents" | "suppress" | "unsuppress",
        ] => numeric(Some(id)),
        ["documents", id] => numeric(Some(id)),
        ["imports"] => true,
        ["imports", id] => numeric(Some(id)),
        ["imports", id, "confirm"] => numeric(Some(id)),
        ["inventory"] => true,
        ["inventory", "items" | "locations" | "stock"] => true,
        ["inventory", "items", id] => numeric(Some(id)),
        ["settings"] => true,
        ["settings",
            "mappings" | "pockets" | "members" | "roles" | "notifications"
            | "role-templates" | "invitations",
        ] => true,
        ["settings", "mappings", id, "delete"] => numeric(Some(id)),
        ["settings", "members", id, "role" | "remove" | "restore"] => numeric(Some(id)),
        ["settings", "roles", id] => numeric(Some(id)),
        ["settings", "invitations", id, "revoke" | "resend"] => opaque_hex(Some(id)),
        ["notifications", "digest"] => true,
        _ => false,
    }
}

/// Bounded target normalization: only known route shapes persist, resource
/// ids must be numeric, and the org slug is redacted to ":org" — the row's
/// org_id column already carries the scope, so arbitrary slugs, ids, or any
/// other dynamic content never enter the append-only audit log.
pub fn normalize_target(path: &str) -> String {
    // Invitation IDs are opaque; do not put them in the audit log.
    if path.starts_with("/invitations/") {
        return "/invitations/accept".into();
    }
    let seg: Vec<&str> = path.split('/').collect();
    if seg.first() == Some(&"")
        && seg.get(1) == Some(&"org")
        && seg.get(2).is_some_and(|s| !s.is_empty())
    {
        if known_org_shape(&seg[3..]) {
            let mut rest: Vec<String> = seg[3..].iter().map(|s| s.to_string()).collect();
            // Opaque invitation ids never persist; the shape alone identifies
            // the route and success_owned reads only the fixed segments.
            if rest.first() == Some(&"settings".to_string())
                && rest.get(1).map(|s| s.as_str()) == Some("invitations")
                && rest.len() >= 3
            {
                rest[2] = ":invitation".into();
            }
            return format!("/org/:org/{}", rest.join("/"));
        }
        return "/unrecognized".into();
    }
    if known_shape(&seg) {
        path.into()
    } else {
        "/unrecognized".into()
    }
}

/// Organizer-facing label for an audit action code. Codes are the stored
/// truth; this is presentation only, so unknown codes fall back to themselves.
pub fn action_label(action: &str) -> String {
    let label = match action {
        "auth.login" => "Signed in",
        "auth.logout" => "Signed out",
        "http.post" => "Form submitted",
        "http.get" => "Page viewed",
        "document.download" => "Document downloaded",
        "import.staged" => "Import previewed",
        "import.committed" => "Import confirmed",
        "invitation.created" => "Invitation created",
        "invitation.resent" => "Invitation email resent",
        "invitation.revoked" => "Invitation revoked",
        "invitation.accepted" => "Invitation accepted",
        "mapping.created" => "Actor mapping added",
        "mapping.deleted" => "Actor mapping deleted",
        "member.added" => "Member added",
        "member.removed" => "Member removed",
        "member.restored" => "Member restored",
        "member.role_changed" => "Member role changed",
        "notifications.settings_changed" => "Notification settings changed",
        "org.created" => "Organization created",
        "org.roles" => "Roles changed",
        "role.created" => "Role created",
        "role.updated" => "Role updated",
        "pocket.created" => "Pocket added",
        "item.added" => "Inventory item added",
        "location.added" => "Inventory location added",
        "stock.changed" => "Stock changed",
        "transaction.commented" => "Comment posted",
        "transaction.details_updated" => "Transaction details saved",
        "transaction.evidence_attached" => "Document attached",
        "transaction.submitted" => "Submitted for review",
        "platform.admin" => "Platform access changed",
        "platform.template" => "Role template saved",
        _ => return action.to_string(),
    };
    label.to_string()
}

/// Plain-English outcome for the audit table.
pub fn outcome_label(outcome: &str) -> &str {
    match outcome {
        "committed" => "Done",
        "denied" => "Denied",
        "failed" => "Failed",
        "attempted" => "Attempted",
        other => other,
    }
}

/// Outcome for a finished request, or `None` to record nothing.
///
/// Success on an instrumented mutation returns `None`: the transaction that
/// made the change writes the committed row itself. Everything else the
/// request layer records (denied, failed, or HTTP-level committed).
pub fn classify(
    target: &str,
    action: &str,
    intent: bool,
    actor_present: bool,
    status: u16,
) -> Option<&'static str> {
    if !intent {
        // Watched page views record explicit rejections only; anonymous
        // redirects are ordinary browsing, not security events.
        return if status == 401 || status == 403 {
            Some("denied")
        } else {
            None
        };
    }
    if status == 401 || status == 403 {
        return Some("denied");
    }
    if (300..400).contains(&status) {
        // Auth handlers own their redirect outcome whatever the session
        // state; judge only the paths that gate on login.
        if auth_owned(target) {
            return None;
        }
        if !actor_present {
            // Unauthenticated mutation or download redirected to login: the
            // gated handler never ran.
            return Some("denied");
        }
        if success_owned(target) {
            return None;
        }
        return Some("committed");
    }
    if status < 400 {
        if action == "document.download" {
            return Some("committed");
        }
        if success_owned(target) {
            return None;
        }
        return Some("committed");
    }
    Some("failed")
}

/// Authentication routes record their own committed event (or are no-ops);
/// their redirects never imply a denied request.
pub fn auth_owned(target: &str) -> bool {
    matches!(target, "/login/dev" | "/login/google" | "/logout")
}

/// Sign-in challenge sessions ("preauth:") are not user identities;
/// `audit_events.actor_id` references `users(id)`.
pub fn is_real_actor(uid: &str) -> bool {
    !uid.starts_with("preauth:")
}

/// Paths whose successful POSTs are recorded transactionally by their own
/// handler/transaction rather than by the request layer. Kept in sync with
/// handler ownership: invitations, platform administration, and role-template
/// copies append conditional audit rows in their own mutation batches.
pub fn success_owned(target: &str) -> bool {
    if matches!(target, "/orgs" | "/invitations/accept" | "/platform/users/admin" | "/platform/role-templates") {
        return true;
    }
    let seg: Vec<&str> = target.split('/').collect();
    if seg.get(1) != Some(&"org") {
        return false;
    }
    match seg.get(3).copied() {
        Some("transactions") | Some("imports") | Some("inventory") => true,
        Some("settings") => true,
        _ => false,
    }
}

/// 1-based page number from a raw query value.
pub fn page_number(raw: Option<&str>) -> u32 {
    raw.and_then(|v| v.parse::<u32>().ok())
        .filter(|p| *p >= 1)
        .unwrap_or(1)
}

pub fn page_offset(page: u32) -> i64 {
    (i64::from(page) - 1) * PAGE_SIZE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observe_mutations_and_downloads_record_intent() {
        assert_eq!(observe("/org/acme/settings", true), Some(("http.post", true)));
        assert_eq!(observe("/login/google", true), Some(("http.post", true)));
        assert_eq!(
            observe("/org/acme/documents/7", false),
            Some(("document.download", true))
        );
        assert_eq!(
            observe("/org/acme/documents/7", true),
            Some(("http.post", true))
        );
    }

    #[test]
    fn observe_private_pages_watch_only() {
        assert_eq!(
            observe("/org/acme/transactions", false),
            Some(("http.get", false))
        );
        assert_eq!(observe("/platform", false), Some(("http.get", false)));
        assert_eq!(
            observe("/platform/users/admin", false),
            Some(("http.get", false))
        );
    }

    #[test]
    fn observe_public_paths_ignore() {
        assert_eq!(observe("/orgs", false), None);
        assert_eq!(observe("/login", false), None);
        assert_eq!(observe("/healthz", false), None);
        assert_eq!(observe("/", false), None);
        assert_eq!(observe("/invitations/abc/accept", false), None);
        assert_eq!(observe("/org", false), None);
    }

    #[test]
    fn org_slug_extraction() {
        assert_eq!(org_slug("/org/acme/transactions"), Some("acme"));
        assert_eq!(org_slug("/org/acme"), Some("acme"));
        assert_eq!(org_slug("/org/"), None);
        assert_eq!(org_slug("/platform"), None);
    }

    #[test]
    fn invitation_targets_stay_opaque() {
        assert_eq!(normalize_target("/invitations/secret-token/accept"), "/invitations/accept");
        assert_eq!(
            normalize_target("/org/acme/transactions/5/approve"),
            "/org/:org/transactions/5/approve"
        );
    }

    #[test]
    fn every_registered_route_normalizes_bounded() {
        // (request path, persisted target): org slugs redact to ":org";
        // numeric resource ids persist; scope stays in the org_id column.
        let routes = [
            ("/login/dev", "/login/dev"),
            ("/login/google", "/login/google"),
            ("/logout", "/logout"),
            ("/orgs", "/orgs"),
            ("/platform", "/platform"),
            ("/platform/users/admin", "/platform/users/admin"),
            ("/platform/role-templates", "/platform/role-templates"),
            ("/invitations/accept", "/invitations/accept"),
            ("/org/acme/transactions", "/org/:org/transactions"),
            ("/org/acme/transactions/5", "/org/:org/transactions/5"),
            ("/org/acme/transactions/5/details", "/org/:org/transactions/5/details"),
            ("/org/acme/transactions/5/submit", "/org/:org/transactions/5/submit"),
            ("/org/acme/transactions/5/approve", "/org/:org/transactions/5/approve"),
            ("/org/acme/transactions/5/request-changes", "/org/:org/transactions/5/request-changes"),
            ("/org/acme/transactions/5/comments", "/org/:org/transactions/5/comments"),
            ("/org/acme/transactions/5/documents", "/org/:org/transactions/5/documents"),
            ("/org/acme/transactions/5/suppress", "/org/:org/transactions/5/suppress"),
            ("/org/acme/transactions/5/unsuppress", "/org/:org/transactions/5/unsuppress"),
            ("/org/acme/documents/7", "/org/:org/documents/7"),
            ("/org/acme/imports", "/org/:org/imports"),
            ("/org/acme/imports/9", "/org/:org/imports/9"),
            ("/org/acme/imports/9/confirm", "/org/:org/imports/9/confirm"),
            ("/org/acme/inventory", "/org/:org/inventory"),
            ("/org/acme/inventory/items", "/org/:org/inventory/items"),
            ("/org/acme/inventory/locations", "/org/:org/inventory/locations"),
            ("/org/acme/inventory/stock", "/org/:org/inventory/stock"),
            ("/org/acme/inventory/items/3", "/org/:org/inventory/items/3"),
            ("/org/acme/settings", "/org/:org/settings"),
            ("/org/acme/settings/mappings", "/org/:org/settings/mappings"),
            ("/org/acme/settings/pockets", "/org/:org/settings/pockets"),
            ("/org/acme/settings/members", "/org/:org/settings/members"),
            ("/org/acme/settings/members/3/role", "/org/:org/settings/members/3/role"),
            ("/org/acme/settings/members/3/remove", "/org/:org/settings/members/3/remove"),
            ("/org/acme/settings/members/3/restore", "/org/:org/settings/members/3/restore"),
            ("/org/acme/settings/roles", "/org/:org/settings/roles"),
            ("/org/acme/settings/roles/4", "/org/:org/settings/roles/4"),
            ("/org/acme/settings/notifications", "/org/:org/settings/notifications"),
            ("/org/acme/settings/role-templates", "/org/:org/settings/role-templates"),
            ("/org/acme/settings/invitations", "/org/:org/settings/invitations"),
            ("/org/acme/settings/invitations/abc123/revoke", "/org/:org/settings/invitations/:invitation/revoke"),
            ("/org/acme/settings/invitations/abc123/resend", "/org/:org/settings/invitations/:invitation/resend"),
            ("/org/acme/settings/mappings/6/delete", "/org/:org/settings/mappings/6/delete"),
            ("/org/acme/notifications/digest", "/org/:org/notifications/digest"),
        ];
        for (route, target) in routes {
            assert_eq!(normalize_target(route), target);
        }
    }

    #[test]
    fn hostile_dynamic_segments_stay_bounded() {
        // Arbitrary resource ids are rejected outright.
        let hostile_ids = [
            "/org/acme/transactions/SECRET/details",
            "/org/acme/documents/not-a-number",
            "/org/acme/imports/9e9/confirm",
            "/org/acme/settings/members/abc/role",
            "/org/acme/settings/invitations/-1/revoke",
            "/org/acme/settings/invitations/not-hex-token/revoke",
            "/org/acme/settings/mappings/1.5/delete",
            "/org/acme/inventory/items/99999999999999999999",
            "/org/acme/transactions/%20/details",
        ];
        for path in hostile_ids {
            assert_eq!(
                normalize_target(path),
                "/unrecognized",
                "non-numeric or oversized resource id must not persist"
            );
        }
        // Slugs are redacted, never persisted, whatever they contain.
        assert_eq!(normalize_target("/org/SECRET/settings"), "/org/:org/settings");
        assert_eq!(normalize_target("/org/../settings"), "/org/:org/settings");
        let redacted = normalize_target("/org/some-long-slug-from-a-link/transactions/5");
        assert_eq!(redacted, "/org/:org/transactions/5");
        assert!(!redacted.contains("some-long-slug"));
        // Route ownership still works on normalized targets.
        assert!(success_owned(&normalize_target("/org/SECRET/settings/members")));
        assert!(success_owned(&normalize_target("/org/acme/settings/members")));
        assert!(!success_owned("/unrecognized"));
        assert!(!auth_owned("/unrecognized"));
    }

    #[test]
    fn arbitrary_paths_never_persist_verbatim() {
        let hostile = [
            "/org/acme/transactions/5/accept?ticket=opaque-abc123",
            "/deep/link/with/opaque-token-9f8e7d",
            "/org/acme/settings/mappings/5/unknown-verb",
            "/org/acme/unknown-resource",
            "/org/acme/settings/invitations/5/forward",
            "/platform/unknown",
            "/login/other",
            "/password-reset/8f3b2c",
            "/org/acme/settings/",
            "",
            "/",
            "/org/acme/transactions/5/details/extra",
        ];
        for path in hostile {
            assert_eq!(
                normalize_target(path),
                "/unrecognized",
                "arbitrary path must reduce to /unrecognized"
            );
        }
        // Route ownership still holds after normalization for known shapes,
        // and unknown paths cannot inherit it.
        assert!(auth_owned(&normalize_target("/login/dev")));
        assert!(success_owned(&normalize_target("/org/acme/settings/members")));
        assert!(!success_owned("/unrecognized"));
        assert!(!auth_owned("/unrecognized"));
        assert_eq!(
            classify(
                &normalize_target("/deep/link/opaque-token"),
                "http.post",
                true,
                false,
                404
            ),
            Some("failed")
        );
    }

    #[test]
    fn mapping_audit_targets_carry_no_bank_labels() {
        // The bank actor label is user content that must stay in
        // actor_mappings only; the audit target uses the membership id.
        let pattern = "PT SUMBER REZEKI SURABAYA";
        let target = format!("mapping:member-{}", 42_i64);
        assert!(!target.contains(pattern));
        assert!(!normalize_target(&format!(
            "/org/acme/{pattern}"
        ))
        .contains(pattern));
    }

    #[test]
    fn watched_pages_record_only_explicit_denials() {
        let watch = ("http.get", false);
        assert_eq!(
            classify("/org/acme/transactions", watch.0, watch.1, true, 403),
            Some("denied")
        );
        assert_eq!(
            classify("/org/acme/transactions", watch.0, watch.1, false, 401),
            Some("denied")
        );
        // Anonymous redirects and success are ordinary browsing.
        assert_eq!(
            classify("/org/acme/transactions", watch.0, watch.1, false, 303),
            None
        );
        assert_eq!(
            classify("/org/acme/transactions", watch.0, watch.1, true, 200),
            None
        );
    }

    #[test]
    fn intents_classify_denied_failed_committed() {
        let post = ("http.post", true);
        assert_eq!(
            classify("/org/acme/settings", post.0, post.1, true, 403),
            Some("denied")
        );
        assert_eq!(
            classify("/org/acme/settings", post.0, post.1, false, 303),
            Some("denied")
        );
        assert_eq!(
            classify("/invitations/accept", post.0, post.1, false, 303),
            Some("denied")
        );
        assert_eq!(
            classify("/org/acme/settings", post.0, post.1, true, 400),
            Some("failed")
        );
        assert_eq!(
            classify("/org/acme/settings", post.0, post.1, true, 500),
            Some("failed")
        );
        // Redirect with an actor: unowned paths get an HTTP-level record;
        // invitation acceptance is owned by its transaction instead.
        assert_eq!(
            classify("/invitations/accept", post.0, post.1, true, 303),
            None
        );
        // Owned paths are recorded by their own transaction instead.
        assert_eq!(
            classify("/org/acme/settings", post.0, post.1, true, 303),
            None
        );
        // A successful sign-in redirects before a user session exists.
        assert_eq!(classify("/login/google", post.0, post.1, false, 303), None);
        assert_eq!(classify("/logout", post.0, post.1, false, 303), None);
    }

    #[test]
    fn downloads_record_outcome() {
        assert_eq!(
            classify(
                "/org/acme/documents/7",
                "document.download",
                true,
                true,
                200
            ),
            Some("committed")
        );
        assert_eq!(
            classify(
                "/org/acme/documents/7",
                "document.download",
                true,
                false,
                303
            ),
            Some("denied")
        );
        assert_eq!(
            classify(
                "/org/acme/documents/7",
                "document.download",
                true,
                true,
                404
            ),
            Some("failed")
        );
    }

    #[test]
    fn success_registry_matches_handler_ownership() {
        assert!(success_owned("/orgs"));
        assert!(auth_owned("/login/dev"));
        assert!(auth_owned("/login/google"));
        assert!(auth_owned("/logout"));
        assert!(!success_owned("/login/dev"));
        assert!(success_owned("/org/acme/transactions/5/approve"));
        assert!(success_owned("/org/acme/transactions/5/comments"));
        assert!(success_owned("/org/acme/imports"));
        assert!(success_owned("/org/acme/imports/9/confirm"));
        assert!(success_owned("/org/acme/inventory/stock"));
        assert!(success_owned("/org/acme/settings/members"));
        assert!(success_owned("/org/acme/settings/members/3/role"));
        // Invitation handlers record their own conditional committed rows.
        assert!(success_owned("/invitations/accept"));
        assert!(success_owned("/org/acme/settings/invitations"));
        assert!(success_owned(
            "/org/acme/settings/invitations/9/revoke"
        ));
        assert!(success_owned("/platform/users/admin"));
        assert!(success_owned("/platform/role-templates"));
        assert!(success_owned("/org/acme/settings/role-templates"));
        assert!(!success_owned("/org/acme/documents/7"));
        assert!(!success_owned("/org/acme/notifications/digest"));
    }

    #[test]
    fn pagination_bounds() {
        assert_eq!(page_number(None), 1);
        assert_eq!(page_number(Some("0")), 1);
        assert_eq!(page_number(Some("junk")), 1);
        assert_eq!(page_number(Some("3")), 3);
        assert_eq!(page_offset(1), 0);
        assert_eq!(page_offset(2), PAGE_SIZE);
    }

    #[test]
    fn challenge_sessions_are_not_actors() {
        assert!(!is_real_actor("preauth:abc123"));
        assert!(is_real_actor("u:fixture"));
        assert!(is_real_actor("g:424242"));
    }
}
