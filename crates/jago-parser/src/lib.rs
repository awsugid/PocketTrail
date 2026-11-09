//! Parser for `pdftotext -layout` output of Jago "Pockets Transactions History"
//! PDF statements.
//!
//! Layout assumptions, observed across cumulative community statement exports:
//!
//! - A row starts with `DD Mon YYYY` followed by two or more spaces; `HH:MM`
//!   sits on the next line, first column.
//! - Signed amount and running balance are right-aligned trailing tokens on
//!   the row's date line, in Indonesian format: `.` thousands separator,
//!   optional `,dd` decimals, explicit `+`/`-` sign. IDR minor unit is
//!   1/100 rupiah, so amounts are emitted as minor units.
//! - The Jago transaction ID appears as `ID# <token>` in the row and is kept
//!   verbatim. IDs may be digit strings (with leading zeros), hyphenated
//!   alphanumerics (`260101-AA00-BB1234`), or long underscore strings
//!   (`STPK20260101..._260101120000_003583679232`); they are never parsed
//!   as numbers.
//! - Column boundaries (Source/Destination, Transaction Details, Notes) are
//!   derived per page from the repeated `Date & Time ...` header line, which
//!   also skips page headers and footers between pages.
//! - Counterparty is the full Source/Destination column text, segments joined
//!   with ` / ` (bank account lines included), minus segments equal to the
//!   transaction type. Downstream actor mappings key on this exact string.
//!
//! Rows are never dropped silently: a row missing amount or balance is skipped
//! with a warning, a row missing its ID is kept with a warning, and a
//! consecutive-row balance chain mismatch (previous balance + amount must
//! equal the new balance, across page breaks) produces a warning. Warnings
//! carry line numbers and row ordinals only, never statement content, so the
//! serialized output is safe to display.
//!
//! # Input contract (line grammar)
//!
//! One physical line at a time, columns separated by **two or more spaces**
//! (a single space stays inside a column segment). The exact patterns:
//!
//! - Row start: `^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)
//!   \s+(\d{4})(?:\s{2,}(.*))?$` — the period line `19 Dec 2025 - 09 Aug 2026`
//!   (single space before the dash) never matches.
//! - Time: `^([01]\d|2[0-3]):[0-5]\d$`, in the date column (or anywhere when
//!   no column header is available).
//! - ID: any segment starting with `ID#`, value is the rest of the segment
//!   (an ID never contains two consecutive spaces).
//! - Transaction type: exact match against [`TRANSACTION_TYPES`] in the
//!   Transaction Details column (or anywhere when no header is available).
//! - Amount/balance: the last two segments of the row-start line, each
//!   `[+-]?\d{1,3}(\.\d{3})*(,\d{2})?` — Indonesian `.` thousands, optional
//!   `,dd` decimals, explicit `+`/`-` sign.
//! - Columns come from the header line containing `Date & Time`,
//!   `Source/Destination`, `Transaction Details`, `Notes` in order; offsets
//!   are re-read for every page. Without a header (e.g. line-reconstructed
//!   pdf.js output), pattern matches above still run and the first unmatched
//!   date-line segment is taken as the counterparty, with a warning.
//! - Skipped lines: the page banner containing `Pockets Transactions
//!   History`, the footer (`PT Bank Jago Tbk …`, `also a member of …`,
//!   `www.jago.com`), the `Disclaimer` block, `Showing IDR transaction …`,
//!   `Latest Balance per …`, the `DD Mon YYYY - …` period line, standalone
//!   `Page N of N` lines, month headers `^[A-Z][a-z]+ \d{4}$`, and the
//!   pre-first-row holder/account prelude (`^[A-Z][A-Z ']+$` or
//!   `<text> \d{5,}$`). Recognition of all skipped lines collapses whitespace
//!   runs first (`Pockets  Transactions  History` still matches); transaction
//!   text itself is never normalized. Anything else outside a row is warned
//!   as an unrecognized line and closes the current row.

use std::fmt;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Transaction type labels seen in the Transaction Details column.
pub const TRANSACTION_TYPES: [&str; 5] = [
    "Incoming Transfer",
    "Outgoing Transfer",
    "Pocket Money In",
    "Pocket Money Out",
    "Movement between Pockets",
];

/// IDR minor units: 100 minor per rupiah.
pub const IDR_MINOR_PER_RUPIAH: i64 = 100;

/// Read-only title/subtitle projection. Original counterparty remains the bank fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CounterpartyDisplay<'a> {
    pub name: &'a str,
    pub bank_account: Option<&'a str>,
}

/// Split only the observed Jago account suffix; unknown formats stay intact.
/// Never use this projection for actor mapping, import comparison, or deduplication.
pub fn counterparty_display(counterparty: &str) -> CounterpartyDisplay<'_> {
    let split = counterparty.rsplit_once(" / ").filter(|(name, suffix)| {
        !name.trim().is_empty()
            && suffix.strip_prefix("Jago ").is_some_and(|account| {
                !account.is_empty() && account.bytes().all(|byte| byte.is_ascii_digit())
            })
    });
    match split {
        Some((name, bank_account)) => CounterpartyDisplay {
            name,
            bank_account: Some(bank_account),
        },
        None => CounterpartyDisplay {
            name: counterparty,
            bank_account: None,
        },
    }
}

/// One parsed bank movement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTransaction {
    /// Verbatim Jago transaction ID (after `ID# `). Empty when the statement
    /// row had no ID, which also adds a warning to [`ParsedStatement::warnings`].
    pub bank_id: String,
    /// ISO `YYYY-MM-DD`.
    pub date: String,
    /// `HH:MM`, when present.
    pub time: Option<String>,
    /// Full Source/Destination column text, ` / `-joined.
    pub counterparty: String,
    /// Transaction Details label, one of [`TRANSACTION_TYPES`] when recognized.
    pub transaction_type: String,
    /// Notes column text, whitespace-joined across wrapped lines.
    pub notes: String,
    /// Signed amount in IDR minor units (100 per rupiah).
    pub amount_minor: i64,
    /// Running balance in IDR minor units.
    pub balance_minor: i64,
}

/// Parse result with non-fatal review notes.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ParsedStatement {
    pub transactions: Vec<ParsedTransaction>,
    /// Neutral review notes (line numbers and row ordinals only, no statement
    /// content): missing IDs, skipped incomplete rows, balance chain breaks,
    /// unrecognized lines.
    pub warnings: Vec<String>,
}

/// Input that is not recognizable as Jago statement text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parse the `-layout` text extraction of one Jago statement PDF.
pub fn parse_statement(text: &str) -> Result<ParsedStatement, ParseError> {
    let mut p = Parser::default();
    for (idx, line) in text.lines().enumerate() {
        p.line(idx + 1, line);
    }
    p.finish()
}

#[derive(Debug, Clone, Copy)]
struct Columns {
    source: usize,
    details: usize,
    notes: usize,
}

impl Columns {
    /// Column starts come from the ORIGINAL line so downstream segment
    /// offsets stay exact; the label words themselves are matched
    /// whitespace-flexibly for browser-extracted headers.
    fn from_header(line: &str) -> Option<Columns> {
        let source = H_SOURCE.find(line)?.start();
        let details = H_DETAILS.find(line)?.start();
        let notes = H_NOTES.find(line)?.start();
        if H_DATE.find(line)?.start() < source && source < details && details < notes {
            Some(Columns {
                source,
                details,
                notes,
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Default)]
struct Block {
    lineno: usize,
    date: String,
    time: Option<String>,
    id: Option<String>,
    transaction_type: Option<String>,
    counterparty: Vec<String>,
    notes: Vec<String>,
    amount_minor: Option<i64>,
    balance_minor: Option<i64>,
    /// Fallback mode: no column header was seen, so the first unmatched
    /// segment of the date line is taken as the counterparty.
    no_columns: bool,
    /// Fallback flag: the date-line counterparty slot is taken.
    counterparty_added_fallback: bool,
}

#[derive(Debug, Default)]
struct Parser {
    columns: Option<Columns>,
    current: Option<Block>,
    transactions: Vec<ParsedTransaction>,
    warnings: Vec<String>,
    /// Balance of the last emitted transaction, for chain checking.
    prev_balance: Option<i64>,
    /// Set when a row was skipped, so the next chain mismatch is suppressed
    /// once (the skipped row's amount is unknown).
    chain_suppressed: bool,
    rows_seen: usize,
    started: bool,
}

impl Parser {
    fn warn(&mut self, msg: String) {
        self.warnings.push(msg);
    }

    fn line(&mut self, lineno: usize, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        if let Some(cols) = Columns::from_header(line) {
            self.columns = Some(cols);
            return;
        }
        if is_artifact(line) || is_month_header(line) {
            return;
        }
        if let Some(rest) = row_start(line) {
            self.finish_block();
            let Some(date) = rest.date else {
                // Date token with an impossible day; skip the row. Continuation
                // lines then warn as unrecognized instead of mis-attaching.
                self.warn(format!(
                    "line {lineno}: invalid transaction date; row skipped"
                ));
                self.current = None;
                return;
            };
            let no_columns = self.columns.is_none();
            if no_columns {
                self.warn(format!(
                    "line {lineno}: column header not seen yet; column classification degraded"
                ));
            }
            self.rows_seen += 1;
            let mut block = Block {
                lineno,
                date,
                no_columns,
                ..Block::default()
            };
            // Amount and balance are the trailing numeric segments of the date
            // line; remove them so they are not classified as notes.
            let mut end = line.len();
            let segs = segments_from(line, rest.offset);
            if segs.len() >= 2 {
                let bal = segs[segs.len() - 1];
                let amt = segs[segs.len() - 2];
                if let (Some(a), Some(b)) = (parse_idr_minor(amt.1), parse_idr_minor(bal.1)) {
                    block.amount_minor = Some(a);
                    block.balance_minor = Some(b);
                    end = amt.0;
                }
            }
            let columns = self.columns;
            let ended = block_line(&mut block, columns, &line[..end], rest.offset);
            self.current = Some(block);
            if ended {
                self.finish_block();
            }
            return;
        }
        if self.current.is_some() {
            let columns = self.columns;
            let mut block = self.current.take().unwrap();
            let ended = block_line(&mut block, columns, line, 0);
            if ended {
                self.warn(format!("line {lineno}: unrecognized line ignored"));
            }
            self.current = Some(block);
            if ended {
                self.finish_block();
            }
            return;
        }
        if !self.started && is_prelude(line) {
            return;
        }
        self.warn(format!("line {lineno}: unrecognized line ignored"));
    }

    fn finish_block(&mut self) {
        let Some(mut block) = self.current.take() else {
            return;
        };
        let ordinal = self.rows_seen;
        let at = |msg: &str| format!("row {ordinal} (line {}): {msg}", block.lineno);

        let (Some(amount), Some(balance)) = (block.amount_minor, block.balance_minor) else {
            self.warn(at("missing amount or balance; row skipped"));
            self.chain_suppressed = true;
            return;
        };

        let chain_ok = self.chain_suppressed
            || self
                .prev_balance
                .map(|prev| prev.checked_add(amount) == Some(balance))
                .unwrap_or(true);
        if !chain_ok {
            self.warn(at("balance chain mismatch with previous row"));
        }
        self.chain_suppressed = false;

        if block.id.is_none() {
            self.warn(at("missing Jago transaction ID"));
        }
        if block.transaction_type.is_none() {
            self.warn(at("missing transaction type"));
        }
        if block.counterparty.is_empty() {
            self.warn(at("missing source/destination"));
        }

        // `Movement between Pockets` is transfer boilerplate repeated in the
        // Source/Destination column of every pocket row, never a real
        // counterparty label.
        block
            .counterparty
            .retain(|c| c != "Movement between Pockets");
        self.started = true;
        self.prev_balance = Some(balance);
        self.transactions.push(ParsedTransaction {
            bank_id: block.id.unwrap_or_default(),
            date: block.date,
            time: block.time,
            counterparty: block.counterparty.join(" / "),
            transaction_type: block.transaction_type.unwrap_or_default(),
            notes: block.notes.join(" "),
            amount_minor: amount,
            balance_minor: balance,
        });
    }

    fn finish(mut self) -> Result<ParsedStatement, ParseError> {
        self.finish_block();
        if self.columns.is_none() && self.transactions.is_empty() {
            return Err(ParseError {
                message: "no Jago statement column header found; input is not statement text"
                    .to_string(),
            });
        }
        if self.transactions.is_empty() {
            self.warn("statement contains no transaction rows".to_string());
        }
        Ok(ParsedStatement {
            transactions: self.transactions,
            warnings: self.warnings,
        })
    }
}

struct RowStart {
    date: Option<String>,
    /// Byte offset where the row content starts (after the date token).
    offset: usize,
}

/// Recognize a row-start line: `DD Mon YYYY` then two or more spaces (or EOL).
/// The statement period line `19 Dec 2025 - 09 Aug 2026` has a single space
/// before the dash and does not match.
fn row_start(line: &str) -> Option<RowStart> {
    let caps = ROW_START_RE.captures(line)?;
    let day: u32 = caps[1].parse().ok()?;
    let month = month_number(&caps[2])?;
    let year: i32 = caps[3].parse().ok()?;
    let date = if valid_date(year, month, day) {
        Some(format!("{year:04}-{month:02}-{day:02}"))
    } else {
        None
    };
    let offset = caps.get(4).map(|m| m.start()).unwrap_or(line.len());
    Some(RowStart { date, offset })
}

/// Real calendar validation (leap years included), unlike the bank's own
/// 1..31 day range.
fn valid_date(year: i32, month: u32, day: u32) -> bool {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn month_number(m: &str) -> Option<u32> {
    Some(match m {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    })
}

/// Page furniture and document prelude lines that never belong to a row.
/// Recognition only: whitespace runs are collapsed first, because browser
/// PDF extractors emit furniture like `Pockets  Transactions  History` with
/// arbitrary inner spacing. Transaction text is never normalized.
fn is_artifact(line: &str) -> bool {
    let t = collapse_ws(line);
    t.contains("Pockets Transactions History")
        || t.starts_with("PT Bank Jago Tbk")
        || t.starts_with("also a member of")
        || t.starts_with("www.jago.com")
        || t == "Disclaimer"
        || t.starts_with("This document is your list")
        || t.starts_with("based on search result")
        || t.starts_with("Showing IDR transaction")
        || t.starts_with("Latest Balance per")
        || PAGE_NUMBER_RE.is_match(&t)
        || DATE_RANGE_RE.is_match(&t)
}

/// Collapse whitespace runs to single spaces (recognition only).
fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if c.is_whitespace() {
            in_ws = true;
        } else {
            if in_ws && !out.is_empty() {
                out.push(' ');
            }
            in_ws = false;
            out.push(c);
        }
    }
    out
}

fn is_month_header(line: &str) -> bool {
    MONTH_HEADER_RE.is_match(&collapse_ws(line))
}

/// Document prelude before the first row: the account holder name and the
/// pocket account line.
fn is_prelude(line: &str) -> bool {
    let t = collapse_ws(line);
    ALL_CAPS_RE.is_match(&t) || ACCOUNT_LINE_RE.is_match(&t)
}

/// Split a line into text segments separated by two or more spaces, keeping
/// each segment's byte offset so it can be assigned to a column.
fn segments_from(line: &str, from: usize) -> Vec<(usize, &str)> {
    let b = line.as_bytes();
    let mut out = Vec::new();
    let mut i = from.min(b.len());
    while i < b.len() {
        while i < b.len() && b[i] == b' ' {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        let start = i;
        let mut j = i;
        let mut gap = 0usize;
        while j < b.len() {
            if b[j] == b' ' {
                gap += 1;
            } else {
                if gap >= 2 {
                    break;
                }
                gap = 0;
            }
            j += 1;
        }
        // `j - gap` is the segment end in both the gap-break and EOL cases.
        out.push((start, &line[start..j - gap]));
        i = j;
    }
    out
}

/// Parse an Indonesian-formatted IDR amount (`+1.234.567,89`, `-624`,
/// `1.234.567,00`) into minor units. The sign is optional and defaults to
/// positive; balance chain checking catches sign-less negatives.
pub fn parse_idr_minor(token: &str) -> Option<i64> {
    let t = token.trim();
    let (sign, body) = match t.as_bytes().first() {
        Some(b'+') => (1i64, &t[1..]),
        Some(b'-') => (-1i64, &t[1..]),
        _ => (1i64, t),
    };
    let (int_part, frac) = match body.split_once(',') {
        Some((i, f)) => {
            if f.is_empty() || f.len() > 2 || !f.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let mut v: i64 = f.parse().ok()?;
            if f.len() == 1 {
                v *= 10;
            }
            (i, v)
        }
        None => (body, 0),
    };
    if int_part.is_empty() {
        return None;
    }
    let digits: String = int_part.chars().filter(|c| *c != '.').collect();
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let rupiah: i64 = digits.parse().ok()?;
    sign.checked_mul(
        rupiah
            .checked_mul(IDR_MINOR_PER_RUPIAH)?
            .checked_add(frac)?,
    )
}

/// Classify one physical line belonging to the row currently being built.
/// `from` is the byte offset where content starts (after the date token on
/// the date line, 0 on continuation lines). Returns true when the line holds
/// content in the date column that is not a time, which ends the row.
fn block_line(block: &mut Block, columns: Option<Columns>, line: &str, from: usize) -> bool {
    #[derive(Clone, Copy, PartialEq)]
    enum Col {
        DateColumn,
        Source,
        Details,
        Notes,
        Unknown,
    }

    let mut pending_id = false;
    for (off, seg) in segments_from(line, from) {
        let class = match columns {
            Some(c) if off >= c.notes => Col::Notes,
            Some(c) if off >= c.details => Col::Details,
            Some(c) if off >= c.source => Col::Source,
            Some(_) => Col::DateColumn,
            None => Col::Unknown,
        };
        if pending_id {
            block.id = Some(seg.to_string());
            pending_id = false;
            continue;
        }
        if let Some(rest) = seg.strip_prefix("ID#") {
            let id = rest.trim();
            if id.is_empty() {
                // Defensive: `ID#` split from its value by a column gap.
                pending_id = true;
            } else {
                block.id = Some(id.to_string());
            }
            continue;
        }
        // Time and type are pattern-matched only in their own columns so a
        // note like "12:34" or "Outgoing Transfer" is not swallowed.
        if TIME_RE.is_match(seg) && matches!(class, Col::DateColumn | Col::Unknown) {
            if block.time.is_none() {
                block.time = Some(seg.to_string());
            }
            continue;
        }
        if TRANSACTION_TYPES.contains(&seg) && matches!(class, Col::Details | Col::Unknown) {
            if block.transaction_type.is_none() {
                block.transaction_type = Some(seg.to_string());
            }
            continue;
        }
        match class {
            Col::Source => block.counterparty.push(seg.to_string()),
            Col::Notes | Col::Details => block.notes.push(seg.to_string()),
            Col::Unknown => {
                // No header positions available (e.g. line-reconstructed
                // text). Pattern matches above already captured time, ID and
                // type; the first unmatched segment of the date line is the
                // counterparty, everything unmatched on continuation lines is
                // notes.
                if block.no_columns && !block.counterparty_added_fallback {
                    block.counterparty.push(seg.to_string());
                    block.counterparty_added_fallback = true;
                } else {
                    block.notes.push(seg.to_string());
                }
            }
            Col::DateColumn => {
                // Continuation rows never carry date-column content except a
                // time, so treat this as the end of the row; the caller warns
                // about the stray line and closes the row.
                return true;
            }
        }
    }
    false
}

static ROW_START_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})(?:\s{2,}(.*))?$",
    )
    .unwrap()
});
static TIME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([01]\d|2[0-3]):[0-5]\d$").unwrap());
static MONTH_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z][a-z]+ \d{4}$").unwrap());
static DATE_RANGE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{2} [A-Z][a-z]{2} \d{4} - ").unwrap());
static ALL_CAPS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z][A-Z ']+$").unwrap());
static ACCOUNT_LINE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s\d{5,}$").unwrap());
static PAGE_NUMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^Page\s+\d+\s+of\s+\d+$").unwrap());
static H_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Date\s*&\s*Time").unwrap());
static H_SOURCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Source\s*/\s*Destination").unwrap());
static H_DETAILS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Transaction\s+Details").unwrap());
static H_NOTES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Notes").unwrap());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idr_minor_parsing() {
        assert_eq!(parse_idr_minor("+15.000.000"), Some(1_500_000_000));
        assert_eq!(parse_idr_minor("-624"), Some(-62_400));
        assert_eq!(parse_idr_minor("+10.783.024,00"), Some(1_078_302_400));
        assert_eq!(parse_idr_minor("2.345,00"), Some(234_500));
        assert_eq!(parse_idr_minor("1.234,5"), Some(123_450));
        assert_eq!(parse_idr_minor("0"), Some(0));
        // IDR minor is exactly 100 per rupiah.
        assert_eq!(parse_idr_minor("1"), Some(IDR_MINOR_PER_RUPIAH));
        assert_eq!(parse_idr_minor("1,234"), None);
        assert_eq!(parse_idr_minor("abc"), None);
        assert_eq!(parse_idr_minor(""), None);
        assert_eq!(parse_idr_minor("1.2.3.4"), Some(123_400));
    }

    #[test]
    fn row_start_vs_period_line() {
        let row = row_start("19 Dec 2025        AWS User Group        Incoming Transfer").unwrap();
        assert_eq!(row.date.as_deref(), Some("2025-12-19"));
        assert_eq!(row.offset, 19);
        // Period line: single space before the dash, never a row start.
        assert!(row_start("19 Dec 2025 - 09 Aug 2026   IDR 1.209.070").is_none());
        assert!(row_start("February 2026").is_none());
        assert!(row_start("Main Pocket").is_none());
    }

    #[test]
    fn calendar_true_dates() {
        assert_eq!(
            row_start("29 Feb 2024        ALICE")
                .unwrap()
                .date
                .as_deref(),
            Some("2024-02-29")
        ); // leap year
        assert!(
            row_start("29 Feb 2025        ALICE")
                .unwrap()
                .date
                .is_none()
        );
        assert!(
            row_start("31 Apr 2026        ALICE")
                .unwrap()
                .date
                .is_none()
        );
        assert!(
            row_start("30 Feb 2025        ALICE")
                .unwrap()
                .date
                .is_none()
        );
        assert_eq!(
            row_start("31 Dec 2025        ALICE")
                .unwrap()
                .date
                .as_deref(),
            Some("2025-12-31")
        );
    }

    #[test]
    fn segments_split_on_double_spaces() {
        let segs = segments_from(
            "08:31             Danamon 003583679232             ID# X1",
            0,
        );
        assert_eq!(
            segs.iter().map(|(o, s)| (*o, *s)).collect::<Vec<_>>(),
            [(0, "08:31"), (18, "Danamon 003583679232"), (51, "ID# X1")]
        );
    }
}
