// Jago "Pockets Transactions History" statement parser, ported from
// crates/jago-parser/src/lib.rs.
//
// Layout assumptions (pdftotext -layout output): a row starts with
// `DD Mon YYYY` followed by two or more spaces; `HH:MM` sits on the next
// line, first column; signed amount and running balance are right-aligned
// trailing tokens on the date line in Indonesian format (`.` thousands,
// optional `,dd` decimals); the Jago transaction ID appears as `ID# <token>`
// and is kept verbatim; column boundaries are re-read per page from the
// repeated `Date & Time ...` header line.
//
// Rows are never dropped silently: a row missing amount or balance is skipped
// with a warning, a row missing its ID is kept with a warning, and a
// consecutive-row balance chain mismatch (previous balance + amount must
// equal the new balance, across page breaks) produces a warning. Warnings
// carry line numbers and row ordinals only, never statement content.
//
// Porting notes:
// - Rust byte offsets become UTF-16 string offsets; identical for the ASCII
//   statement text this parser targets.
// - Rust's `ParseError` result becomes a thrown `Error` with the same message.
// - Amounts are `number` minor units, range-checked against the full i64 like
//   Rust's checked arithmetic. Numbers beyond 2^53 cannot be represented
//   exactly in JS, so balance chain math runs in BigInt and stays exact.

export interface ParsedTransaction {
	/** Verbatim Jago transaction ID (after `ID# `). Empty when the statement
	 * row had no ID, which also adds a warning to the statement's warnings. */
	bankId: string;
	/** ISO `YYYY-MM-DD`. */
	date: string;
	/** `HH:MM`, when present. */
	time: string | null;
	/** Full Source/Destination column text, ` / `-joined. */
	counterparty: string;
	/** Transaction Details label, one of TRANSACTION_TYPES when recognized. */
	transactionType: string;
	/** Notes column text, whitespace-joined across wrapped lines. */
	notes: string;
	/** Signed amount in IDR minor units (100 per rupiah). */
	amountMinor: number;
	/** Running balance in IDR minor units. */
	balanceMinor: number;
}

export interface ParsedStatement {
	transactions: ParsedTransaction[];
	/** Neutral review notes (line numbers and row ordinals only, no statement
	 * content): missing IDs, skipped incomplete rows, balance chain breaks,
	 * unrecognized lines. */
	warnings: string[];
}

/** Read-only title/subtitle projection. Original counterparty remains the bank
 * fact. Never use this projection for actor mapping, comparison, or dedup. */
export interface CounterpartyDisplay {
	name: string;
	bankAccount: string | null;
}

/** snake_case row shape persisted by the import pipeline. */
export interface StatementRowPayload {
	bank_id: string;
	date: string;
	time: string | null;
	counterparty: string;
	transaction_type: string;
	notes: string;
	amount_minor: number;
	balance_minor: number;
}

export interface StatementPayload {
	rows: StatementRowPayload[];
	warnings: string[];
}

/** Transaction type labels seen in the Transaction Details column. */
const TRANSACTION_TYPES = [
	"Incoming Transfer",
	"Outgoing Transfer",
	"Pocket Money In",
	"Pocket Money Out",
	"Movement between Pockets"
];

/** IDR minor units: 100 minor per rupiah. */
const IDR_MINOR_PER_RUPIAH = 100n;
const I64_MAX = 9223372036854775807n;
const I64_MIN = -9223372036854775808n;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ROW_START_RE = /^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})(?:\s{2,}(.*))?$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_HEADER_RE = /^[A-Z][a-z]+ \d{4}$/;
const DATE_RANGE_RE = /^\d{2} [A-Z][a-z]{2} \d{4} - /;
const ALL_CAPS_RE = /^[A-Z][A-Z ']+$/;
const ACCOUNT_LINE_RE = /\s\d{5,}$/;
const PAGE_NUMBER_RE = /^Page\s+\d+\s+of\s+\d+$/;
// Header labels are matched whitespace-flexibly for browser-extracted headers;
// their offsets still come from the ORIGINAL line.
const H_DATE = /Date\s*&\s*Time/;
const H_SOURCE = /Source\s*\/\s*Destination/;
const H_DETAILS = /Transaction\s+Details/;
const H_NOTES = /Notes/;

/** Parse the `-layout` text extraction of one Jago statement PDF. Throws when
 * the input is not recognizable statement text (no column header seen and zero
 * transactions). */
export function parseStatement(text: string): ParsedStatement {
	const parser = new ParserState();
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i += 1) {
		// Rust `str::lines()` strips one trailing `\r`; split does not.
		const line = lines[i] ?? "";
		parser.line(i + 1, line.endsWith("\r") ? line.slice(0, -1) : line);
	}
	return parser.finish();
}

interface Columns {
	source: number;
	details: number;
	notes: number;
}

/** Column starts come from the original line so downstream segment offsets
 * stay exact. */
function columnsFromHeader(line: string): Columns | null {
	const source = line.search(H_SOURCE);
	if (source < 0) return null;
	const details = line.search(H_DETAILS);
	if (details < 0) return null;
	const notes = line.search(H_NOTES);
	if (notes < 0) return null;
	const date = line.search(H_DATE);
	if (date < 0 || date >= source || source >= details || details >= notes) return null;
	return { source, details, notes };
}

interface RowStart {
	/** Null when the date token has an impossible day (row is skipped). */
	date: string | null;
	/** Offset where the row content starts (after the date token). */
	offset: number;
}

/** Recognize a row-start line: `DD Mon YYYY` then two or more spaces (or EOL).
 * The statement period line `19 Dec 2025 - 09 Aug 2026` has a single space
 * before the dash and does not match.
 * @internal Exposed for the ported Rust unit tests. */
export function rowStart(line: string): RowStart | null {
	const m = ROW_START_RE.exec(line);
	if (m === null) return null;
	const day = Number(m[1]);
	const month = monthNumber(m[2] ?? "");
	const year = Number(m[3]);
	const date = month !== null && validDate(year, month, day)
		? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
		: null;
	// Group 4 is the `.*` anchored before `$`, so it always runs to end of line.
	const rest = m[4];
	const offset = rest === undefined ? line.length : line.length - rest.length;
	return { date, offset };
}

/** Real calendar validation (leap years included), unlike the bank's own
 * 1..31 day range. */
function validDate(year: number, month: number, day: number): boolean {
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = month === 2
		? leap ? 29 : 28
		: [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31
		: [4, 6, 9, 11].includes(month) ? 30
		: 0;
	return day >= 1 && day <= days;
}

function monthNumber(m: string): number | null {
	const idx = MONTHS.indexOf(m);
	return idx >= 0 ? idx + 1 : null;
}

/** Collapse whitespace runs to single spaces (recognition only). Browser PDF
 * extractors emit furniture like `Pockets  Transactions  History` with
 * arbitrary inner spacing; transaction text itself is never normalized. */
function collapseWs(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}

/** Page furniture and document prelude lines that never belong to a row. */
function isArtifact(line: string): boolean {
	const t = collapseWs(line);
	return t.includes("Pockets Transactions History")
		|| t.startsWith("PT Bank Jago Tbk")
		|| t.startsWith("also a member of")
		|| t.startsWith("www.jago.com")
		|| t === "Disclaimer"
		|| t.startsWith("This document is your list")
		|| t.startsWith("based on search result")
		|| t.startsWith("Showing IDR transaction")
		|| t.startsWith("Latest Balance per")
		|| PAGE_NUMBER_RE.test(t)
		|| DATE_RANGE_RE.test(t);
}

function isMonthHeader(line: string): boolean {
	return MONTH_HEADER_RE.test(collapseWs(line));
}

/** Document prelude before the first row: the account holder name and the
 * pocket account line. */
function isPrelude(line: string): boolean {
	const t = collapseWs(line);
	return ALL_CAPS_RE.test(t) || ACCOUNT_LINE_RE.test(t);
}

/** Split a line into text segments separated by two or more spaces, keeping
 * each segment's offset so it can be assigned to a column.
 * @internal Exposed for the ported Rust unit tests. */
export function segmentsFrom(line: string, from: number): Array<[number, string]> {
	const out: Array<[number, string]> = [];
	let i = Math.min(from, line.length);
	while (i < line.length) {
		while (i < line.length && line[i] === " ") i += 1;
		if (i >= line.length) break;
		const start = i;
		let j = i;
		let gap = 0;
		while (j < line.length) {
			if (line[j] === " ") {
				gap += 1;
			} else {
				if (gap >= 2) break;
				gap = 0;
			}
			j += 1;
		}
		// `j - gap` is the segment end in both the gap-break and EOL cases.
		out.push([start, line.slice(start, j - gap)]);
		i = j;
	}
	return out;
}

/** Parse an Indonesian-formatted IDR amount (`+1.234.567,89`, `-624`,
 * `1.234.567,00`) into minor units. The sign is optional and defaults to
 * positive; balance chain checking catches sign-less negatives. Returns null
 * for anything that does not parse or overflows i64. */
export function parseIdrMinor(token: string): number | null {
	const t = token.trim();
	let sign = 1n;
	let body = t;
	if (t.startsWith("+")) {
		body = t.slice(1);
	} else if (t.startsWith("-")) {
		sign = -1n;
		body = t.slice(1);
	}
	let intPart = body;
	let frac = 0n;
	const comma = body.indexOf(",");
	if (comma >= 0) {
		const f = body.slice(comma + 1);
		intPart = body.slice(0, comma);
		if (f === "" || f.length > 2 || !/^[0-9]+$/.test(f)) return null;
		frac = BigInt(f);
		if (f.length === 1) frac *= 10n;
	}
	if (intPart === "") return null;
	const digits = intPart.split(".").join("");
	if (digits === "" || !/^[0-9]+$/.test(digits)) return null;
	const value = sign * (BigInt(digits) * IDR_MINOR_PER_RUPIAH + frac);
	if (value < I64_MIN || value > I64_MAX) return null;
	return Number(value);
}

/** `prev + amount === balance` in exact math; an i64 overflow counts as a
 * mismatch (Rust's checked_add returning None), not a crash. */
function chainHolds(prev: number, amount: number, balance: number): boolean {
	const sum = BigInt(prev) + BigInt(amount);
	return sum >= I64_MIN && sum <= I64_MAX && sum === BigInt(balance);
}

interface Block {
	lineno: number;
	date: string;
	time: string | null;
	id: string | null;
	transactionType: string | null;
	counterparty: string[];
	notes: string[];
	amountMinor: number | null;
	balanceMinor: number | null;
	/** Fallback mode: no column header was seen, so the first unmatched
	 * segment of the date line is taken as the counterparty. */
	noColumns: boolean;
	/** Fallback flag: the date-line counterparty slot is taken. */
	counterpartyAddedFallback: boolean;
}

type Col = "date" | "source" | "details" | "notes" | "unknown";

/** Classify one physical line belonging to the row currently being built.
 * `from` is the offset where content starts (after the date token on the date
 * line, 0 on continuation lines). Returns true when the line holds content in
 * the date column that is not a time, which ends the row. */
function blockLine(block: Block, columns: Columns | null, line: string, from: number): boolean {
	let pendingId = false;
	for (const [off, seg] of segmentsFrom(line, from)) {
		const col: Col = columns === null
			? "unknown"
			: off >= columns.notes ? "notes"
			: off >= columns.details ? "details"
			: off >= columns.source ? "source"
			: "date";
		if (pendingId) {
			block.id = seg;
			pendingId = false;
			continue;
		}
		if (seg.startsWith("ID#")) {
			const id = seg.slice(3).trim();
			if (id === "") {
				// Defensive: `ID#` split from its value by a column gap.
				pendingId = true;
			} else {
				block.id = id;
			}
			continue;
		}
		// Time and type are pattern-matched only in their own columns so a
		// note like "12:34" or "Outgoing Transfer" is not swallowed.
		if (TIME_RE.test(seg) && (col === "date" || col === "unknown")) {
			if (block.time === null) block.time = seg;
			continue;
		}
		if (TRANSACTION_TYPES.includes(seg) && (col === "details" || col === "unknown")) {
			if (block.transactionType === null) block.transactionType = seg;
			continue;
		}
		switch (col) {
			case "source":
				block.counterparty.push(seg);
				break;
			case "notes":
			case "details":
				block.notes.push(seg);
				break;
			case "unknown":
				// No header positions available (e.g. line-reconstructed text).
				// Pattern matches above already captured time, ID and type; the
				// first unmatched segment of the date line is the counterparty,
				// everything unmatched on continuation lines is notes.
				if (block.noColumns && !block.counterpartyAddedFallback) {
					block.counterparty.push(seg);
					block.counterpartyAddedFallback = true;
				} else {
					block.notes.push(seg);
				}
				break;
			case "date":
				// Continuation rows never carry date-column content except a
				// time, so treat this as the end of the row; the caller warns
				// about the stray line and closes the row.
				return true;
		}
	}
	return false;
}

class ParserState {
	columns: Columns | null = null;
	current: Block | null = null;
	transactions: ParsedTransaction[] = [];
	warnings: string[] = [];
	/** Balance of the last emitted transaction, for chain checking. */
	prevBalance: number | null = null;
	/** Set when a row was skipped, so the next chain mismatch is suppressed
	 * once (the skipped row's amount is unknown). */
	chainSuppressed = false;
	rowsSeen = 0;
	started = false;

	line(lineno: number, line: string): void {
		if (line.trim() === "") return;
		const cols = columnsFromHeader(line);
		if (cols !== null) {
			this.columns = cols;
			return;
		}
		if (isArtifact(line) || isMonthHeader(line)) return;
		const start = rowStart(line);
		if (start !== null) {
			this.finishBlock();
			if (start.date === null) {
				// Date token with an impossible day; skip the row. Continuation
				// lines then warn as unrecognized instead of mis-attaching.
				this.warnings.push(`line ${lineno}: invalid transaction date; row skipped`);
				this.current = null;
				return;
			}
			const noColumns = this.columns === null;
			if (noColumns) {
				this.warnings.push(`line ${lineno}: column header not seen yet; column classification degraded`);
			}
			this.rowsSeen += 1;
			const block: Block = {
				lineno,
				date: start.date,
				time: null,
				id: null,
				transactionType: null,
				counterparty: [],
				notes: [],
				amountMinor: null,
				balanceMinor: null,
				noColumns,
				counterpartyAddedFallback: false
			};
			// Amount and balance are the trailing numeric segments of the date
			// line; remove them so they are not classified as notes.
			let end = line.length;
			const segs = segmentsFrom(line, start.offset);
			if (segs.length >= 2) {
				const bal = segs[segs.length - 1];
				const amt = segs[segs.length - 2];
				if (bal !== undefined && amt !== undefined) {
					const amount = parseIdrMinor(amt[1]);
					const balance = parseIdrMinor(bal[1]);
					if (amount !== null && balance !== null) {
						block.amountMinor = amount;
						block.balanceMinor = balance;
						end = amt[0];
					}
				}
			}
			const ended = blockLine(block, this.columns, line.slice(0, end), start.offset);
			this.current = block;
			if (ended) this.finishBlock();
			return;
		}
		if (this.current !== null) {
			const block = this.current;
			this.current = null;
			const ended = blockLine(block, this.columns, line, 0);
			if (ended) this.warnings.push(`line ${lineno}: unrecognized line ignored`);
			this.current = block;
			if (ended) this.finishBlock();
			return;
		}
		if (!this.started && isPrelude(line)) return;
		this.warnings.push(`line ${lineno}: unrecognized line ignored`);
	}

	finishBlock(): void {
		const block = this.current;
		if (block === null) return;
		this.current = null;
		const ordinal = this.rowsSeen;
		const at = (msg: string) => `row ${ordinal} (line ${block.lineno}): ${msg}`;

		if (block.amountMinor === null || block.balanceMinor === null) {
			this.warnings.push(at("missing amount or balance; row skipped"));
			this.chainSuppressed = true;
			return;
		}
		const amount = block.amountMinor;
		const balance = block.balanceMinor;

		const chainOk = this.chainSuppressed
			|| this.prevBalance === null
			|| chainHolds(this.prevBalance, amount, balance);
		if (!chainOk) {
			this.warnings.push(at("balance chain mismatch with previous row"));
		}
		this.chainSuppressed = false;

		if (block.id === null) this.warnings.push(at("missing Jago transaction ID"));
		if (block.transactionType === null) this.warnings.push(at("missing transaction type"));
		if (block.counterparty.length === 0) this.warnings.push(at("missing source/destination"));

		// `Movement between Pockets` is transfer boilerplate repeated in the
		// Source/Destination column of every pocket row, never a real
		// counterparty label.
		const counterparty = block.counterparty.filter((c) => c !== "Movement between Pockets");
		this.started = true;
		this.prevBalance = balance;
		this.transactions.push({
			bankId: block.id ?? "",
			date: block.date,
			time: block.time,
			counterparty: counterparty.join(" / "),
			transactionType: block.transactionType ?? "",
			notes: block.notes.join(" "),
			amountMinor: amount,
			balanceMinor: balance
		});
	}

	finish(): ParsedStatement {
		this.finishBlock();
		if (this.columns === null && this.transactions.length === 0) {
			throw new Error("no Jago statement column header found; input is not statement text");
		}
		if (this.transactions.length === 0) {
			this.warnings.push("statement contains no transaction rows");
		}
		return { transactions: this.transactions, warnings: this.warnings };
	}
}

/** Split only the observed Jago account suffix; unknown formats stay intact. */
export function counterpartyDisplay(counterparty: string): CounterpartyDisplay {
	const idx = counterparty.lastIndexOf(" / ");
	if (idx >= 0) {
		const name = counterparty.slice(0, idx);
		const suffix = counterparty.slice(idx + 3);
		const account = suffix.startsWith("Jago ") ? suffix.slice(5) : null;
		if (name.trim() !== "" && account !== null && account !== "" && /^[0-9]+$/.test(account)) {
			// The stored fact is the full suffix, `Jago ` prefix included; the
			// stripped all-digit account is only the validity check.
			return { name, bankAccount: suffix };
		}
	}
	return { name: counterparty, bankAccount: null };
}

/** snake_case projection the import pipeline persists. */
export function toPayloadJson(statement: ParsedStatement): StatementPayload {
	return {
		rows: statement.transactions.map((t) => ({
			bank_id: t.bankId,
			date: t.date,
			time: t.time,
			counterparty: t.counterparty,
			transaction_type: t.transactionType,
			notes: t.notes,
			amount_minor: t.amountMinor,
			balance_minor: t.balanceMinor
		})),
		warnings: statement.warnings
	};
}