//! SMTP/STARTTLS transport over Workers platform sockets plus the durable
//! D1 delivery rows behind invitation links. wasm-only: `worker::Socket`
//! exists only in the Workers runtime.
//!
//! Security posture:
//! - Plaintext is used only up to STARTTLS; the upgrade uses platform TLS
//!   (`Socket::start_tls`, certificate-validated). There is no plaintext
//!   fallback: if the server does not advertise STARTTLS, sending aborts.
//!   Port 465 is implicit TLS from the first byte.
//! - Every read/write races a session deadline; a hung server cannot wedge
//!   the Worker.
//! - Raw tokens live in links only; D1 stores SHA-256 hashes. Resending
//!   supersedes older links so exactly one live token exists per invitation.
//! - SMTP_PASSWORD never enters error strings, redirects, or the database.

use crate::smtp as proto;
use crate::tokens;
use std::future::poll_fn;
use std::future::Future as _;
use std::pin::Pin;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use url::form_urlencoded;
use worker::{Delay, SecureTransport, Socket};

use crate::web::{db, get_var, D1Database, Env};

/// Whole-session budget (ms): connect, STARTTLS, AUTH, message, replies.
const DEADLINE_MS: i64 = 30_000;
/// Reply buffer cap: far above any sane banner + capability block.
const MAX_REPLY_BYTES: usize = 64 * 1024;

/// Send outcome for redirect/status messaging.
pub struct Outcome {
    pub sent: bool,
    pub disabled: bool,
    pub error: Option<String>,
}

impl Outcome {
    /// Flash message shown after create/resend. Passwords never appear.
    pub fn message(&self) -> String {
        if self.sent {
            "Invitation created. Email sent.".to_string()
        } else if self.disabled {
            "Invitation created. Email delivery is not connected.".to_string()
        } else {
            format!(
                "Invitation created. Email delivery failed - use Resend. ({})",
                self.error
                    .clone()
                    .unwrap_or_else(|| "unknown error".to_string())
            )
        }
    }
}

/// Mark the row for `token_hash` sent/failed/pending+error and return the
/// number of affected rows (SQLite `changes`). Keyed by invitation+hash AND
/// status='pending': a concurrent resend supersedes the row, and a late
/// completion of the superseded send must never flip it to `sent` (that
/// would resurrect a dead link) — the caller reports an honest outcome when
/// 0 rows were affected.
async fn mark(
    db: &D1Database,
    invitation_id: &str,
    token_hash: &str,
    status: &str,
    error: Option<&str>,
    sent_at: Option<i64>,
) -> db::WResult<usize> {
    let result = db
        .prepare(
            "UPDATE invitation_mail SET status=?3,error=?4,sent_at=?5 WHERE invitation_id=?1 AND token_hash=?2 AND status='pending'",
        )
        .bind(&[
            db::s(invitation_id),
            db::s(token_hash),
            db::s(status),
            db::opt_s(error),
            db::opt_i(sent_at),
        ])?
        .run()
        .await?;
    let changes = result
        .meta()?
        .and_then(|m| m.changes)
        .unwrap_or_default();
    Ok(changes)
}

/// Request origin that may appear in an emailed link: http(s) only, no
/// whitespace or control characters.
fn usable_base_url(origin: &str) -> bool {
    !origin.is_empty()
        && !origin
            .bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
        && (origin.starts_with("https://") || origin.starts_with("http://"))
}

/// Store the invitation email durably (the pending row already exists), then
/// try to deliver it over SMTP. Failures are recorded on the row, never
/// thrown: the invitation itself was already accepted into D1.
#[allow(clippy::too_many_arguments)]
pub async fn deliver(
    env: &Env,
    db: &D1Database,
    invitation_id: &str,
    token: &str,
    org_name: &str,
    role_name: &str,
    expires_at: i64,
    to: &str,
    base_url: &str,
) -> worker::Result<Outcome> {
    let token_hash = tokens::hash(token);
    if !usable_base_url(base_url) {
        let msg = "Request origin is not a usable link base URL.";
        mark(db, invitation_id, &token_hash, "failed", Some(msg), None).await?;
        return Ok(Outcome {
            sent: false,
            disabled: false,
            error: Some(msg.to_string()),
        });
    }
    if get_var(env, "EMAIL_DELIVERY_ENABLED").as_deref() != Some("true") {
        let discarded = mark(
            db,
            invitation_id,
            &token_hash,
            "pending",
            Some("Email delivery is disabled (EMAIL_DELIVERY_ENABLED)."),
            None,
        )
        .await?
            == 0;
        return Ok(Outcome {
            sent: false,
            disabled: true,
            error: discarded.then(|| "Result discarded; the link was superseded by a newer resend.".to_string()),
        });
    }
    let cfg = proto::build_config(
        &get_var(env, "SMTP_HOST").unwrap_or_default(),
        &get_var(env, "SMTP_PORT").unwrap_or_default(),
        &get_var(env, "SMTP_USERNAME").unwrap_or_default(),
        &get_var(env, "SMTP_PASSWORD").unwrap_or_default(),
        &get_var(env, "SMTP_FROM").unwrap_or_default(),
    );
    let cfg = match cfg {
        Ok(c) => c,
        Err(e) => {
            mark(db, invitation_id, &token_hash, "failed", Some(&e), None).await?;
            return Ok(Outcome {
                sent: false,
                disabled: false,
                error: Some(e),
            });
        }
    };
    db::exec(
        db,
        "UPDATE invitation_mail SET attempts=attempts+1 WHERE invitation_id=?1 AND token_hash=?2",
        vec![db::s(invitation_id), db::s(&token_hash)],
    )
    .await?;
    let outcome = match deliver_smtp(&cfg, to, org_name, role_name, expires_at, base_url, token, &token_hash).await
    {
        Ok(()) => Outcome {
            sent: true,
            disabled: false,
            error: None,
        },
        Err(e) => {
            let msg = proto::error_line(&e, 300);
            Outcome {
                sent: false,
                disabled: false,
                error: Some(msg),
            }
        }
    };
    // Only a still-pending row may be flipped. If a concurrent resend
    // superseded this delivery mid-flight, `mark` affected 0 rows: report an
    // honest outcome (never sent:true) instead of resurrecting the row.
    let changed = mark(
        db,
        invitation_id,
        &token_hash,
        if outcome.sent { "sent" } else { "failed" },
        outcome.error.as_deref(),
        outcome.sent.then_some(db::now_ms()),
    )
    .await?;
    let outcome = if changed == 0 {
        Outcome {
            sent: false,
            disabled: false,
            error: Some(
                "Result discarded; the link was superseded by a newer resend.".to_string(),
            ),
        }
    } else {
        outcome
    };
    Ok(outcome)
}

/// The plain-text invitation body: org, role, single-use link, expiry.
/// No financial details (product policy).
fn invitation_body(
    org_name: &str,
    role_name: &str,
    expires_at: i64,
    base_url: &str,
    token: &str,
) -> String {
    let expires = proto::format_date_ms(expires_at);
    format!(
        "You have been invited to join {org_name} on PocketTrail as {role_name}.\n\n\
         Open this single-use link to accept with your verified Google account:\n\n\
         {base_url}/invitations/accept?token={token}\n\n\
         The link expires {expires} and works once.\n\
         If you were not expecting this invitation you can ignore it; the link \
         stops working on expiry or when the invitation is revoked.\n\n\
         Financial details stay in PocketTrail; this email carries none.\n"
    )
}

// ------------------------------------------------------------ SMTP session

/// Race an I/O future against `budget_ms`. Returns a plain error string on
/// timeout so callers can record one consistent failure shape.
async fn bounded<T>(
    fut: impl std::future::Future<Output = std::io::Result<T>>,
    budget_ms: i64,
) -> Result<T, String> {
    let mut f = Box::pin(fut);
    let mut d = Box::pin(Delay::from(Duration::from_millis(budget_ms.max(1) as u64)));
    poll_fn(|cx| {
        use std::task::Poll;
        if let Poll::Ready(res) = f.as_mut().poll(cx) {
            return Poll::Ready(res.map_err(|e| format!("SMTP I/O failed: {e}")));
        }
        if let Poll::Ready(()) = d.as_mut().poll(cx) {
            return Poll::Ready(Err("SMTP operation timed out.".to_string()));
        }
        Poll::Pending
    })
    .await
}

struct Session {
    sock: Option<Socket>,
    buf: String,
    started: i64,
}

impl Session {
    fn connect(cfg: &proto::Config) -> worker::Result<Session> {
        let sock = Socket::builder()
            .secure_transport(if cfg.port == 465 {
                SecureTransport::On
            } else {
                SecureTransport::StartTls
            })
            .connect(&cfg.host, cfg.port)?;
        Ok(Session {
            sock: Some(sock),
            buf: String::new(),
            started: db::now_ms(),
        })
    }

    fn remaining(&self) -> i64 {
        DEADLINE_MS - (db::now_ms() - self.started)
    }

    fn out_of_time(&self) -> bool {
        self.remaining() <= 0
    }

    async fn read_chunk(&mut self) -> std::io::Result<Vec<u8>> {
        let mut scratch = [0u8; 4096];
        let mut rb = ReadBuf::new(&mut scratch);
        let sock = self.sock.as_mut().expect("socket kept until close");
        poll_fn(|cx| Pin::new(&mut *sock).poll_read(cx, &mut rb)).await?;
        Ok(rb.filled().to_vec())
    }
}

/// Platform-socket session: every operation races the session deadline.
/// Grammar (EHLO/AUTH/DATA ordering) lives in `smtp::send_message` behind
/// the `SessionFlow` seam and is natively tested with a scripted fake.
impl proto::SessionFlow for Session {
    async fn opened(&mut self) -> Result<(), String> {
        let left = self.remaining();
        let sock = self.sock.as_mut().expect("socket kept until close");
        bounded(
            async move {
                sock.opened()
                    .await
                    .map(|_| ())
                    .map_err(|e| std::io::Error::other(e.to_string()))
            },
            left,
        )
        .await
    }

    async fn read_reply(&mut self) -> Result<proto::Reply, String> {
        loop {
            if let Some(r) = proto::take_reply(&mut self.buf) {
                return Ok(r);
            }
            if self.out_of_time() {
                return Err("SMTP timed out while reading a reply.".to_string());
            }
            let left = self.remaining();
            let chunk = bounded(self.read_chunk(), left).await?;
            if chunk.is_empty() {
                return Err("SMTP connection closed unexpectedly.".to_string());
            }
            self.buf.push_str(&String::from_utf8_lossy(&chunk));
            if self.buf.len() > MAX_REPLY_BYTES {
                return Err("SMTP reply too large.".to_string());
            }
        }
    }

    async fn send_raw(&mut self, data: &str) -> Result<(), String> {
        let left = self.remaining();
        let sock = self.sock.as_mut().expect("socket kept until close");
        bounded(
            async move {
                let mut payload = data.as_bytes();
                while !payload.is_empty() {
                    let n = poll_fn(|cx| Pin::new(&mut *sock).poll_write(cx, payload)).await?;
                    if n == 0 {
                        // AsyncWrite may legally return Ok(0); looping would
                        // spin forever against the deadline timer.
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::WriteZero,
                            "socket write made no progress",
                        ));
                    }
                    payload = &payload[n..];
                }
                poll_fn(|cx| Pin::new(&mut *sock).poll_flush(cx)).await
            },
            left,
        )
        .await
    }

    /// Upgrade to platform TLS after a 220 STARTTLS reply. There is no
    /// downgrade path; the new socket is certificate-validated by the runtime.
    fn upgrade(&mut self) {
        let plain = self.sock.take().expect("socket kept until close");
        self.sock = Some(plain.start_tls());
        self.buf.clear();
    }

    /// Best-effort cleanup bounded by a fixed small budget: QUIT then close.
    /// Runs on EVERY exit path (success or error) so no socket is left
    /// dangling and no cleanup can hang the Worker. A delivered message's
    /// final 250 is already recorded before this runs.
    async fn quit_and_close(&mut self) {
        let _ = proto::send_line(self, "QUIT").await;
        if let Some(mut s) = self.sock.take() {
            let _ = bounded(
                async move {
                    s.close()
                        .await
                        .map_err(|e| std::io::Error::other(e.to_string()))
                },
                3_000,
            )
            .await;
        }
    }
}

/// Build the invitation email body and drive the session over the socket.
async fn deliver_smtp(
    cfg: &proto::Config,
    to: &str,
    org_name: &str,
    role_name: &str,
    expires_at: i64,
    base_url: &str,
    token: &str,
    token_hash: &str,
) -> Result<(), String> {
    let body = invitation_body(org_name, role_name, expires_at, base_url, token);
    let date = proto::format_date_ms(db::now_ms());
    let mut s = Session::connect(cfg).map_err(|e| format!("SMTP connect failed: {e}"))?;
    proto::send_message(&mut s, cfg, to, org_name, token_hash, &body, &date).await
}

/// Percent-encoded `?msg=` query value for settings redirects.
pub fn msg_query(msg: &str) -> String {
    form_urlencoded::Serializer::new(String::new())
        .append_pair("msg", msg)
        .finish()
}
