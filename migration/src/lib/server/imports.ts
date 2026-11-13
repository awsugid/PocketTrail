// Private statement staging, ported from src/web/imports.rs. A batch is staged
// from browser-extracted text plus the original PDF, previewed, and confirmed in
// one CAS-guarded batch. Confirmation never updates an existing bank movement:
// unchanged records are skipped, and conflicting or ID-less rows are retained as
// reviewable import items only.

import { error, redirect } from '@sveltejs/kit';
import type { D1PreparedStatement, R2Bucket } from '$lib/d1';
import { counterpartyDisplay, parseStatement, toPayloadJson, type StatementRowPayload } from './parser';
import { fmtMoney, fmtTs, validDate, validTime, MAX_SAFE_MINOR } from '$lib/fmt';
import { activeMem, mapCounterparty, mappingsOf, pocketsOf, type MappingRow, type MemRow, type TxnRow } from './rows';
import { exec, nowMs, qAll, qOne } from './db';
import { committed } from './audit';
import { randomHex } from './tokens';
import { enqueueAssignment } from './txns_notify';
import type { TxnCtx } from './txns';

const FILE_LIMIT = 10 * 1024 * 1024;
const TEXT_LIMIT = 3 * 1024 * 1024;
const ROW_LIMIT = 2000;

/** Staged payload object, stored privately under org/{id}/imports/{nonce}/. */
export interface ImportPayload {
	rows: StatementRowPayload[];
	warnings: string[];
	statement_text: string;
}

interface BatchRow {
	id: number;
	pocket_id: number;
	filename: string;
	created_at: number;
	by_name: string;
	status: string;
	payload: string;
	totals: string;
}

interface ItemRow {
	bank_id: string | null;
	transaction_id: number | null;
	counterparty: string;
	amount_minor: number | null;
	status: string;
	message: string;
}

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Reject payloads that cannot be imported safely: empty/oversized text, no
 * rows or too many, unsafe money, and malformed dates or times. */
export function invalidPayload(p: ImportPayload): boolean {
	return (
		p.statement_text === '' ||
		byteLen(p.statement_text) > TEXT_LIMIT ||
		p.rows.length === 0 ||
		p.rows.length > ROW_LIMIT ||
		p.rows.some(
			(r) =>
				Math.abs(r.amount_minor) > MAX_SAFE_MINOR ||
				Math.abs(r.balance_minor) > MAX_SAFE_MINOR ||
				!validDate(r.date) ||
				(r.time !== null && !validTime(r.time))
		)
	);
}

async function batchOf(ctx: TxnCtx, id: number): Promise<BatchRow | null> {
	return qOne<BatchRow>(
		ctx.db,
		'SELECT b.*,u.name AS by_name FROM import_batches b JOIN memberships m ON m.id=b.created_by_membership_id JOIN users u ON u.id=m.user_id WHERE b.org_id=?1 AND b.id=?2',
		[ctx.org.id, id]
	);
}

function batchJson(b: BatchRow) {
	let counts: unknown = {};
	try {
		counts = JSON.parse(b.totals) as unknown;
	} catch {
		counts = {};
	}
	return {
		id: b.id,
		filename: b.filename,
		createdAt: fmtTs(b.created_at),
		byName: b.by_name,
		status: b.status,
		counts: counts as Record<string, number>
	};
}

async function loadPayload(ctx: TxnCtx, batch: BatchRow): Promise<ImportPayload> {
	let pointer: unknown;
	try {
		pointer = JSON.parse(batch.payload) as unknown;
	} catch {
		throw error(500, 'The import staging metadata is unreadable. Start a new import.');
	}
	const key = (pointer as { r2_key?: unknown } | null)?.r2_key;
	if (typeof key !== 'string' || !key.startsWith(`org/${ctx.org.id}/imports/`)) {
		throw error(500, 'The import staging metadata points outside this organization.');
	}
	const bucket: R2Bucket | null = ctx.env.DOCUMENTS ?? null;
	if (!bucket) throw error(503, 'Private import storage is not configured.');
	const object = await bucket.get(key);
	if (!object || !object.body) throw error(404, 'The staged statement is no longer available.');
	try {
		return JSON.parse(new TextDecoder().decode(await object.body.arrayBuffer())) as ImportPayload;
	} catch {
		throw error(500, 'The staged statement could not be read. Start a new import.');
	}
}

// ------------------------------------------------------------------ list page

export async function importsPageData(ctx: TxnCtx) {
	const batches = await qAll<BatchRow>(
		ctx.db,
		'SELECT b.*,u.name AS by_name FROM import_batches b JOIN memberships m ON m.id=b.created_by_membership_id JOIN users u ON u.id=m.user_id WHERE b.org_id=?1 ORDER BY b.id DESC LIMIT 100',
		[ctx.org.id]
	);
	const pockets = await pocketsOf(ctx.db, ctx.org.id);
	return {
		batches: batches.map(batchJson),
		pockets: pockets.map((p) => ({ id: p.id, name: p.name })),
		canImport: ctx.can('ImportStatements')
	};
}

// -------------------------------------------------------------- row staging

// SQL classifies against the current ledger, inside the same batch as insertion.
// The complete opaque bank ID is always scoped to both organization and pocket.
const SAME =
	"t.txn_date=json_extract(j.value,'$.date') AND t.txn_time IS json_extract(j.value,'$.time') AND t.counterparty=json_extract(j.value,'$.counterparty') AND t.transaction_type=json_extract(j.value,'$.transaction_type') AND t.bank_notes=json_extract(j.value,'$.notes') AND t.amount_minor=json_extract(j.value,'$.amount_minor') AND t.balance_minor IS json_extract(j.value,'$.balance_minor')";

/** Build bounded JSON parameters, keeping each D1 value below its 2 MB limit.
 * Duplicate IDs within the statement are all quarantined, not first-row-wins. */
async function rowChunks(ctx: TxnCtx, pocketId: number, payload: ImportPayload): Promise<string[]> {
	const mappings = await mappingsOf(ctx.db, ctx.org.id);
	const owner =
		(await pocketsOf(ctx.db, ctx.org.id)).find((p) => p.id === pocketId)?.owner_membership_id ?? null;
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const row of payload.rows) {
		if (seen.has(row.bank_id)) repeated.add(row.bank_id);
		seen.add(row.bank_id);
	}
	const chunks: string[] = [];
	let current: string[] = [];
	let size = 2;
	for (const row of payload.rows) {
		const responsible =
			row.amount_minor < 0
				? (activeMem(ctx.memberRows, mapCounterparty(mappings, pocketId, row.counterparty)?.membership_id ?? null)?.id ??
					activeMem(ctx.memberRows, owner)?.id ??
					null)
				: null;
		const encoded = JSON.stringify({ ...row, responsible, repeated: repeated.has(row.bank_id) });
		if (byteLen(encoded) > 1_000_000) {
			throw error(400, 'One statement row is too large to stage. Re-extract the original PDF.');
		}
		if (size + byteLen(encoded) + 1 > 1_000_000 || current.length === 50) {
			chunks.push(`[${current.join(',')}]`);
			current = [];
			size = 2;
		}
		size += byteLen(encoded) + 1;
		current.push(encoded);
	}
	if (current.length > 0) chunks.push(`[${current.join(',')}]`);
	return chunks;
}

/** All statements after the CAS check its unguessable status token. A losing
 * confirmer cannot insert rows, change item results, or finalize another run. */
function stageStatements(
	ctx: TxnCtx,
	batchId: number,
	pocketId: number,
	guard: string,
	chunks: string[],
	commit: boolean,
	beanNow: number
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [];
	statements.push(
		ctx.db
			.prepare(
				'DELETE FROM import_items WHERE batch_id=?1 AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)'
			)
			.bind(batchId, ctx.org.id, guard)
	);
	for (const chunk of chunks) {
		// Every statement has the same first five parameters.
		const params: unknown[] = [batchId, ctx.org.id, guard, pocketId, chunk];
		if (commit) {
			params.push(beanNow);
			statements.push(
				ctx.db
					.prepare(
						"INSERT OR IGNORE INTO transactions(org_id,pocket_id,bank_id,txn_date,txn_time,counterparty,transaction_type,bank_notes,amount_minor,balance_minor,responsible_membership_id,import_batch_id,created_at,updated_at,mutation_token) SELECT ?2,?4,json_extract(j.value,'$.bank_id'),json_extract(j.value,'$.date'),json_extract(j.value,'$.time'),json_extract(j.value,'$.counterparty'),json_extract(j.value,'$.transaction_type'),json_extract(j.value,'$.notes'),json_extract(j.value,'$.amount_minor'),json_extract(j.value,'$.balance_minor'),CASE WHEN json_extract(j.value,'$.amount_minor')<0 THEN COALESCE((SELECT id FROM memberships WHERE id=json_extract(j.value,'$.responsible') AND org_id=?2 AND removed_at IS NULL),(SELECT owner_membership_id FROM pockets WHERE id=?4 AND org_id=?2)) ELSE NULL END,?1,?6,?6,?3 FROM json_each(?5) j WHERE json_extract(j.value,'$.bank_id')<>'' AND json_extract(j.value,'$.repeated')=0 AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)"
					)
					.bind(...params)
			);
		}
		const status = `CASE WHEN json_extract(j.value,'$.bank_id')='' THEN 'needs_review' WHEN json_extract(j.value,'$.repeated')=1 THEN 'conflict' WHEN t.id IS NULL THEN 'imported' ${commit ? "WHEN t.import_batch_id=?1 AND t.mutation_token=?3 THEN 'imported'" : ''} WHEN ${SAME} THEN 'duplicate_unchanged' ELSE 'conflict' END`;
		const sql = `INSERT INTO import_items(batch_id,transaction_id,bank_id,status,counterparty,amount_minor,message) SELECT ?1,t.id,NULLIF(json_extract(j.value,'$.bank_id'),''),${status},json_extract(j.value,'$.counterparty'),json_extract(j.value,'$.amount_minor'),CASE WHEN json_extract(j.value,'$.bank_id')='' THEN 'Missing bank ID; not imported.' WHEN json_extract(j.value,'$.repeated')=1 THEN 'Repeated bank ID within statement; not imported.' WHEN t.id IS NOT NULL AND NOT (${SAME}) THEN 'Bank fields differ; existing transaction retained.' ELSE '' END FROM json_each(?5) j LEFT JOIN transactions t ON t.org_id=?2 AND t.pocket_id=?4 AND t.bank_id=json_extract(j.value,'$.bank_id') WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND org_id=?2 AND status=?3)`;
		statements.push(ctx.db.prepare(sql).bind(...params.slice(0, 5)));
	}
	if (commit) {
		statements.push(
			ctx.db
				.prepare(
					'INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since) SELECT id,responsible_membership_id,?4 FROM transactions WHERE org_id=?2 AND import_batch_id=?1 AND mutation_token=?3 AND responsible_membership_id IS NOT NULL AND EXISTS(SELECT 1 FROM import_batches WHERE id=?1 AND status=?3)'
				)
				.bind(batchId, ctx.org.id, guard, beanNow)
		);
	}
	statements.push(
		ctx.db
			.prepare(
				"UPDATE import_batches SET totals=(SELECT json_object('imported',COALESCE(SUM(status='imported'),0),'duplicate_unchanged',COALESCE(SUM(status='duplicate_unchanged'),0),'conflict',COALESCE(SUM(status='conflict'),0),'needs_review',COALESCE(SUM(status='needs_review'),0)) FROM import_items WHERE batch_id=?1),status=?4 WHERE id=?1 AND org_id=?2 AND status=?3"
			)
			.bind(batchId, ctx.org.id, guard, commit ? 'committed' : 'ready')
	);
	return statements;
}

// ---------------------------------------------------------------- create

/** POST /org/:slug/imports — stage browser-extracted text and the original PDF.
 * Stores only aggregate warnings; statement content stays in private R2. */
export async function createImport(ctx: TxnCtx, form: FormData): Promise<never> {
	if (form.getAll('file').length !== 1) {
		throw error(400, 'Choose exactly one original statement PDF.');
	}
	const value = form.get('file');
	const file = value instanceof File ? value : null;
	if (file === null) throw error(400, 'An original statement PDF is required.');
	if (file.size === 0 || file.size > FILE_LIMIT) {
		throw error(400, 'The original PDF must be 1 byte to 10 MiB.');
	}
	const text = typeof form.get('statement_text') === 'string' ? String(form.get('statement_text')) : '';
	if (text.trim() === '' || byteLen(text) > TEXT_LIMIT) {
		throw error(400, 'Extracted statement text is required and must not exceed 3 MiB.');
	}
	const rawPocket = typeof form.get('pocket_id') === 'string' ? String(form.get('pocket_id')) : '';
	const pocketId = /^[0-9]{1,15}$/.test(rawPocket) ? Number(rawPocket) : 0;
	if (!(await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.id === pocketId)) {
		throw error(400, 'Choose a pocket in the current organization.');
	}
	let parsed;
	try {
		parsed = parseStatement(text);
	} catch {
		throw error(400, 'Statement text was not recognized. Re-extract the original PDF.');
	}
	const payload: ImportPayload = {
		rows: toPayloadJson(parsed).rows,
		warnings: parsed.warnings,
		statement_text: text
	};
	if (invalidPayload(payload)) {
		throw error(
			400,
			'Statement must contain between 1 and 2,000 rows with valid dates, times, and amounts. Re-extract the original PDF if rows look wrong.'
		);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.length > FILE_LIMIT || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
		throw error(400, 'The original file must be a PDF no larger than 10 MiB.');
	}
	const bucket: R2Bucket | null = ctx.env.DOCUMENTS ?? null;
	if (!bucket) throw error(503, 'Private document storage is not configured.');
	const nonce = randomHex(24);
	const root = `org/${ctx.org.id}/imports/${nonce}`;
	const originalKey = `${root}/original.pdf`;
	const payloadKey = `${root}/payload.json`;
	const pointer = JSON.stringify({ r2_key: payloadKey });
	const chunks = await rowChunks(ctx, pocketId, payload);
	await bucket.put(originalKey, bytes);
	await bucket.put(payloadKey, new TextEncoder().encode(JSON.stringify(payload)));
	const now = nowMs();
	const batch = await qOne<{ id: number }>(
		ctx.db,
		"INSERT INTO import_batches(org_id,pocket_id,filename,created_by_membership_id,created_at,status,payload) VALUES(?1,?2,?3,?4,?5,'staging',?6) RETURNING id",
		[ctx.org.id, pocketId, file.name, meId(ctx), now, pointer]
	);
	if (!batch) throw error(500, 'Import staging failed.');
	const statements: D1PreparedStatement[] = [
		ctx.db
			.prepare(
				"INSERT INTO documents(org_id,import_batch_id,kind,r2_key,filename,content_type,size_bytes,uploaded_by_membership_id,created_at) VALUES(?1,?2,'statement',?3,?4,'application/pdf',?5,?6,?7)"
			)
			.bind(ctx.org.id, batch.id, originalKey, file.name, bytes.length, meId(ctx), now),
		...stageStatements(ctx, batch.id, pocketId, 'staging', chunks, false, now),
		committed(ctx.db, ctx.org.id, ctx.user.id, 'import.staged', `import_batch:${batch.id}`)
	];
	await ctx.db.batch(statements);
	throw redirect(303, `/org/${ctx.org.slug}/imports/${batch.id}`);
}

function meId(ctx: TxnCtx): number {
	const row = ctx.memberRows.find((m) => m.user_id === ctx.user.id);
	if (!row) throw error(403, 'Active organization membership required.');
	return row.id;
}

// ------------------------------------------------------------ preview page

export async function importBatchPage(ctx: TxnCtx, id: number) {
	const batch = await batchOf(ctx, id);
	if (!batch) throw error(404, 'Import not found.');
	const items = await qAll<ItemRow>(ctx.db, 'SELECT * FROM import_items WHERE batch_id=?1 ORDER BY id', [id]);
	const preview = batch.status !== 'committed';
	const payload = preview ? await loadPayload(ctx, batch) : null;
	const owner =
		(await pocketsOf(ctx.db, ctx.org.id)).find((p) => p.id === batch.pocket_id)?.owner_membership_id ?? null;
	const mappings = await mappingsOf(ctx.db, ctx.org.id);
	const pocketName = (await pocketsOf(ctx.db, ctx.org.id)).find((p) => p.id === batch.pocket_id)?.name ?? '';

	const rows = items.map((it, index) => {
		const row = payload ? payload.rows[index] : undefined;
		const member =
			it.amount_minor !== null && it.amount_minor < 0
				? (activeMem(ctx.memberRows, mapCounterparty(mappings, batch.pocket_id, it.counterparty)?.membership_id ?? null) ??
					activeMem(ctx.memberRows, owner))
				: null;
		return {
			bankId: it.bank_id ?? '',
			transactionId: it.transaction_id,
			counterparty: it.counterparty,
			counterpartyDisplay: counterpartyDisplay(it.counterparty),
			amountMinor: it.amount_minor,
			amount: it.amount_minor === null ? '—' : fmtMoney(it.amount_minor),
			status: it.status,
			message: it.message,
			date: row?.date ?? '',
			time: row?.time ?? null,
			responsibleName: member?.name ?? null
		};
	});

	let warnings: string[] = [];
	let blockingWarnings = false;
	let ownerRequired = false;
	let ready = false;
	if (payload) {
		warnings = payload.warnings;
		blockingWarnings =
			payload.warnings.length > 0 ||
			invalidPayload(payload) ||
			payload.rows.some((r) => r.bank_id.trim() === '');
		ownerRequired = activeMem(ctx.memberRows, owner) === null;
		ready = !blockingWarnings && batch.status === 'ready' && !ownerRequired;
	}

	return {
		batch: batchJson(batch),
		pocketName,
		items: rows,
		preview,
		warnings,
		blockingWarnings,
		ownerRequired,
		ready,
		canConfirm: ctx.can('ImportStatements')
	};
}

// ------------------------------------------------------------------ confirm

/** POST /org/:slug/imports/:id/confirm. One CAS from `ready` to a token guard
 * wins the batch; every later statement, including the committed audit event,
 * is gated by that token. */
export async function confirmImport(ctx: TxnCtx, id: number): Promise<never> {
	const destination = `/org/${ctx.org.slug}/imports/${id}`;
	const batch = await batchOf(ctx, id);
	if (!batch) throw error(404, 'Import not found.');
	if (batch.status === 'committed') throw redirect(303, destination);
	if (batch.status !== 'ready') throw error(409, 'Import staging is incomplete.');
	if (!(await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.id === batch.pocket_id && activeMem(ctx.memberRows, p.owner_membership_id) !== null)) {
		throw error(409, 'Choose an active pocket owner before confirming this import.');
	}
	const payload = await loadPayload(ctx, batch);
	// No unsafe-import policy is authorized: every extraction warning blocks the
	// entire batch, including balance-chain failures and omitted rows.
	if (invalidPayload(payload) || payload.warnings.length > 0 || payload.rows.some((r) => r.bank_id.trim() === '')) {
		throw error(409, 'Resolve extraction warnings and missing IDs by re-extracting and importing again. Nothing was committed.');
	}
	const guard = `confirming:${randomHex(24)}`;
	const chunks = await rowChunks(ctx, batch.pocket_id, payload);
	const now = nowMs();
	const cas = ctx.db
		.prepare(
			"UPDATE import_batches SET status=?3 WHERE id=?1 AND org_id=?2 AND status='ready' AND EXISTS(SELECT 1 FROM pockets p JOIN memberships m ON m.id=p.owner_membership_id AND m.org_id=p.org_id AND m.removed_at IS NULL WHERE p.id=import_batches.pocket_id AND p.org_id=?2)"
		)
		.bind(id, ctx.org.id, guard);
	const statements: D1PreparedStatement[] = [cas];
	// Guarded by the unguessable status token and pushed BEFORE the staged
	// statements finalize the batch status: after the CAS, status still equals
	// the guard iff this confirmer won. Same transaction, so the row vanishes if
	// any later statement aborts the batch.
	statements.push(
		ctx.db
			.prepare(
				"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,'import.committed',?3,'committed',?4 WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=?5 AND org_id=?2 AND status=?6)"
			)
			.bind(ctx.user.id, ctx.org.id, `import_batch:${id}`, now, id, guard)
	);
	statements.push(...stageStatements(ctx, id, batch.pocket_id, guard, chunks, true, now));
	const results = await ctx.db.batch(statements);
	const won = (results[0]?.meta?.changes ?? 0) === 1;
	if (won) {
		const newRows = await qAll<TxnRow>(
			ctx.db,
			'SELECT * FROM transactions WHERE org_id=?1 AND import_batch_id=?2 AND mutation_token=?3',
			[ctx.org.id, id, guard]
		);
		for (const row of newRows) {
			await enqueueAssignment(ctx.db, ctx.org, ctx.memberRows, ctx.roleRows, row);
		}
	}
	throw redirect(303, destination);
}
