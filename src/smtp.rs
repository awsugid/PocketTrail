//! Pure SMTP protocol helpers for the invitation mail transport: reply
//! parsing, EHLO capability selection, RFC 5322/2047 message composition,
//! and configuration validation. No I/O here — the platform-socket driver
//! lives in `src/web/invitation_mail.rs` (wasm-only).
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// One complete SMTP reply: `code` plus the text after "NNN " / "NNN-"
/// on each line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub code: u16,
    pub lines: Vec<String>,
}

impl Reply {
    /// First line's text, trimmed.
    pub fn text(&self) -> String {
        self.lines
            .first()
            .map(|l| l.trim().to_string())
            .unwrap_or_default()
    }
}

/// Parse one complete reply from the front of `buf` (RFC 5321 §4.2):
/// `NNN-TEXT` continuation lines end at a `NNN TEXT` line. Incomplete input
/// leaves `buf` untouched and returns `None`; non-conforming lines are
/// skipped so a chatty banner cannot wedge the session (reads stay bounded).
pub fn take_reply(buf: &mut String) -> Option<Reply> {
    let mut lines = Vec::new();
    let mut consumed;
    let mut start = 0usize;
    let mut code;
    loop {
        let bytes = buf.as_bytes();
        let rel = bytes[start..].iter().position(|&b| b == b'\n')?;
        let end = start + rel;
        let raw = &buf[start..end];
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let b = line.as_bytes();
        if b.len() >= 3 && b[..3].iter().all(u8::is_ascii_digit) {
            if let Ok(c) = line[..3].parse::<u16>() {
                let last = b.get(3) != Some(&b'-');
                lines.push(line[4.min(line.len())..].to_string());
                consumed = end + 1;
                code = c;
                if last {
                    break;
                }
                start = end + 1;
                continue;
            }
        }
        start = end + 1; // skip protocol garbage; the read deadline still bounds us
    }
    buf.drain(..consumed);
    Some(Reply { code, lines })
}

/// Lowercased EHLO reply lines: the capability keyword is the first token;
/// AUTH carries its mechanisms on the same line.
pub fn capabilities(reply: &Reply) -> Vec<String> {
    reply
        .lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_ascii_lowercase())
        .collect()
}

pub fn supports_starttls(caps: &[String]) -> bool {
    caps.iter()
        .any(|c| c.split_whitespace().next() == Some("starttls"))
}

/// Pick an advertised AUTH mechanism: PLAIN preferred, LOGIN as fallback.
/// Mechanisms the server never advertised are never attempted.
pub fn pick_auth(caps: &[String]) -> Option<&'static str> {
    let mut plain = false;
    let mut login = false;
    for c in caps {
        let toks: Vec<&str> = c.split_whitespace().collect();
        if toks.first().copied() == Some("auth") {
            for m in toks.iter().skip(1) {
                match *m {
                    "plain" => plain = true,
                    "login" => login = true,
                    _ => {}
                }
            }
        }
        if let Some(eq) = c.strip_prefix("auth=") {
            match eq.split_whitespace().next() {
                Some("plain") => plain = true,
                Some("login") => login = true,
                _ => {}
            }
        }
    }
    if plain {
        Some("PLAIN")
    } else if login {
        Some("LOGIN")
    } else {
        None
    }
}

/// RFC 4616 PLAIN initial-response payload.
pub fn auth_plain(username: &str, password: &str) -> String {
    STANDARD.encode(format!("\x00{username}\x00{password}"))
}

/// EHLO argument: the sending domain (right side of the envelope from).
pub fn ehlo_domain(from: &str) -> Option<String> {
    let d = from.rsplit_once('@')?.1;
    (!d.is_empty()).then(|| d.to_string())
}

pub fn mail_from(from: &str) -> String {
    format!("MAIL FROM:<{from}>")
}

pub fn rcpt_to(to: &str) -> String {
    format!("RCPT TO:<{to}>")
}

/// SMTP settings read from environment variables. The password lives only
/// inside this struct; it never reaches error strings, redirects, or D1.
#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: String,
}

pub fn build_config(
    host: &str,
    port: &str,
    username: &str,
    password: &str,
    from: &str,
) -> Result<Config, String> {
    let host = host.trim();
    if host.is_empty() || host.bytes().any(|b| b.is_ascii_control() || b == b' ' || b == b'/') {
        return Err("SMTP_HOST is missing or invalid.".to_string());
    }
    let port: u16 = port
        .trim()
        .parse()
        .map_err(|_| "SMTP_PORT must be a number between 1 and 65535.".to_string())?;
    if port == 0 {
        return Err("SMTP_PORT must be a number between 1 and 65535.".to_string());
    }
    if username.is_empty() || username.bytes().any(|b| b.is_ascii_control()) {
        return Err("SMTP_USERNAME is missing or invalid.".to_string());
    }
    if password.is_empty() {
        return Err("SMTP_PASSWORD is missing or invalid.".to_string());
    }
    if !crate::profile::valid_email(from) {
        return Err("SMTP_FROM is missing or invalid.".to_string());
    }
    Ok(Config {
        host: host.to_string(),
        port,
        username: username.to_string(),
        password: password.to_string(),
        from: from.to_string(),
    })
}

/// Collapse an SMTP failure into one bounded, control-free line for D1/UI.
/// Passwords never enter these strings (the driver never includes them).
pub fn error_line(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        let c = if ch == '\r' || ch == '\n' { ' ' } else { ch };
        if out.chars().count() >= max_chars {
            break;
        }
        out.push(c);
    }
    out
}

/// RFC 5322 date-time from unix epoch milliseconds, UTC ("+0000").
pub fn format_date_ms(ms: i64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let wd = (days + 4).rem_euclid(7) as usize; // 1970-01-01 was a Thursday
    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} +0000",
        DAYS[wd],
        d,
        MONTHS[(m - 1) as usize],
        y,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// Days-since-epoch to civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, usize, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m as usize, d)
}

/// RFC 2047 base64-encoded UTF-8 header word, folded under the 76-column
/// limit. ASCII text passes through untouched.
pub fn encode_header_word(text: &str) -> String {
    if text.is_ascii() {
        return text.to_string();
    }
    let mut out = String::new();
    let mut cur = String::new();
    let mut cur_bytes = 0usize;
    for ch in text.chars() {
        if cur_bytes + ch.len_utf8() > 30 {
            push_encoded_word(&mut out, &cur);
            cur.clear();
            cur_bytes = 0;
        }
        cur.push(ch);
        cur_bytes += ch.len_utf8();
    }
    push_encoded_word(&mut out, &cur);
    out
}

fn push_encoded_word(out: &mut String, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push_str("\r\n ");
    }
    out.push_str(&format!("=?UTF-8?B?{}?=", STANDARD.encode(chunk)));
}

/// Dot-stuff the body (RFC 5321 §4.5.2): leading "." gains one ".".
fn dot_stuff(body_crlf: &str) -> String {
    let mut out = String::new();
    for line in body_crlf.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.starts_with('.') {
            out.push('.');
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out
}

/// Build the DATA payload: headers, blank line, dot-stuffed body. Ends with
/// CRLF; the driver appends the terminating "." line. Header injection
/// (CR/LF in addresses, subject, date, message id) fails closed.
pub fn compose_message(
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    date_rfc5322: &str,
    message_id: &str,
) -> Result<String, String> {
    for (label, v) in [
        ("From", from),
        ("To", to),
        ("Subject", subject),
        ("Date", date_rfc5322),
        ("Message-ID", message_id),
    ] {
        if v.contains('\r') || v.contains('\n') {
            return Err(format!("Invalid {label} header."));
        }
    }
    if !crate::profile::valid_email(from) {
        return Err("Invalid envelope sender.".to_string());
    }
    if !crate::profile::valid_email(to) {
        return Err("Invalid envelope recipient.".to_string());
    }
    let subject = subject.trim();
    if subject.is_empty() {
        return Err("Empty subject.".to_string());
    }
    let body_crlf = body.replace("\r\n", "\n").replace('\r', "\n");
    Ok(format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {}\r\nDate: {date_rfc5322}\r\nMessage-ID: <{message_id}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{}",
        encode_header_word(subject),
        dot_stuff(&body_crlf)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiline_and_final_replies() {
        let mut buf = String::from("250-mail.awscommunity.id\r\n250-PIPELINING\r\n250 SMTPUTF8\r\n");
        let r = take_reply(&mut buf).expect("complete reply");
        assert_eq!(r.code, 250);
        assert_eq!(r.lines.len(), 3);
        assert_eq!(r.lines[0], "mail.awscommunity.id");
        assert!(buf.is_empty());
    }

    #[test]
    fn incomplete_reply_leaves_buffer_untouched() {
        let mut buf = String::from("250-PIPELINING\r\n250");
        assert_eq!(take_reply(&mut buf), None);
        assert_eq!(buf, "250-PIPELINING\r\n250");
    }

    #[test]
    fn skips_banner_garbage_but_keeps_bytes_after_reply() {
        let mut buf = String::from("*** hello\r\n220 mx.test ESMTP\r\nEXTRA\r\n");
        let r = take_reply(&mut buf).expect("reply after garbage");
        assert_eq!(r.code, 220);
        assert_eq!(r.text(), "mx.test ESMTP");
        assert_eq!(buf, "EXTRA\r\n");
    }

    #[test]
    fn capability_detection() {
        let r = take_reply(&mut String::from(
            "250-mx.test\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN CRAM-MD5\r\n250 AUTH=PLAIN\r\n",
        ))
        .unwrap();
        let caps = capabilities(&r);
        assert!(supports_starttls(&caps));
        assert_eq!(pick_auth(&caps), Some("PLAIN"));
        let caps2 = capabilities(&take_reply(&mut String::from("250-a\r\n250 AUTH LOGIN\r\n")).unwrap());
        assert_eq!(pick_auth(&caps2), Some("LOGIN"));
        let caps3 = capabilities(&take_reply(&mut String::from("250-a\r\n250 AUTH CRAM-MD5\r\n")).unwrap());
        assert_eq!(pick_auth(&caps3), None);
        assert!(!supports_starttls(&caps3));
    }

    #[test]
    fn auth_payloads() {
        assert_eq!(auth_plain("a", "b"), "AGEAYg==");
    }

    #[test]
    fn date_formatting_known_epochs() {
        assert_eq!(format_date_ms(0), "Thu, 01 Jan 1970 00:00:00 +0000");
        assert_eq!(format_date_ms(1000), "Thu, 01 Jan 1970 00:00:01 +0000");
        // 2024-02-29 (leap day) was a Thursday.
        assert_eq!(
            format_date_ms(1_709_164_800_000),
            "Thu, 29 Feb 2024 00:00:00 +0000"
        );
        // 2026-11-09 was a Monday.
        assert_eq!(
            format_date_ms(1_794_182_400_000),
            "Mon, 09 Nov 2026 00:00:00 +0000"
        );
    }

    #[test]
    fn message_composition_and_injection_guard() {
        let m = compose_message(
            "noreply@awscommunity.id",
            "guest@example.test",
            "Join Org",
            "Line one.\nLine two.\n.leading dot\n",
            "Thu, 01 Jan 1970 00:00:00 +0000",
            "inv-abc@awscommunity.id",
        )
        .unwrap();
        assert!(m.starts_with("From: noreply@awscommunity.id\r\nTo: guest@example.test\r\nSubject: Join Org\r\n"));
        assert!(m.contains("Message-ID: <inv-abc@awscommunity.id>"));
        assert!(m.contains("\r\n\r\nLine one.\r\nLine two.\r\n..leading dot\r\n"));
        // UTF-8 subject folds into encoded words.
        let m2 = compose_message(
            "noreply@awscommunity.id",
            "guest@example.test",
            "Undangan — Organisasi é",
            "body\n",
            "d",
            "x@y",
        )
        .unwrap();
        assert!(m2.contains("=?UTF-8?B?"));
        // Header injection fails closed.
        assert!(compose_message(
            "noreply@awscommunity.id\r\nBCC: victim@x.test",
            "guest@example.test",
            "s",
            "b",
            "d",
            "x@y"
        )
        .is_err());
        assert!(compose_message(
            "noreply@awscommunity.id",
            "guest@example.test",
            "s\r\nX-Evil: 1",
            "b",
            "d",
            "x@y"
        )
        .is_err());
        assert!(compose_message(
            "not-an-email",
            "guest@example.test",
            "s",
            "b",
            "d",
            "x@y"
        )
        .is_err());
    }

    #[test]
    fn config_validation() {
        let c = build_config("mail.awscommunity.id", "587", "noreply@awscommunity.id", "pw", "noreply@awscommunity.id").unwrap();
        assert_eq!(c.port, 587);
        assert_eq!(c.host, "mail.awscommunity.id");
        assert!(build_config("", "587", "u", "p", "noreply@awscommunity.id").is_err());
        assert!(build_config("mail.awscommunity.id", "0", "u", "p", "noreply@awscommunity.id").is_err());
        assert!(build_config("mail.awscommunity.id", "abc", "u", "p", "noreply@awscommunity.id").is_err());
        assert!(build_config("mail.awscommunity.id", "587", "", "p", "noreply@awscommunity.id").is_err());
        assert!(build_config("mail.awscommunity.id", "587", "u", "", "noreply@awscommunity.id").is_err());
        assert!(build_config("mail.awscommunity.id", "587", "u", "p", "bad@@").is_err());
        assert_eq!(ehlo_domain("noreply@awscommunity.id").as_deref(), Some("awscommunity.id"));
        assert_eq!(mail_from("a@b.c"), "MAIL FROM:<a@b.c>");
        assert_eq!(rcpt_to("d@e.f"), "RCPT TO:<d@e.f>");
    }

    #[test]
    fn error_lines_are_single_line_and_bounded() {
        assert_eq!(error_line("bad\r\nthing\r\n", 200), "bad  thing  ");
        let long = error_line(&"x".repeat(500), 64);
        assert_eq!(long.chars().count(), 64);
    }
}

// ------------------------------------------------------- session flow seam
//
// The SMTP session grammar runs against a minimal I/O seam so it can be
// tested natively: production implements the trait over `worker::Socket`
// (bounded reads/writes, platform STARTTLS), tests script a fake. No
// redesign — same five operations the socket driver already performed.

use std::future::Future;

/// I/O seam for one SMTP session. Implementations must bound their own
/// operations; `quit_and_close` is best-effort cleanup whose errors are
/// swallowed (a delivered message's final 250 is never undone by cleanup).
pub trait SessionFlow {
    fn opened(&mut self) -> impl Future<Output = Result<(), String>>;
    fn read_reply(&mut self) -> impl Future<Output = Result<Reply, String>>;
    fn send_raw(&mut self, data: &str) -> impl Future<Output = Result<(), String>>;
    /// Platform TLS upgrade after a 220 STARTTLS reply. No downgrade path.
    fn upgrade(&mut self);
    fn quit_and_close(&mut self) -> impl Future<Output = ()>;
}

/// Write one command line (CRLF appended).
pub async fn send_line<S: SessionFlow>(io: &mut S, line: &str) -> Result<(), String> {
    io.send_raw(&format!("{line}\r\n")).await
}

/// Read one reply and require an exact code. Errors carry the fixed stage
/// name plus status code only — never server reply text (which could echo
/// credentials or session content into D1 or redirects).
pub async fn expect<S: SessionFlow>(io: &mut S, want: u16, what: &str) -> Result<Reply, String> {
    let r = io.read_reply().await?;
    if r.code != want {
        return Err(format!("{what}: unexpected SMTP reply {}", r.code));
    }
    Ok(r)
}

/// EHLO and collect the advertised capabilities.
pub async fn ehlo<S: SessionFlow>(io: &mut S, domain: &str) -> Result<Vec<String>, String> {
    send_line(io, &format!("EHLO {domain}")).await?;
    let r = expect(io, 250, "EHLO").await?;
    Ok(capabilities(&r))
}

/// Full session: greeting, EHLO, mandatory STARTTLS (except implicit TLS on
/// 465, where the caller connects with TLS from the first byte), AUTH when
/// credentials are configured, envelope, DATA. Any unexpected reply aborts
/// with a password-free error; cleanup runs on every exit and never flips a
/// delivered message into a failure.
pub async fn send_message<S: SessionFlow>(
    io: &mut S,
    cfg: &Config,
    to: &str,
    org_name: &str,
    token_hash: &str,
    body_text: &str,
    date_rfc5322: &str,
) -> Result<(), String> {
    let outcome: Result<(), String> = async {
        io.opened()
            .await
            .map_err(|e| format!("SMTP connection failed: {e}"))?;
        expect(io, 220, "greeting").await?;
        let domain =
            ehlo_domain(&cfg.from).ok_or_else(|| "SMTP_FROM has no domain.".to_string())?;
        if cfg.port != 465 {
            let caps = ehlo(io, &domain).await?;
            if !supports_starttls(&caps) {
                return Err(
                    "SMTP server does not advertise STARTTLS; refusing to send in plaintext."
                        .to_string(),
                );
            }
            send_line(io, "STARTTLS").await?;
            expect(io, 220, "STARTTLS").await?;
            io.upgrade();
        }
        let caps = ehlo(io, &domain).await?;
        if !cfg.password.is_empty() {
            let mech = pick_auth(&caps)
                .ok_or_else(|| "SMTP server offers no supported AUTH mechanism.".to_string())?;
            if mech == "PLAIN" {
                send_line(io, &format!("AUTH PLAIN {}", auth_plain(&cfg.username, &cfg.password)))
                    .await?;
                expect(io, 235, "AUTH").await?;
            } else {
                // AUTH LOGIN is a fixed sequential challenge: first 334 wants
                // the username, second the password (RFC 4954). Server prompt
                // wording varies ("Username:", Exchange "User Name", empty)
                // and is deliberately not inspected.
                send_line(io, "AUTH LOGIN").await?;
                expect(io, 334, "AUTH LOGIN username").await?;
                send_line(io, &STANDARD.encode(&cfg.username)).await?;
                expect(io, 334, "AUTH LOGIN password").await?;
                send_line(io, &STANDARD.encode(&cfg.password)).await?;
                expect(io, 235, "AUTH").await?;
            }
        }
        send_line(io, &mail_from(&cfg.from)).await?;
        expect(io, 250, "MAIL FROM").await?;
        send_line(io, &rcpt_to(to)).await?;
        expect(io, 250, "RCPT TO").await?;
        send_line(io, "DATA").await?;
        expect(io, 354, "DATA").await?;
        let message_id = format!("inv-{}@{domain}", &token_hash[..12]);
        let subject = format!("Join {org_name} on PocketTrail");
        let payload = compose_message(
            &cfg.from,
            to,
            &subject,
            body_text,
            date_rfc5322,
            &message_id,
        )?;
        io.send_raw(&payload).await?;
        send_line(io, ".").await?;
        // Final 250: the message is accepted. Everything after this point is
        // best-effort cleanup and cannot turn delivery into failure.
        expect(io, 250, "message accepted").await?;
        Ok(())
    }
    .await;
    io.quit_and_close().await;
    outcome
}

#[cfg(test)]
mod session_tests {
    use super::*;

    /// Minimal executor: every FakeIo future completes on its first poll,
    /// so a noop-waker spin suffices for these scripted sessions.
    fn block_on<F: Future>(fut: F) -> F::Output {
        use std::task::{Context, Poll};
        let mut cx = Context::from_waker(std::task::Waker::noop());
        let mut fut = std::pin::pin!(fut);
        loop {
            match fut.as_mut().poll(&mut cx) {
                Poll::Ready(v) => return v,
                Poll::Pending => std::thread::yield_now(),
            }
        }
    }

    /// Scripted transport for the session grammar: pops canned replies,
    /// records everything written, flags upgrade/close.
    struct FakeIo {
        replies: Vec<String>,
        writes: Vec<String>,
        upgraded: bool,
        closed: bool,
        zero_writes: bool,
    }

    impl FakeIo {
        fn new(replies: &[&str]) -> Self {
            FakeIo {
                replies: replies.iter().map(|s| s.to_string()).collect(),
                writes: Vec::new(),
                upgraded: false,
                closed: false,
                zero_writes: false,
            }
        }
    }

    impl SessionFlow for FakeIo {
        async fn opened(&mut self) -> Result<(), String> {
            Ok(())
        }

        async fn read_reply(&mut self) -> Result<Reply, String> {
            if self.replies.is_empty() {
                return Err("fixture exhausted".to_string());
            }
            let mut raw = self.replies.remove(0);
            take_reply(&mut raw).ok_or_else(|| "bad fixture reply".to_string())
        }

        async fn send_raw(&mut self, data: &str) -> Result<(), String> {
            if self.zero_writes {
                return Err("SMTP I/O failed: write made no progress".to_string());
            }
            self.writes.push(data.to_string());
            Ok(())
        }

        fn upgrade(&mut self) {
            self.upgraded = true;
        }

        async fn quit_and_close(&mut self) {
            self.closed = true;
        }
    }

    fn cfg(port: u16, auth: &str) -> Config {
        Config {
            host: "mail.awscommunity.id".into(),
            port,
            username: "noreply@awscommunity.id".into(),
            password: if auth.is_empty() { String::new() } else { "pw".into() },
            from: "noreply@awscommunity.id".into(),
        }
    }

    fn args<'a>(to: &'a str) -> (&'a str, &'a str, &'a str, &'a str, &'a str) {
        (
            to,
            "Org",
            "abcdef1234567890abcdef1234567890",
            "Line one.\n.leading dot\n",
            "Thu, 01 Jan 1970 00:00:00 +0000",
        )
    }

    const EHLO_TLS_LOGIN: &str = "250-mx\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n";
    const EHLO_PLAIN: &str = "250-mx\r\n250 AUTH PLAIN\r\n";

    #[test]
    fn starttls_then_auth_login_happy_path() {
        let mut io = FakeIo::new(&[
            "220 mx ESMTP\r\n",
            EHLO_TLS_LOGIN,
            "220 Going ahead\r\n",
            "250-mx\r\n250 AUTH LOGIN\r\n",
            "334 VXNlcm5hbWU6\r\n", // real "Username:" challenge
            "334 UGFzc3dvcmQ6\r\n",
            "235 ok\r\n",
            "250 ok\r\n",
            "250 ok\r\n",
            "354 go\r\n",
            "250 queued\r\n",
        ]);
        let (to, org, hash, body, date) = args("guest@example.test");
        let r = block_on(send_message(
            &mut io,
            &cfg(587, "pw"),
            to,
            org,
            hash,
            body,
            date,
        ));
        assert!(r.is_ok(), "{r:?}");
        assert!(io.upgraded, "STARTTLS upgrade must happen");
        assert!(io.writes.iter().any(|w| w == "AUTH LOGIN\r\n"));
        assert!(io.writes.iter().any(|w| *w == STANDARD.encode("noreply@awscommunity.id") + "\r\n"));
        assert!(io.writes.iter().any(|w| *w == STANDARD.encode("pw") + "\r\n"));
        assert!(io.writes.iter().any(|w| w == "MAIL FROM:<noreply@awscommunity.id>\r\n"));
        assert!(io.writes.iter().any(|w| w == "RCPT TO:<guest@example.test>\r\n"));
        assert!(io.writes.iter().any(|w| w == "DATA\r\n"));
        assert!(io.writes.iter().any(|w| w.contains("Subject: Join Org") && w.contains("..leading dot\r\n")));
        assert!(io.writes.iter().any(|w| w == ".\r\n"));
        assert!(io.closed, "cleanup must run on success");
    }

    #[test]
    fn implicit_tls_plain_auth_happy_path() {
        let mut io = FakeIo::new(&[
            "220 mx ESMTP\r\n",
            EHLO_PLAIN,
            "235 ok\r\n",
            "250 ok\r\n",
            "250 ok\r\n",
            "354 go\r\n",
            "250 queued\r\n",
        ]);
        let (to, org, hash, body, date) = args("guest@example.test");
        let r = block_on(send_message(&mut io, &cfg(465, "pw"), to, org, hash, body, date));
        assert!(r.is_ok(), "{r:?}");
        assert!(!io.upgraded, "465 is implicit TLS; no STARTTLS");
        assert!(io
            .writes
            .iter()
            .any(|w| *w == format!("AUTH PLAIN {}\r\n", auth_plain(&cfg(465, "pw").username, "pw"))));
    }

    #[test]
    fn missing_starttls_refuses_plaintext() {
        let mut io = FakeIo::new(&["220 mx\r\n", "250-mx\r\n250 AUTH PLAIN\r\n"]);
        let (to, org, hash, body, date) = args("guest@example.test");
        let r = block_on(send_message(&mut io, &cfg(587, "pw"), to, org, hash, body, date));
        assert_eq!(
            r,
            Err("SMTP server does not advertise STARTTLS; refusing to send in plaintext.".to_string())
        );
        assert!(!io.writes.iter().any(|w| w.starts_with("MAIL FROM")));
        assert!(io.closed, "cleanup must run on error");
    }

    #[test]
    fn auth_failure_aborts_without_echoing_server_text() {
        let mut io = FakeIo::new(&[
            "220 mx\r\n",
            EHLO_TLS_LOGIN,
            "220 ok\r\n",
            "250-mx\r\n250 AUTH PLAIN\r\n",
            "535 5.7.8 BAD CREDENTIALS noreply@awscommunity.id pw\r\n", // hostile echo attempt
        ]);
        let (to, org, hash, body, date) = args("guest@example.test");
        let r = block_on(send_message(&mut io, &cfg(587, "pw"), to, org, hash, body, date));
        assert_eq!(r, Err("AUTH: unexpected SMTP reply 535".to_string()));
        assert!(io.closed);
    }

    #[test]
    fn zero_write_aborts_instead_of_spinning() {
        let mut io = FakeIo::new(&["220 mx\r\n"]);
        io.zero_writes = true;
        let (to, org, hash, body, date) = args("guest@example.test");
        let r = block_on(send_message(&mut io, &cfg(587, "pw"), to, org, hash, body, date));
        assert!(r.unwrap_err().contains("write made no progress"));
        assert!(io.closed);
    }

}
