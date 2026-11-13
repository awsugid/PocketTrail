// Shared helpers for the journey checks: a tiny fixture statement writer and a
// multipart post (the harness's Client only speaks urlencoded forms).

import { ORIGIN } from '../harness.mjs';

/** Rust-style fixed-width pad. */
export function pad(s, w) {
	return s.padEnd(w);
}

// Statement columns are separated by at least two spaces, which is what the
// parser splits on. Header and body share one builder, so their offsets agree
// even when a cell (for example a long bank note) outgrows its nominal width.
const WIDTHS = [19, 34, 39, 10, 20];

function line(cells) {
	const parts = [];
	for (let i = 0; i < cells.length; i += 1) {
		const width = WIDTHS[i] ?? 0;
		parts.push(pad(cells[i] ?? '', width));
	}
	return parts.join('  ');
}

export function statementHeader() {
	return line(['Date & Time', 'Source/Destination', 'Transaction Details', 'Notes', 'Amount']) + '  Balance';
}

export function statementRow(date, source, details, notes, amount, balance) {
	return line([date, source, details, notes, amount]) + '  ' + balance;
}

export function statementTime(time, source, id) {
	return line([time, source, id === '' ? '' : `ID# ${id}`]);
}

/** A complete synthetic statement with the given rows. Row shape is fixed so
 * the parser's column geometry is exercised, not bypassed. */
export function statement(rows) {
	const body = rows
		.map((row) =>
			[
				statementRow(row.date, row.source, row.details, row.notes ?? '', row.amount, row.balance),
				statementTime(row.time ?? '09:00', row.source, row.id ?? '')
			].join('\n')
		)
		.join('\n');
	return `${statementHeader()}\n\nJune 2025\n\n${body}\n`;
}

/** Magic bytes are all the server checks; the text arrives separately, as it
 * would from browser-side PDF extraction. */
export function syntheticPdf(label = 'synthetic') {
	return new File(
		[new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, ...new TextEncoder().encode(label)])],
		`${label}.pdf`,
		{ type: 'application/pdf' }
	);
}

/** Multipart POST as the browser would send it (Origin present, HTML accept). */
export async function postMultipart(client, path, fields, files = {}) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	for (const [key, file] of Object.entries(files)) form.append(key, file);
	return client.request(path, {
		method: 'POST',
		headers: { accept: 'text/html', origin: ORIGIN },
		body: form
	});
}

export function csrfFrom(html) {
	return html.match(/name="csrf_token"\s+value="([0-9a-f]{32})"/)?.[1] ?? null;
}

/** Signs a client in through the local fixture form. */
export async function signIn(client, extractCsrf, identity) {
	const page = await client.get('/login');
	const csrf = extractCsrf(await page.text());
	return client.postForm('/login?/dev', { csrf_token: csrf ?? '', user_id: identity });
}
