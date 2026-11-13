// Ported from crates/jago-parser: the inline #[cfg(test)] unit tests in
// src/lib.rs (driven through the exported internal helpers) and ALL of
// tests/synthetic.rs. Fixtures are synthetic; column offsets mirror the
// observed `pdftotext -layout` geometry: Source/Destination at col 20,
// Transaction Details at 55, Notes at 95.
import { describe, expect, it } from 'vitest';

import { counterpartyDisplay, parseIdrMinor, parseStatement, rowStart, segmentsFrom, toPayloadJson } from '$lib/server/parser';

// --- synthetic.rs fixtures (same fixed-width geometry as the Rust helpers) ---

/** Rust `{:<w}`: pad to at least `w` with spaces. */
function f(s: string, w: number): string {
	return s.padEnd(w);
}

/** Column header line defining the page's column boundaries. */
function header(): string {
	return `${f('Date & Time', 19)} ${f('Source/Destination', 34)} ${f('Transaction Details', 39)} ${f('Notes', 10)} ${f('Amount', 20)}Balance`;
}

/** Browser-style header: arbitrary spaces inside the label words, column
 * starts unchanged (Source at 20, Transaction at 55, Notes at 95). */
function headerSpaced(): string {
	return `${f('Date  &  Time', 19)} ${f('Source/Destination', 34)} ${f('Transaction   Details', 39)} ${f('Notes', 10)} ${f('Amount', 20)}Balance`;
}

/** A row's date line. Empty `notes` is valid. */
function dateLine(date: string, source: string, details: string, notes: string, amount: string, balance: string): string {
	return `${f(date, 19)} ${f(source, 34)} ${f(details, 39)} ${f(notes, 10)} ${f(amount, 20)}${balance}`;
}

/** A row's second line: time, optional source/destination continuation,
 * optional `ID# ...`. `id` may be empty. */
function timeLine(time: string, source: string, id: string): string {
	const idPart = id === '' ? '' : `ID# ${id}`;
	return `${f(time, 19)} ${f(source, 34)} ${idPart}`;
}

/** Notes continuation attached after the ID on the same line. */
function timeLineNotes(time: string, source: string, id: string, notes: string): string {
	return `${f(time, 19)} ${f(source, 34)} ${f(`ID# ${id}`, 40)}${notes}`;
}

function pageBanner(n: number, of: number): string {
	return `${'Pockets Transactions History'.padStart(60)}   Page ${n} of ${of}`;
}

function footer(): string {
	return [
		'PT Bank Jago Tbk is licensed and supervised by Financial Services Authority (OJK)',
		'also a member of Indonesia Deposit Insurance Corporation (LPS) deposit insurance program.',
		'www.jago.com'
	].join('\n');
}

function doc(prelude: boolean, pages: string[]): string {
	let out = '';
	if (prelude) {
		out += 'MUHAMMAD EXAMPLE\n';
		out += 'Test Organization 123456789\n';
		out += 'Showing IDR transaction from    Latest Balance per 30 Jan 2026\n';
		out += '19 Dec 2025 - 30 Jan 2026    IDR 9.000.000\n\n';
	}
	pages.forEach((page, i) => {
		if (i > 0) out += '\n';
		out += page;
	});
	out += '\n';
	return out;
}

function page1(rows: string): string {
	return `${pageBanner(1, 2)}\n\n${header()}\n\nJanuary 2026\n\n${rows}\n\n${footer()}`;
}

function page2(rows: string): string {
	return `${pageBanner(2, 2)}\n\n${header()}\n\n${rows}\n\nDisclaimer\n${footer()}`;
}

// --- lib.rs inline unit tests ---

describe('idr minor parsing', () => {
	it('parses Indonesian amounts into minor units', () => {
		expect(parseIdrMinor('+15.000.000')).toBe(1_500_000_000);
		expect(parseIdrMinor('-624')).toBe(-62_400);
		expect(parseIdrMinor('+10.783.024,00')).toBe(1_078_302_400);
		expect(parseIdrMinor('2.345,00')).toBe(234_500);
		expect(parseIdrMinor('1.234,5')).toBe(123_450);
		expect(parseIdrMinor('0')).toBe(0);
		// IDR minor is exactly 100 per rupiah.
		expect(parseIdrMinor('1')).toBe(100);
		expect(parseIdrMinor('1,234')).toBeNull();
		expect(parseIdrMinor('abc')).toBeNull();
		expect(parseIdrMinor('')).toBeNull();
		expect(parseIdrMinor('1.2.3.4')).toBe(123_400);
	});
});

describe('row start vs period line', () => {
	it('matches row starts and never the period line', () => {
		expect(rowStart('19 Dec 2025        AWS User Group        Incoming Transfer')).toEqual({
			date: '2025-12-19',
			offset: 19
		});
		// Period line: single space before the dash, never a row start.
		expect(rowStart('19 Dec 2025 - 09 Aug 2026   IDR 1.209.070')).toBeNull();
		expect(rowStart('February 2026')).toBeNull();
		expect(rowStart('Main Pocket')).toBeNull();
	});
});

describe('calendar true dates', () => {
	it('validates real calendar dates including leap years', () => {
		expect(rowStart('29 Feb 2024        ALICE')?.date).toBe('2024-02-29'); // leap year
		expect(rowStart('29 Feb 2025        ALICE')?.date).toBeNull();
		expect(rowStart('31 Apr 2026        ALICE')?.date).toBeNull();
		expect(rowStart('30 Feb 2025        ALICE')?.date).toBeNull();
		expect(rowStart('31 Dec 2025        ALICE')?.date).toBe('2025-12-31');
	});
});

describe('segments split on double spaces', () => {
	it('keeps each segment offset', () => {
		expect(segmentsFrom('08:31             Danamon 003583679232             ID# X1', 0)).toEqual([
			[0, '08:31'],
			[18, 'Danamon 003583679232'],
			[51, 'ID# X1']
		]);
	});
});

// --- synthetic.rs tests ---

describe('counterparty display', () => {
	it('separates only known bank account suffix', () => {
		const raw = 'ALICE / EXAMPLE 2 / Jago 000123456789';
		const display = counterpartyDisplay(raw);
		expect(display.name).toBe('ALICE / EXAMPLE 2');
		expect(display.bankAccount).toBe('Jago 000123456789');
		for (const raw of [
			'ALICE / EXAMPLE 2',
			'SHOP / 123456',
			'ALICE / Other 123456',
			'ALICE / Jago Savings',
			'ALICE / Jago 123x',
			' / Jago 123456',
			'ALICE / Jago 123 / BRANCH'
		]) {
			const display = counterpartyDisplay(raw);
			expect(display.name).toBe(raw);
			expect(display.bankAccount).toBeNull();
		}
	});
});

it('single row full fields', () => {
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', 'Note one', '+1.000.000', '1.000.000'),
		timeLineNotes('08:30', 'Jago 123456789012', '2401011234567890', 'Note cont')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings).toEqual([]);
	expect(parsed.transactions.length).toBe(1);
	const t = parsed.transactions[0]!;
	expect(t.bankId).toBe('2401011234567890');
	expect(t.date).toBe('2026-01-07');
	expect(t.time).toBe('08:30');
	expect(t.counterparty).toBe('ALICE EXAMPLE / Jago 123456789012');
	const display = counterpartyDisplay(t.counterparty);
	expect(display.name).toBe('ALICE EXAMPLE');
	expect(display.bankAccount).toBe('Jago 123456789012');
	expect(t.transactionType).toBe('Incoming Transfer');
	expect(t.notes).toBe('Note one Note cont');
	// IDR minor: 100 minor per rupiah.
	expect(t.amountMinor).toBe(1_000_000 * 100);
	expect(t.balanceMinor).toBe(1_000_000 * 100);
});

it('multipage rows chain across pages', () => {
	const rows1 = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890'),
		'',
		dateLine('08 Jan 2026', 'Main Pocket', 'Pocket Money Out', '', '-250.000', '750.000'),
		timeLine('09:15', 'Movement between Pockets', '260101-AA00-BB1234')
	].join('\n');
	const rows2 = [
		dateLine('09 Jan 2026', 'CAROL SAMPLE', 'Incoming Transfer', '', '+500.000', '1.250.000'),
		timeLine('19:00', 'Jago 123456789012', '2401091234567890')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows1), page2(rows2)]));
	expect(parsed.warnings).toEqual([]);
	expect(parsed.transactions.map((t) => t.date)).toEqual(['2026-01-07', '2026-01-08', '2026-01-09']);
	expect(parsed.transactions[2]!.balanceMinor).toBe(125_000_000);
});

it('id formats preserved verbatim', () => {
	const mk = (id: string, amt: string, bal: string, day: string) =>
		[dateLine(day, 'ALICE EXAMPLE', 'Incoming Transfer', '', amt, bal), timeLine('10:00', 'Jago 123456789012', id)].join('\n');
	const rows = [
		mk('2401011234567890', '+1.000.000', '1.000.000', '01 Jan 2026'),
		mk('000000008597', '+500.000', '1.500.000', '02 Jan 2026'),
		mk('260103-AA00-BB1234', '+250.000', '1.750.000', '03 Jan 2026'),
		mk('STPK20260101000000000000_260103120000_123456789012', '+250.000', '2.000.000', '04 Jan 2026')
	].join('\n\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings).toEqual([]);
	expect(parsed.transactions.map((t) => t.bankId)).toEqual([
		'2401011234567890',
		'000000008597',
		'260103-AA00-BB1234',
		'STPK20260101000000000000_260103120000_123456789012'
	]);
});

it('comma decimals to minor', () => {
	const rows = [
		dateLine('06 Jan 2026', 'GATEWAY EXAMPLE', 'Incoming Transfer', '', '+1.234,00', '2.345,00'),
		timeLine('11:11', 'Danamon 003583679232', 'STPK20260101000000000001_260106120000_003583679232')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings).toEqual([]);
	const t = parsed.transactions[0]!;
	expect(t.amountMinor).toBe(123_400);
	expect(t.balanceMinor).toBe(234_500);
});

it('movement row counterparty drops type line', () => {
	const rows = [
		dateLine('08 Jan 2026', 'Main Pocket', 'Pocket Money Out', '', '-250.000', '750.000'),
		timeLine('09:15', 'Movement between Pockets', '260101-AA00-BB1234')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings).toEqual([]);
	const t = parsed.transactions[0]!;
	expect(t.counterparty).toBe('Main Pocket');
	expect(t.transactionType).toBe('Pocket Money Out');
	expect(t.amountMinor).toBe(-25_000_000);
});

it('missing id kept and warned', () => {
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.transactions.length).toBe(1);
	expect(parsed.transactions[0]!.bankId).toBe('');
	expect(parsed.warnings.length).toBe(1);
	expect(parsed.warnings[0]).toContain('missing Jago transaction ID');
	expect(parsed.warnings[0]).toContain('row 1');
});

it('incomplete row skipped and warned', () => {
	// Amount without balance: the row is skipped, not silently accepted.
	const broken = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', ''),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890')
	].join('\n');
	const good = [
		dateLine('08 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('09:00', 'Jago 123456789012', '2401021234567890')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(`${broken}\n\n${good}`)]));
	expect(parsed.transactions.length).toBe(1);
	expect(parsed.transactions[0]!.date).toBe('2026-01-08');
	expect(parsed.warnings.some((w) => w.includes('missing amount or balance'))).toBe(true);
	// The skipped row must not trigger a bogus chain mismatch for row 2.
	expect(parsed.warnings.some((w) => w.includes('balance chain mismatch'))).toBe(false);
});

it('chain mismatch warned', () => {
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890'),
		'',
		dateLine('08 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+500.000', '1.700.000'),
		timeLine('09:00', 'Jago 123456789012', '2401021234567890')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings.some((w) => w.includes('balance chain mismatch'))).toBe(true);
});

it('artifacts and prelude ignored', () => {
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.warnings).toEqual([]);
});

it('unrecognized line warned at line 15', () => {
	const rows = [
		'January 2026',
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890'),
		'some stray text'
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.transactions.length).toBe(1);
	// The stray line must not be glued onto the previous row's notes.
	expect(parsed.transactions[0]!.notes).toBe('');
	expect(parsed.warnings.length).toBe(1);
	expect(parsed.warnings[0]).toContain('unrecognized line');
	expect(parsed.warnings[0]).toContain('line 15');
});

it('furniture with extra spaces ignored', () => {
	// Browser PDF.js furniture: arbitrary inner spacing. None of it may leak
	// into row notes or produce fake rows/warnings.
	const rows1 = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', 'Note one', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890')
	].join('\n');
	const rows2 = [
		dateLine('08 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+500.000', '1.500.000'),
		timeLine('09:00', 'Jago 123456789012', '2401021234567890')
	].join('\n');
	const text = [
		'MUHAMMAD   EXAMPLE',
		'Test   Organization   123456789',
		'Showing   IDR transaction from',
		'19 Dec 2025 - 30 Jan 2026    IDR 9.000.000',
		'',
		'Pockets   Transactions   History        Page 1 of 2',
		'',
		headerSpaced(),
		'',
		'January   2026',
		'',
		rows1,
		'',
		'Page 1 of 2',
		'',
		'PT Bank   Jago Tbk licensed',
		'also   a member of LPS',
		'www.jago.com',
		'',
		'Pockets Transactions History   Page 2 of 2',
		'',
		headerSpaced(),
		'',
		rows2,
		'',
		'Disclaimer',
		'This   document is your list'
	].join('\n');
	const parsed = parseStatement(text);
	expect(parsed.warnings).toEqual([]);
	expect(parsed.transactions.length).toBe(2);
	// Notes and counterparty untouched by surrounding furniture.
	expect(parsed.transactions[0]!.notes).toBe('Note one');
	expect(parsed.transactions[0]!.counterparty).toBe('ALICE EXAMPLE / Jago 123456789012');
	expect(parsed.transactions[1]!.balanceMinor).toBe(150_000_000);
});

it('empty and foreign input error', () => {
	expect(() => parseStatement('')).toThrow('no Jago statement column header found; input is not statement text');
	expect(() => parseStatement('hello world\n')).toThrow('no Jago statement column header found; input is not statement text');
});

it('header only statement ok with warning', () => {
	const parsed = parseStatement(doc(true, [page1('')]));
	expect(parsed.transactions.length).toBe(0);
	expect(parsed.warnings.some((w) => w.includes('no transaction rows'))).toBe(true);
});

it('json payload field names are snake_case', () => {
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890')
	].join('\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	const payload = toPayloadJson(parsed);
	expect(payload.warnings).toEqual(parsed.warnings);
	expect(payload.rows.length).toBe(parsed.transactions.length);
	expect(Object.keys(payload.rows[0]!)).toEqual([
		'bank_id',
		'date',
		'time',
		'counterparty',
		'transaction_type',
		'notes',
		'amount_minor',
		'balance_minor'
	]);
	expect(payload.rows[0]).toEqual({
		bank_id: '2401011234567890',
		date: '2026-01-07',
		time: '08:30',
		counterparty: 'ALICE EXAMPLE / Jago 123456789012',
		transaction_type: 'Incoming Transfer',
		notes: '',
		amount_minor: 100_000_000,
		balance_minor: 100_000_000
	});
});

it('parses without column header with warning', () => {
	// Line-reconstructed input without the page header row: columns unknown,
	// but time/ID/type/amount patterns and the balance chain still parse.
	const rows = [
		dateLine('07 Jan 2026', 'ALICE EXAMPLE', 'Incoming Transfer', '', '+1.000.000', '1.000.000'),
		timeLine('08:30', 'Jago 123456789012', '2401011234567890')
	].join('\n');
	const parsed = parseStatement(`January 2026\n${rows}\n`);
	expect(parsed.transactions.length).toBe(1);
	const t = parsed.transactions[0]!;
	expect(t.counterparty).toBe('ALICE EXAMPLE');
	expect(t.transactionType).toBe('Incoming Transfer');
	expect(t.bankId).toBe('2401011234567890');
	expect(t.time).toBe('08:30');
	expect(t.amountMinor).toBe(100_000_000);
	expect(parsed.warnings.some((w) => w.includes('column header not seen'))).toBe(true);
});

it('chain overflow is warning not panic', () => {
	// prev + amount overflows i64; checked math must yield a warning, not a
	// crash. 9e16 rupiah = 9e18 minor, near the i64 ceiling.
	const mk = (day: string, id: string, amt: string, bal: string) =>
		[dateLine(day, 'ALICE EXAMPLE', 'Incoming Transfer', '', amt, bal), timeLine('10:00', 'Jago 123456789012', id)].join('\n');
	const rows = [
		mk('01 Jan 2026', '260101-AA00-BB0001', '+90000000000000000', '90000000000000000'), // 9e18 minor
		mk('02 Jan 2026', '260102-AA00-BB0002', '+5000000000000000', '92000000000000000') // 9e18 + 5e17 overflows i64; claimed balance 9.2e18 parses
	].join('\n\n');
	const parsed = parseStatement(doc(true, [page1(rows)]));
	expect(parsed.transactions.length).toBe(2);
	expect(parsed.warnings.some((w) => w.includes('balance chain mismatch'))).toBe(true);
});