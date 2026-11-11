pub mod aggregate;
pub mod audit;
pub mod auth_routes;
pub mod db;
pub mod google;
pub mod imports;
pub mod inventory;
pub mod invitations;
pub mod notify;
pub mod orgs;
pub mod platform;
pub use crate::render;
pub mod settings;
pub mod txns;

use crate::auth::{self, Session};
use pockettrail_domain::{authorize, Organization, Permission, UserId};
use std::collections::BTreeMap;
use worker::FormEntry as FormDataEntry;
use worker::*;

use aggregate::*;

/// Per-request application state.
#[derive(Clone)]
pub struct App {
    pub db: std::rc::Rc<D1Database>,
    pub r2: Option<Bucket>,
    pub secret: Option<String>,
    pub local_dev: bool,
    pub google_client_id: Option<String>,
}

impl App {
    pub fn from_env(env: &Env) -> App {
        App {
            db: std::rc::Rc::new(env.d1("DB").expect("D1 binding DB missing")),
            r2: env.bucket("DOCUMENTS").ok(),
            secret: get_var(env, "SECRET_SESSION_KEY").filter(|s| s.len() >= 32),
            local_dev: get_var(env, "LOCAL_DEV").as_deref() == Some("true"),
            google_client_id: get_var(env, "GOOGLE_CLIENT_ID").filter(|s| !s.is_empty()),
        }
    }
}

pub fn get_var(env: &Env, name: &str) -> Option<String> {
    env.var(name).ok().map(|v| v.to_string())
}

/// Authenticated user (any login path).
pub struct Login {
    pub app: App,
    pub session: Session,
    pub user: UserRow,
}

/// Org-scoped context: session + org + active membership + domain aggregate.
pub struct Ctx {
    pub app: App,
    pub session: Session,
    pub user: UserRow,
    pub org: OrgRow,
    pub dom_org: Organization,
    pub mems: Vec<MemRow>,
}

impl Ctx {
    pub fn uid(&self) -> UserId {
        UserId::new(self.user.id.clone())
    }

    pub fn can(&self, p: Permission) -> bool {
        self.dom_org.permissions_for(&self.uid()).contains(&p)
    }

    pub fn me(&self) -> &MemRow {
        self.mems
            .iter()
            .find(|m| m.user_id == self.user.id)
            .expect("own membership resolved")
    }

    pub fn mem_name(&self, membership_id: Option<i64>) -> Option<String> {
        membership_id.and_then(|id| {
            self.mems
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.name.clone())
        })
    }

    /// JSON context shared by every org page (template globals).
    pub async fn base_json(
        &self,
        active_nav: &str,
        flash: Option<&str>,
        error: Option<&str>,
    ) -> serde_json::Value {
        let orgs = orgs_of_user(&self.app.db, &self.user.id)
            .await
            .unwrap_or_default();
        serde_json::json!({
            "user": {"name": self.user.name, "email": self.user.email, "picture": self.user.picture.as_deref().and_then(crate::profile::google_picture), "is_platform_admin": self.user.is_platform_admin != 0},
            "org": {"slug": self.org.slug, "name": self.org.name,
                     "notifications_enabled": db_flag(self.org.notifications_enabled)},
            "organizations": orgs.iter().map(|o| serde_json::json!({"slug": o.slug, "name": o.name})).collect::<Vec<_>>(),
            "active_nav": active_nav,
            "is_synthetic": db_flag(self.org.is_synthetic),
            "local_mode": self.app.local_dev,
            "csrf_token": self.session.csrf,
            "flash": flash,
            "error": error,
        })
    }
}

fn db_flag(v: i64) -> bool {
    v != 0
}

// ---------------------------------------------------------------- responses

macro_rules! try_resp {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(resp) => return Ok(resp),
        }
    };
}
pub(crate) use try_resp;

pub fn html(status: u16, body: String) -> Response {
    let h = Headers::new();
    let _ = h.set("Content-Type", "text/html; charset=utf-8");
    let _ = h.set("Cache-Control", "private, no-store");
    let _ = h.set("X-Content-Type-Options", "nosniff");
    let _ = h.set("Referrer-Policy", "same-origin");
    let _ = h.set("X-Frame-Options", "DENY");
    Response::builder()
        .with_headers(h)
        .with_status(status)
        .fixed(body.into_bytes())
}

pub fn redirect(to: &str) -> Response {
    let h = Headers::new();
    let _ = h.set("Location", to);
    let _ = h.set("Cache-Control", "private, no-store");
    Response::builder().with_status(303).with_headers(h).empty()
}

pub fn page(_app: &App, name: &str, ctx: serde_json::Value) -> Response {
    match render::render(name, ctx) {
        Ok(body) => html(200, body),
        Err(e) => {
            console_error!("template render failed: {}", e);
            html(500, "<h1>Render error</h1><p>See worker logs.</p>".into())
        }
    }
}

/// Fail-closed error page. `msg` is HTML-escaped.
pub fn fail(status: u16, msg: &str) -> Response {
    html(
        status,
        format!(
            "<!doctype html><title>{}</title><h1>{}</h1><p>{}</p><p><a href=\"/orgs\">Back</a></p>",
            status,
            status,
            render::html_escape(msg)
        ),
    )
}

pub fn werr(e: worker::Error) -> Response {
    console_error!("application operation failed: {}", e);
    fail(
        500,
        "The operation could not be completed. Your data has not been published.",
    )
}

pub fn with_cookie(mut resp: Response, cookie_header: &str) -> Response {
    let _ = resp.headers_mut().set("Set-Cookie", cookie_header);
    resp
}

// ------------------------------------------------------------------- guards

fn host_is_loopback(req: &Request) -> bool {
    req.headers()
        .get("Host")
        .ok()
        .flatten()
        .map(|h| auth::host_is_loopback(&h))
        .unwrap_or(false)
}

fn session_from(req: &Request, app: &App) -> Option<Session> {
    let secret = app.secret.as_ref()?;
    let cookie = req
        .headers()
        .get("Cookie")
        .ok()
        .flatten()
        .and_then(|h| auth::session_cookie_value(&h))?;
    auth::decode_cookie(secret, &cookie, crate::web::db::now_secs())
}

/// Require a logged-in user; redirects to /login when absent or unconfigured.
pub async fn require_login(app: App, req: &Request) -> Result<Login, Response> {
    if app.secret.is_none() {
        return Err(fail(
            503,
            "SECRET_SESSION_KEY is not configured; authentication fails closed.",
        ));
    }
    let Some(session) = session_from(req, &app) else {
        return Err(redirect("/login"));
    };
    let user: Option<UserRow> = crate::web::db::q_one(
        &app.db,
        "SELECT id, email, name, google_sub, picture, is_platform_admin, created_at FROM users WHERE id = ?1",
        vec![crate::web::db::s(&session.uid)],
    )
    .await
    .map_err(werr)?;
    user.map(|user| Login { app, session, user })
        .ok_or_else(|| redirect("/login"))
}

/// Require an active membership of `slug` granting `perm`. Domain
/// `authorize` is the single enforcement point (fail closed).
pub async fn require_member(
    app: App,
    req: &Request,
    slug: &str,
    perm: Permission,
) -> Result<Ctx, Response> {
    let g = require_active_member(app, req, slug).await?;
    authorize(&g.dom_org, &g.uid(), perm).map_err(|e| fail(403, &e.to_string()))?;
    Ok(g)
}

pub async fn require_active_member(app: App, req: &Request, slug: &str) -> Result<Ctx, Response> {
    let login = require_login(app, req).await?;
    let Some(org) = org_by_slug(&login.app.db, slug).await.map_err(werr)? else {
        return Err(fail(404, "Unknown organization."));
    };
    let mems = mems_of_org(&login.app.db, org.id).await.map_err(werr)?;
    let roles = roles_of_org(&login.app.db, org.id).await.map_err(werr)?;
    let dom_org = build_dom_org(&org, &roles, &mems);
    let uid = UserId::new(login.user.id.clone());
    if !dom_org.member_is_active(&uid) {
        return Err(fail(403, "Active organization membership required."));
    }
    Ok(Ctx {
        session: login.session,
        app: login.app,
        user: login.user,
        org,
        dom_org,
        mems,
    })
}

/// Parse a POST body and enforce the CSRF token against the session.
pub async fn form_post(ctx: &Ctx, req: &mut Request) -> Result<FormData, Response> {
    same_origin(req)?;
    let form = req.form_data().await.map_err(werr)?;
    let sent = match form.get("csrf_token") {
        Some(FormDataEntry::Field(s)) => s.clone(),
        _ => String::new(),
    };
    if sent.is_empty() || sent != ctx.session.csrf {
        return Err(fail(403, "CSRF token missing or invalid."));
    }
    Ok(form)
}

/// Reject browser cross-origin mutations in addition to checking the CSRF token.
pub fn same_origin(req: &Request) -> Result<(), Response> {
    if let Ok(Some(origin)) = req.headers().get("Origin") {
        let expected = req.url().map_err(werr)?.origin().ascii_serialization();
        if origin != expected {
            return Err(fail(403, "Cross-origin requests are not allowed."));
        }
    }
    if req
        .headers()
        .get("Sec-Fetch-Site")
        .ok()
        .flatten()
        .as_deref()
        == Some("cross-site")
    {
        return Err(fail(403, "Cross-site requests are not allowed."));
    }
    Ok(())
}

pub fn form_str(form: &FormData, name: &str) -> Option<String> {
    match form.get(name) {
        Some(FormDataEntry::Field(s)) => Some(s.clone()),
        _ => None,
    }
}

pub fn form_file(form: &FormData, name: &str) -> Option<worker::File> {
    match form.get(name) {
        Some(FormDataEntry::File(f)) => Some(f),
        _ => None,
    }
}

pub fn form_strings(form: &FormData, name: &str) -> Vec<String> {
    form.get_all(name)
        .map(|entries| {
            entries
                .into_iter()
                .filter_map(|e| match e {
                    FormDataEntry::Field(s) => Some(s.clone()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn query_param(req: &Request, name: &str) -> Option<String> {
    let url = req.url().ok()?;
    url.query_pairs()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.to_string())
}

pub fn path_param<D>(ctx: &RouteContext<D>, name: &str) -> String {
    ctx.param(name).cloned().unwrap_or_default()
}

/// Liveness plus — behind the exact gates of dev fixture login (LOCAL_DEV
/// and a loopback host) — the single delivery flag local smoke preflights
/// before any invitation mutation. Nothing else is reported, and the flag
/// is absent from every response outside that local fixture context. The
/// enabled predicate is the complement of the disabled check in
/// `invitation_mail::deliver`; keep the two in sync.
async fn healthz(req: Request, ctx: RouteContext<App>) -> worker::Result<Response> {
    let mut body = "ok".to_string();
    if ctx.data.local_dev && host_is_loopback(&req) {
        let enabled = get_var(&ctx.env, "EMAIL_DELIVERY_ENABLED").as_deref() == Some("true");
        body.push_str(if enabled {
            "; email_delivery_enabled=true"
        } else {
            "; email_delivery_enabled=false"
        });
    }
    Ok(html(200, body))
}

// ------------------------------------------------------------------ router

fn router(app: App) -> Router<'static, App> {
    Router::with_data(app)
        .get_async("/healthz", healthz)
        .get_async("/", orgs::root)
        .get_async("/login", auth_routes::login_page)
        .post_async("/login/dev", auth_routes::login_dev)
        .post_async("/login/google", auth_routes::login_google)
        .post_async("/logout", auth_routes::logout)
        .get_async("/platform", platform::page)
        .post_async("/platform/users/admin", platform::set_admin)
        .post_async("/platform/role-templates", platform::save_template)
        .get_async("/invitations/accept", invitations::accept_page)
        .post_async("/invitations/accept", invitations::accept_link)
        .post_async("/invitations/:id/accept", invitations::accept)
        .post_async(
            "/org/:org/settings/invitations/:id/resend",
            invitations::resend,
        )
        .post_async("/org/:org/settings/invitations", invitations::create)
        .post_async(
            "/org/:org/settings/invitations/:id/revoke",
            invitations::revoke,
        )
        .post_async(
            "/org/:org/settings/role-templates",
            platform::apply_template,
        )
        .get_async("/orgs", orgs::list)
        .post_async("/orgs", orgs::create)
        // Initial release is statement-first; manual bank movements are not exposed.
        .get_async("/org/:org/transactions", txns::list)
        .get_async("/org/:org/transactions/:id", txns::detail)
        .post_async("/org/:org/transactions/:id/details", txns::save_details)
        .post_async("/org/:org/transactions/:id/submit", txns::submit)
        .post_async("/org/:org/transactions/:id/approve", txns::approve)
        .post_async(
            "/org/:org/transactions/:id/request-changes",
            txns::request_changes,
        )
        .post_async("/org/:org/transactions/:id/comments", txns::add_comment)
        .post_async(
            "/org/:org/transactions/:id/documents",
            txns::upload_document,
        )
        .post_async("/org/:org/transactions/:id/suppress", txns::suppress)
        .post_async("/org/:org/transactions/:id/unsuppress", txns::unsuppress)
        .get_async("/org/:org/documents/:id", txns::download_document)
        // Imports
        .get_async("/org/:org/imports", imports::list_page)
        .post_async("/org/:org/imports", imports::create)
        .get_async("/org/:org/imports/:id", imports::batch_page)
        .post_async("/org/:org/imports/:id/confirm", imports::confirm)
        // Settings
        .get_async("/org/:org/settings", settings::page)
        .post_async("/org/:org/settings/mappings", settings::add_mapping)
        .post_async("/org/:org/settings/pockets", settings::add_pocket)
        .post_async(
            "/org/:org/settings/pockets/:id/owner",
            settings::set_pocket_owner,
        )
        .post_async("/org/:org/settings/income-role", settings::save_income_role)
        .post_async(
            "/org/:org/settings/mappings/:id/delete",
            settings::delete_mapping,
        )
        .post_async("/org/:org/settings/members", settings::add_member)
        .post_async("/org/:org/settings/members/:id/role", settings::set_role)
        .post_async(
            "/org/:org/settings/members/:id/remove",
            settings::remove_member,
        )
        .post_async(
            "/org/:org/settings/members/:id/restore",
            settings::restore_member,
        )
        .post_async("/org/:org/settings/roles", settings::create_role)
        .post_async("/org/:org/settings/roles/:id", settings::update_role)
        .post_async(
            "/org/:org/settings/notifications",
            settings::save_notifications,
        )
        .post_async("/org/:org/notifications/digest", settings::send_digest)
        // Inventory
        .get_async("/org/:org/inventory", inventory::list_page)
        .post_async("/org/:org/inventory/items", inventory::add_item)
        .post_async("/org/:org/inventory/locations", inventory::add_location)
        .post_async("/org/:org/inventory/stock", inventory::update_stock)
        .get_async("/org/:org/inventory/items/:id", inventory::item_page)
}

#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> worker::Result<Response> {
    console_error_panic_hook::set_once();
    if matches!(req.method(), Method::Get | Method::Head) && req.path().starts_with("/static/") {
        let mut url = req.url()?;
        url.set_path(req.path().trim_start_matches("/static"));
        return env.assets("ASSETS")?.fetch(url.to_string(), None).await;
    }
    let app = App::from_env(&env);
    let attempt = audit::begin(&app, &req).await?;
    let response = match router(app.clone()).run(req, env).await {
        Ok(response) => response,
        Err(error) => werr(error),
    };
    audit::finish(&app, attempt, response.status_code()).await?;
    Ok(response)
}
