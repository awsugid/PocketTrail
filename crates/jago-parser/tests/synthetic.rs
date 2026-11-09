//! Synthetic statement fixtures only. No real statement data appears here.
//! Column offsets mirror the observed `pdftotext -layout` geometry:
//! Source/Destination at col 20, Transaction Details at 55, Notes at 95.
use pockettrail_jago_parser::{ParsedStatement, parse_statement};

/// Column header line defining the page's column boundaries.
fn header() -> String {
    format!(
        "{:<19} {:<34} {:<39} {:<10} {:<20}{}",
        "Date & Time", "Source/Destination", "Transaction Details", "Notes", "Amount", "Balance"
    )
}

/// A row's date line. Empty `notes` is valid.
fn date_line(
    date: &str,
    source: &str,
    details: &str,
    notes: &str,
    amount: &str,
    balance: &str,
) -> String {
    format!(
        "{:<19} {:<34} {:<39} {:<10} {:<20}{}",
        date, source, details, notes, amount, balance
    )
}

/// A row's second line: time, optional source/destination continuation,
/// optional `ID# ...`. `id` may be empty.
fn time_line(time: &str, source: &str, id: &str) -> String {
    let id_part = if id.is_empty() {
        String::new()
    } else {
        format!("{:<40}{}", format!("ID# {id}"), "")
    };
    format!("{:<19} {:<34} {}", time, source, id_part.trim_end(),)
}

/// Notes continuation attached after the ID on the same line.
fn time_line_notes(time: &str, source: &str, id: &str, notes: &str) -> String {
    format!(
        "{:<19} {:<34} {:<40}{}",
        time,
        source,
        format!("ID# {id}"),
        notes
    )
}

fn page_banner(n: usize, of: usize) -> String {
    format!("{:>60}   Page {n} of {of}", "Pockets Transactions History")
}

/// Browser-style header: arbitrary spaces inside the label words, column
/// starts unchanged (Source at 20, Transaction at 55, Notes at 95).
fn header_spaced() -> String {
    format!(
        "{:<19} {:<34} {:<39} {:<10} {:<20}{}",
        "Date  &  Time",
        "Source/Destination",
        "Transaction   Details",
        "Notes",
        "Amount",
        "Balance"
    )
}

fn footer() -> String {
    [
        "PT Bank Jago Tbk is licensed and supervised by Financial Services Authority (OJK)",
        "also a member of Indonesia Deposit Insurance Corporation (LPS) deposit insurance program.",
        "www.jago.com",
    ]
    .join("\n")
}

fn doc(prelude: bool, pages: &[String]) -> String {
    let mut out = String::new();
    if prelude {
        out.push_str("MUHAMMAD EXAMPLE\n");
        out.push_str("Test Organization 123456789\n");
        out.push_str("Showing IDR transaction from    Latest Balance per 30 Jan 2026\n");
        out.push_str("19 Dec 2025 - 30 Jan 2026    IDR 9.000.000\n\n");
    }
    for (i, page) in pages.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(page);
    }
    out.push('\n');
    out
}

fn page1(rows: &str) -> String {
    format!(
        "{}\n\n{}\n\nJanuary 2026\n\n{}\n\n{}",
        page_banner(1, 2),
        header(),
        rows,
        footer()
    )
}

fn page2(rows: &str) -> String {
    format!(
        "{}\n\n{}\n\n{}\n\nDisclaimer\n{}",
        page_banner(2, 2),
        header(),
        rows,
        footer()
    )
}

#[test]
fn counterparty_display_separates_only_known_bank_account_suffix() {
    use pockettrail_jago_parser::counterparty_display;
    let raw = "ALICE / EXAMPLE 2 / Jago 000123456789";
    let display = counterparty_display(raw);
    assert_eq!(display.name, "ALICE / EXAMPLE 2");
    assert_eq!(display.bank_account, Some("Jago 000123456789"));
    for raw in [
        "ALICE / EXAMPLE 2",
        "SHOP / 123456",
        "ALICE / Other 123456",
        "ALICE / Jago Savings",
        "ALICE / Jago 123x",
        " / Jago 123456",
        "ALICE / Jago 123 / BRANCH",
    ] {
        let display = counterparty_display(raw);
        assert_eq!(display.name, raw);
        assert_eq!(display.bank_account, None);
    }
}

#[test]
fn single_row_full_fields() {
    let rows = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "Note one",
            "+1.000.000",
            "1.000.000",
        ),
        time_line_notes(
            "08:30",
            "Jago 123456789012",
            "2401011234567890",
            "Note cont",
        ),
    ]
    .join("\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    assert_eq!(parsed.transactions.len(), 1);
    let t = &parsed.transactions[0];
    assert_eq!(t.bank_id, "2401011234567890");
    assert_eq!(t.date, "2026-01-07");
    assert_eq!(t.time.as_deref(), Some("08:30"));
    assert_eq!(t.counterparty, "ALICE EXAMPLE / Jago 123456789012");
    let display = pockettrail_jago_parser::counterparty_display(&t.counterparty);
    assert_eq!(display.name, "ALICE EXAMPLE");
    assert_eq!(display.bank_account, Some("Jago 123456789012"));
    assert_eq!(t.bank_id, "2401011234567890");
    assert_eq!(t.transaction_type, "Incoming Transfer");
    assert_eq!(t.notes, "Note one Note cont");
    // IDR minor: 100 minor per rupiah.
    assert_eq!(t.amount_minor, 1_000_000 * 100);
    assert_eq!(t.balance_minor, 1_000_000 * 100);
}

#[test]
fn multipage_rows_chain_across_pages() {
    let rows1 = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
        String::new(),
        date_line(
            "08 Jan 2026",
            "Main Pocket",
            "Pocket Money Out",
            "",
            "-250.000",
            "750.000",
        ),
        time_line("09:15", "Movement between Pockets", "260101-AA00-BB1234"),
    ]
    .join("\n");
    let rows2 = [
        date_line(
            "09 Jan 2026",
            "CAROL SAMPLE",
            "Incoming Transfer",
            "",
            "+500.000",
            "1.250.000",
        ),
        time_line("19:00", "Jago 123456789012", "2401091234567890"),
    ]
    .join("\n");
    let text = doc(true, &[page1(&rows1), page2(&rows2)]);
    let parsed = parse_statement(&text).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    let dates: Vec<&str> = parsed
        .transactions
        .iter()
        .map(|t| t.date.as_str())
        .collect();
    assert_eq!(dates, ["2026-01-07", "2026-01-08", "2026-01-09"]);
    assert_eq!(parsed.transactions[2].balance_minor, 125_000_000);
}

#[test]
fn id_formats_preserved_verbatim() {
    let mk = |id: &str, amt: &str, bal: &str, day: &str| {
        [
            date_line(day, "ALICE EXAMPLE", "Incoming Transfer", "", amt, bal),
            time_line("10:00", "Jago 123456789012", id),
        ]
        .join("\n")
    };
    let rows = [
        mk("2401011234567890", "+1.000.000", "1.000.000", "01 Jan 2026"),
        mk("000000008597", "+500.000", "1.500.000", "02 Jan 2026"),
        mk("260103-AA00-BB1234", "+250.000", "1.750.000", "03 Jan 2026"),
        mk(
            "STPK20260101000000000000_260103120000_123456789012",
            "+250.000",
            "2.000.000",
            "04 Jan 2026",
        ),
    ]
    .join("\n\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    let ids: Vec<&str> = parsed
        .transactions
        .iter()
        .map(|t| t.bank_id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "2401011234567890",
            "000000008597",
            "260103-AA00-BB1234",
            "STPK20260101000000000000_260103120000_123456789012",
        ]
    );
}

#[test]
fn comma_decimals_to_minor() {
    let rows = [date_line(
        "06 Jan 2026",
        "GATEWAY EXAMPLE",
        "Incoming Transfer",
        "",
        "+1.234,00",
        "2.345,00",
    )]
    .join("\n");
    let rows = format!(
        "{}\n{}",
        rows,
        time_line(
            "11:11",
            "Danamon 003583679232",
            "STPK20260101000000000001_260106120000_003583679232"
        )
    );
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    let t = &parsed.transactions[0];
    assert_eq!(t.amount_minor, 123_400);
    assert_eq!(t.balance_minor, 234_500);
}

#[test]
fn movement_row_counterparty_drops_type_line() {
    let rows = [
        date_line(
            "08 Jan 2026",
            "Main Pocket",
            "Pocket Money Out",
            "",
            "-250.000",
            "750.000",
        ),
        time_line("09:15", "Movement between Pockets", "260101-AA00-BB1234"),
    ]
    .join("\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    let t = &parsed.transactions[0];
    assert_eq!(t.counterparty, "Main Pocket");
    assert_eq!(t.transaction_type, "Pocket Money Out");
    assert_eq!(t.amount_minor, -25_000_000);
}

#[test]
fn missing_id_kept_and_warned() {
    let rows = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", ""),
    ]
    .join("\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.transactions.len(), 1);
    assert_eq!(parsed.transactions[0].bank_id, "");
    assert_eq!(parsed.warnings.len(), 1);
    assert!(parsed.warnings[0].contains("missing Jago transaction ID"));
    assert!(parsed.warnings[0].contains("row 1"));
}

#[test]
fn incomplete_row_skipped_and_warned() {
    // Amount without balance: the row is skipped, not silently accepted.
    let broken = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
    ]
    .join("\n");
    let good = [
        date_line(
            "08 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("09:00", "Jago 123456789012", "2401021234567890"),
    ]
    .join("\n");
    let rows = format!("{broken}\n\n{good}");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.transactions.len(), 1);
    assert_eq!(parsed.transactions[0].date, "2026-01-08");
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("missing amount or balance")),
        "warnings: {:?}",
        parsed.warnings
    );
    // The skipped row must not trigger a bogus chain mismatch for row 2.
    assert!(
        !parsed
            .warnings
            .iter()
            .any(|w| w.contains("balance chain mismatch"))
    );
}

#[test]
fn chain_mismatch_warned() {
    let rows = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
        String::new(),
        date_line(
            "08 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+500.000",
            "1.700.000",
        ),
        time_line("09:00", "Jago 123456789012", "2401021234567890"),
    ]
    .join("\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("balance chain mismatch")),
        "warnings: {:?}",
        parsed.warnings
    );
}

#[test]
fn artifacts_and_prelude_ignored() {
    let rows = [date_line(
        "07 Jan 2026",
        "ALICE EXAMPLE",
        "Incoming Transfer",
        "",
        "+1.000.000",
        "1.000.000",
    )]
    .join("\n");
    let rows = format!(
        "{rows}\n{}",
        time_line("08:30", "Jago 123456789012", "2401011234567890")
    );
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
}

#[test]
fn unrecognized_line_warned() {
    let rows = [
        "January 2026".to_string(),
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
        "some stray text".to_string(),
    ]
    .join("\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.transactions.len(), 1);
    // The stray line must not be glued onto the previous row's notes.
    assert_eq!(parsed.transactions[0].notes, "");
    assert_eq!(parsed.warnings.len(), 1);
    assert!(parsed.warnings[0].contains("unrecognized line"));
    assert!(parsed.warnings[0].contains("line 15"));
}

#[test]
fn furniture_with_extra_spaces_ignored() {
    // Browser PDF.js furniture: arbitrary inner spacing. None of it may leak
    // into row notes or produce fake rows/warnings.
    let rows1 = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "Note one",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
    ]
    .join("\n");
    let rows2 = [
        date_line(
            "08 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+500.000",
            "1.500.000",
        ),
        time_line("09:00", "Jago 123456789012", "2401021234567890"),
    ]
    .join("\n");
    let text = format!(
        "MUHAMMAD   EXAMPLE\n\
         Test   Organization   123456789\n\
         Showing   IDR transaction from\n\
         19 Dec 2025 - 30 Jan 2026    IDR 9.000.000\n\
         \n\
         Pockets   Transactions   History        Page 1 of 2\n\
         \n\
         {h}\n\
         \n\
         January   2026\n\
         \n\
         {r1}\n\
         \n\
         Page 1 of 2\n\
         \n\
         PT Bank   Jago Tbk licensed\n\
         also   a member of LPS\n\
         www.jago.com\n\
         \n\
         Pockets Transactions History   Page 2 of 2\n\
         \n\
         {h}\n\
         \n\
         {r2}\n\
         \n\
         Disclaimer\n\
         This   document is your list\n",
        h = header_spaced(),
        r1 = rows1,
        r2 = rows2
    );
    let parsed = parse_statement(&text).unwrap();
    assert_eq!(parsed.warnings, Vec::<String>::new());
    assert_eq!(parsed.transactions.len(), 2);
    // Notes and counterparty untouched by surrounding furniture.
    assert_eq!(parsed.transactions[0].notes, "Note one");
    assert_eq!(
        parsed.transactions[0].counterparty,
        "ALICE EXAMPLE / Jago 123456789012"
    );
    assert_eq!(parsed.transactions[1].balance_minor, 150_000_000);
}

#[test]
fn empty_and_foreign_input_error() {
    assert!(parse_statement("").is_err());
    assert!(parse_statement("hello world\n").is_err());
}

#[test]
fn header_only_statement_ok_with_warning() {
    let parsed = parse_statement(&doc(true, &[page1("")])).unwrap();
    assert!(parsed.transactions.is_empty());
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("no transaction rows"))
    );
}

#[test]
fn json_roundtrip_and_field_names() {
    let rows = [date_line(
        "07 Jan 2026",
        "ALICE EXAMPLE",
        "Incoming Transfer",
        "",
        "+1.000.000",
        "1.000.000",
    )]
    .join("\n");
    let rows = format!(
        "{rows}\n{}",
        time_line("08:30", "Jago 123456789012", "2401011234567890")
    );
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    let json = serde_json::to_string(&parsed).unwrap();
    for field in [
        "bank_id",
        "date",
        "time",
        "counterparty",
        "transaction_type",
        "notes",
        "amount_minor",
        "balance_minor",
    ] {
        assert!(
            json.contains(&format!("\"{field}\"")),
            "missing {field}: {json}"
        );
    }
    let back: ParsedStatement = serde_json::from_str(&json).unwrap();
    assert_eq!(back, parsed);
}

#[test]
fn parses_without_column_header_with_warning() {
    // Line-reconstructed input without the page header row: columns unknown,
    // but time/ID/type/amount patterns and the balance chain still parse.
    let rows = [
        date_line(
            "07 Jan 2026",
            "ALICE EXAMPLE",
            "Incoming Transfer",
            "",
            "+1.000.000",
            "1.000.000",
        ),
        time_line("08:30", "Jago 123456789012", "2401011234567890"),
    ]
    .join("\n");
    let parsed = parse_statement(&format!("January 2026\n{rows}\n")).unwrap();
    assert_eq!(parsed.transactions.len(), 1);
    let t = &parsed.transactions[0];
    assert_eq!(t.counterparty, "ALICE EXAMPLE");
    assert_eq!(t.transaction_type, "Incoming Transfer");
    assert_eq!(t.bank_id, "2401011234567890");
    assert_eq!(t.time.as_deref(), Some("08:30"));
    assert_eq!(t.amount_minor, 100_000_000);
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("column header not seen")),
        "warnings: {:?}",
        parsed.warnings
    );
}

#[test]
fn chain_overflow_is_warning_not_panic() {
    // prev + amount overflows i64; checked_add must yield a warning, not a
    // panic (debug builds panic on arithmetic overflow).
    let mk = |day: &str, id: &str, amt: &str, bal: &str| {
        [
            date_line(day, "ALICE EXAMPLE", "Incoming Transfer", "", amt, bal),
            time_line("10:00", "Jago 123456789012", id),
        ]
        .join("\n")
    };
    let rows = [
        mk(
            "01 Jan 2026",
            "260101-AA00-BB0001",
            "+90000000000000000",
            "90000000000000000",
        ), // 9e18 minor
        mk(
            "02 Jan 2026",
            "260102-AA00-BB0002",
            "+5000000000000000",
            "92000000000000000",
        ), // 9e18 + 5e17 overflows i64; claimed balance 9.2e18 parses
    ]
    .join("\n\n");
    let parsed = parse_statement(&doc(true, &[page1(&rows)])).unwrap();
    assert_eq!(parsed.transactions.len(), 2);
    assert!(
        parsed
            .warnings
            .iter()
            .any(|w| w.contains("balance chain mismatch")),
        "warnings: {:?}",
        parsed.warnings
    );
}
