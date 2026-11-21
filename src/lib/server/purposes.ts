// Server logic for organization-scoped purposes: reusable income/expense
// buckets allocated to bank transactions, their Notes/evidence, per-purpose
// approval, discussion, responsibility, and notifications.
//
// Mutations mirror txns.ts: one atomic D1 batch guarded by a revision CAS on
// the purpose (or transaction) row, probed via the operation token.

import { error, redirect } from '@sveltejs/kit';
import { exec, nowMs, qAll, qOne } from './db';
import { randomHex } from './tokens';
import { activeMem, memActive, memsOfOrg, type MemRow } from './rows';
import { mentionRecipients } from './txns_notify';
import type { TxnCtx } from './txns';
import {
	effectiveResponsibles,
	mayApprovePurpose,
	purposeKindOf,
	purposeReady,
	purposeStatusLabel,
	PURPOSE_KIND_LABELS,
	type PurposeKind
} from '#lib/purposes.ts';
import { markdownToPlain } from '#lib/markdown.ts';
import { readListData } from './list_data';
import { matchesCommon, paginate, type ListFilters } from './list_filters';
import { fmtMoney, fmtSize, fmtTs } from '#lib/fmt.ts';
import { PERMISSION_LABELS, type Permission } from '#lib/domain.ts';
import type { D1Database, D1PreparedStatement, R2Bucket } from '#lib/d1.ts';

// ------------------------------------------------------------------- rows

export interface PurposeRow {
	id: number;
	org_id: number;
	name: string;
	kind: PurposeKind;
	notes: string;
	status: string;
	approved_by_membership_id: number | null;
	approved_at: number | null;
	approval_note: string;
	suppressed: number;
	created_by_membership_id: number;
	source_split_id: number | null;
	created_at: number;
	updated_at: number;
	revision: number;
	mutation_token: string;
}

export interface AllocationRow {
	id: number;
	org_id: number;
	purpose_id: number;
	transaction_id: number;
	amount_minor: number;
	responsible_membership_id: number | null;
	created_at: number;
}

/** Allocation joined with its purpose, as the transaction view needs it. */
export interface TxnAllocationView {
	id: number;
	purpose_id: number;
	transaction_id: number;
	amount_minor: number;
	responsible_membership_id: number | null;
	purpose_name: string;
	purpose_kind: PurposeKind;
	purpose_status: string;
	purpose_notes: string;
}

export async function purposeById(db: D1Database, orgId: number, id: number): Promise<PurposeRow | null> {
	return qOne<PurposeRow>(db, 'SELECT * FROM purposes WHERE id = ?1 AND org_id = ?2', [id, orgId]);
}

export async function allocationsOfTxn(db: D1Database, txnId: number): Promise<TxnAllocationView[]> {
	return qAll<TxnAllocationView>(
		db,
		`SELECT a.id, a.purpose_id, a.transaction_id, a.amount_minor, a.responsible_membership_id,
		        p.name AS purpose_name, p.kind AS purpose_kind, p.status AS purpose_status, p.notes AS purpose_notes
		 FROM allocations a JOIN purposes p ON p.id = a.purpose_id
		 WHERE a.transaction_id = ?1 ORDER BY a.id`,
		[txnId]
	);
}

export interface PurposeAllocationView {
	id: number;
	transaction_id: number;
	amount_minor: number;
	responsible_membership_id: number | null;
	txn_date: string;
	txn_time: string | null;
	counterparty: string;
	bank_id: string | null;
	amount_minor_signed: number;
	pocket_name: string;
}

export async function allocationsOfPurpose(db: D1Database, purposeId: number): Promise<PurposeAllocationView[]> {
	return qAll<PurposeAllocationView>(
		db,
		`SELECT a.id, a.transaction_id, a.amount_minor, a.responsible_membership_id,
		        t.txn_date, t.txn_time, t.counterparty, t.bank_id, t.amount_minor AS amount_minor_signed,
		        p.name AS pocket_name
		 FROM allocations a
		 JOIN transactions t ON t.id = a.transaction_id
		 JOIN pockets p ON p.id = t.pocket_id
		 WHERE a.purpose_id = ?1 ORDER BY t.txn_date DESC, t.id DESC`,
		[purposeId]
	);
}

export async function purposeResponsibles(db: D1Database, purposeId: number): Promise<number[]> {
	const rows = await qAll<{ membership_id: number }>(db, 'SELECT membership_id FROM purpose_responsibles WHERE purpose_id = ?1 ORDER BY membership_id', [purposeId]);
	return rows.map((r) => r.membership_id);
}

export async function purposeResponsibleHistory(db: D1Database, purposeId: number): Promise<number[]> {
	const rows = await qAll<{ membership_id: number }>(db, 'SELECT membership_id FROM purpose_responsible_history WHERE purpose_id = ?1 ORDER BY membership_id', [purposeId]);
	return rows.map((r) => r.membership_id);
}

export interface PurposeMessageRow {
	id: number;
	body_md: string;
	created_at: number;
	author_name: string;
	author_handle: string;
	author_picture: string | null;
	author_membership_id: number;
}

export async function messagesOf(db: D1Database, purposeId: number): Promise<PurposeMessageRow[]> {
	return qAll<PurposeMessageRow>(
		db,
		`SELECT m.id, m.body_md, m.created_at, m.author_membership_id,
		        u.name AS author_name, m2.handle AS author_handle, u.picture AS author_picture
		 FROM purpose_messages m
		 JOIN memberships m2 ON m2.id = m.author_membership_id
		 JOIN users u ON u.id = m2.user_id
		 WHERE m.purpose_id = ?1 ORDER BY m.id`,
		[purposeId]
	);
}

export async function purposeEvidenceOf(db: D1Database, purposeId: number) {
	return qAll<{ id: number; filename: string; size_bytes: number; note: string }>(
		db,
		"SELECT id, filename, size_bytes, note FROM documents WHERE purpose_id = ?1 AND kind = 'evidence' AND superseded = 0 ORDER BY id",
		[purposeId]
	);
}

export interface PurposeAuditRow {
	action: string;
	previous_status: string | null;
	new_status: string | null;
	details: string;
	created_at: number;
	author_name: string;
}

export async function purposeAuditOf(db: D1Database, purposeId: number): Promise<PurposeAuditRow[]> {
	return qAll<PurposeAuditRow>(
		db,
		`SELECT a.action, a.previous_status, a.new_status, a.details, a.created_at, u.name AS author_name
		 FROM purpose_audit a JOIN memberships m ON m.id = a.actor_membership_id JOIN users u ON u.id = m.user_id
		 WHERE a.purpose_id = ?1 ORDER BY a.id DESC LIMIT 100`,
		[purposeId]
	);
}

export async function purposesOfKind(db: D1Database, orgId: number, kind: PurposeKind | null): Promise<Array<{ id: number; name: string; kind: PurposeKind }>> {
	return qAll(
		db,
		kind === null
			? 'SELECT id, name, kind FROM purposes WHERE org_id = ?1 ORDER BY kind, lower(name)'
			: 'SELECT id, name, kind FROM purposes WHERE org_id = ?1 AND kind = ?2 ORDER BY lower(name)',
		kind === null ? [orgId] : [orgId, kind]
	);
}

// ----------------------------------------------------------- notification

/** Link-only purpose notice (kind 'mention': one email per row, no financial
 * details). Gates: org notifications enabled, active member holding
 * ViewTransactions, purpose not suppressed. A suppressed transaction never
 * mutes a shared purpose. */
/** Link-only purpose notice (kind 'mention' for discussion messages,
 * 'purpose' for assignments): one email per row, no financial details. Gates:
 * org notifications enabled, active member holding ViewTransactions, purpose
 * not suppressed. A suppressed transaction never mutes a shared purpose.
 * Parameters: ?1 org, ?2 kind, ?3 member, ?4 purpose, ?5 subject, ?6 body,
 * ?7 now. Exported for SQL-level regression tests. */
export const INSERT_PURPOSE_NOTICE_SQL = `INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, purpose_id, subject, body, created_at)
SELECT ?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7 FROM organizations o
JOIN memberships m ON m.org_id = o.id AND m.id = ?3
JOIN roles r ON r.id = m.role_id AND r.org_id = o.id
JOIN purposes p ON p.id = ?4 AND p.org_id = o.id
WHERE o.id = ?1 AND o.notifications_enabled = 1 AND m.removed_at IS NULL AND p.suppressed = 0
  AND EXISTS (SELECT 1 FROM json_each(r.permissions) WHERE value = 'ViewTransactions')`;

export async function enqueuePurposeNotices(
	db: D1Database,
	org: { id: number; name: string; slug: string },
	purposeId: number,
	recipients: readonly number[],
	what: 'discussion' | 'assignment'
): Promise<void> {
	const link = `/org/${org.slug}/purposes/${purposeId}`;
	const [kind, subject, body] =
		what === 'discussion'
			? ['mention', `New discussion message — ${org.name}`, `A purpose discussion you follow has a new message in ${org.name}.\n${link}`]
			: ['purpose', `Purpose assigned to you — ${org.name}`, `You are now responsible for a purpose in ${org.name}.\n${link}`];
	const now = nowMs();
	for (const mid of recipients) {
		await exec(db, INSERT_PURPOSE_NOTICE_SQL, [org.id, kind, mid, purposeId, subject, body, now]);
	}
}

/** Recipients for a discussion message or reassignment: purpose responsibles
 * plus resolved mentions, deduped, author excluded, restricted to members the
 * notice gate can accept (active, ViewTransactions). */
export function purposeNoticeRecipients(
	mems: readonly MemRow[],
	roles: ReadonlyArray<{ id: number; permissions: string }>,
	authorUserId: string,
	purposeResponsibles: readonly number[],
	body: string
): number[] {
	const permissionOf = new Map<number, boolean>();
	for (const m of mems) {
		if (m.removed_at !== null) continue;
		const role = roles.find((r) => r.id === m.role_id);
		permissionOf.set(m.id, role !== undefined && role.permissions.includes('"ViewTransactions"'));
	}
	const eligible = mems.filter((m) => memActive(m) && m.user_id !== authorUserId && (permissionOf.get(m.id) ?? false));
	const cands = eligible.map((m) => ({ id: m.id, handle: m.handle.toLowerCase(), name: m.name.trim() }));
	const mentioned = mentionRecipients(body, cands);
	const out: number[] = [];
	const add = (id: number) => {
		if (!out.includes(id) && eligible.some((m) => m.id === id)) out.push(id);
	};
	for (const id of purposeResponsibles) add(id);
	for (const id of mentioned) add(id);
	return out;
}

// ------------------------------------------------------------ page models

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

function me(ctx: TxnCtx): MemRow {
	const row = ctx.memberRows.find((m) => m.user_id === ctx.user.id);
	if (!row || !memActive(row)) throw error(403, 'Active organization membership required.');
	return row;
}

const memName = (ctx: TxnCtx, id: number | null | undefined): string | null =>
	id === null || id === undefined ? null : (ctx.memberRows.find((m) => m.id === id)?.name ?? null);

const purposeUrl = (ctx: TxnCtx, id: number) => `/org/${ctx.org.slug}/purposes/${id}`;

export interface PurposesListEntry {
	id: number;
	name: string;
	kind: PurposeKind;
	kindLabel: string;
	totalMinor: number;
	total: string;
	statusLabel: string;
	statusTone: 'needs' | 'review' | 'approved' | 'changes';
	responsibles: string[];
	allocationCount: number;
	url: string;
}

export async function filteredPurposesPage(ctx: TxnCtx, selection: ListFilters) {
 const data = await readListData(ctx.db,ctx.org.id,{membershipIds:ctx.memberRows.filter(m => m.user_id === ctx.user.id && m.removed_at === null && !m.invited).map(m => m.id),reviewer:ctx.can('ApproveTransactions')});
 const rows = data.purposeEntries.filter(p => matchesCommon(selection,p,p.totalAllocatedMinor,p.transactions.flatMap(t => data.tagIds.get(t.id) ?? []))
 && (!selection.kind || p.kind === selection.kind) && (!selection.q || p.name.toLowerCase().includes(selection.q.toLowerCase())));
 const byStatus = {needs_details:0,pending_review:0,approved:0,changes_requested:0};
 for (const p of rows) byStatus[p.status]++;
 const paged = paginate(rows,selection.page);
 return {...paged,entries:paged.entries.map(p => ({...p,kindLabel:PURPOSE_KIND_LABELS[p.kind],totalMinor:p.totalAllocatedMinor,total:fmtMoney(p.totalAllocatedMinor),statusLabel:purposeStatusLabel(p.status === 'pending_review' ? 'submitted' : p.status,false),statusTone:(p.status === 'approved' ? 'approved' : p.status === 'changes_requested' ? 'changes' : p.status === 'pending_review' ? 'review' : 'needs') as 'approved' | 'changes' | 'review' | 'needs',allocationCount:p.transactions.length,url:purposeUrl(ctx,p.id)})),
 summary:{totalAllocated:rows.reduce((s,p) => s+p.totalAllocatedMinor,0),byStatus,needsActionCount:rows.filter(p => p.tone === 'action' || p.tone === 'review').length},selection,filterOptions:data.filterOptions,canCreate:ctx.can('DocumentTransactions')};
}

export async function purposesPage(ctx: TxnCtx, kindFilter: PurposeKind | null): Promise<{ entries: PurposesListEntry[]; canCreate: boolean }> {
	const rows = await qAll<{
		id: number;
		name: string;
		kind: PurposeKind;
		notes: string;
		status: string;
		total_minor: number;
		allocation_count: number;
		evidence_count: number;
	}>(ctx.db,
		`SELECT p.id, p.name, p.kind, p.notes, p.status,
		        (SELECT COALESCE(SUM(a.amount_minor), 0) FROM allocations a WHERE a.purpose_id = p.id) AS total_minor,
		        (SELECT COUNT(*) FROM allocations a WHERE a.purpose_id = p.id) AS allocation_count,
		        (SELECT COUNT(*) FROM documents d WHERE d.purpose_id = p.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count
		 FROM purposes p WHERE p.org_id = ?1 AND (?2 IS NULL OR p.kind = ?2)
		 ORDER BY p.kind ASC, lower(p.name)`,
		[ctx.org.id, kindFilter]
	);
	const responsibleRows = await qAll<{ purpose_id: number; membership_id: number }>(
		ctx.db,
		'SELECT pr.purpose_id, pr.membership_id FROM purpose_responsibles pr JOIN purposes p ON p.id = pr.purpose_id WHERE p.org_id = ?1',
		[ctx.org.id]
	);
	const names = new Map(responsibleRows.map((r) => [r.purpose_id + ':' + r.membership_id, memName(ctx, r.membership_id)]));
	const byPurpose = new Map<number, string[]>();
	for (const r of responsibleRows) {
		const list = byPurpose.get(r.purpose_id) ?? [];
		const name = names.get(r.purpose_id + ':' + r.membership_id);
		if (name) list.push(name);
		byPurpose.set(r.purpose_id, list);
	}
	const entries: PurposesListEntry[] = rows.map((r) => {
		const ready = purposeReady(r.kind, r.notes, r.evidence_count);
		return {
			id: r.id,
			name: r.name,
			kind: r.kind,
			kindLabel: PURPOSE_KIND_LABELS[r.kind],
			totalMinor: r.total_minor,
			total: fmtMoney(r.total_minor),
			statusLabel: purposeStatusLabel(r.status, ready),
			statusTone: r.status === 'approved' ? 'approved' : r.status === 'changes_requested' ? 'changes' : r.status === 'submitted' ? 'review' : 'needs',
			responsibles: byPurpose.get(r.id) ?? [],
			allocationCount: r.allocation_count,
			url: purposeUrl(ctx, r.id)
		};
	});
	return { entries, canCreate: ctx.can('DocumentTransactions') };
}

export interface PurposeDetail {
	id: number;
	revision: number;
	name: string;
	kind: PurposeKind;
	kindLabel: string;
	notes: string;
	status: string;
	statusLabel: string;
	statusTone: 'needs' | 'review' | 'approved' | 'changes';
	ready: boolean;
	totalMinor: number;
	total: string;
	approvalNote: string;
	approvedByName: string | null;
	approvedAt: string | null;
	suppressed: boolean;
	responsibles: Array<{ id: number; name: string; active: boolean }>;
	responsibleInactive: boolean;
	allocations: Array<{
		txnId: number;
		date: string;
		time: string;
		counterparty: string;
		pocketName: string;
		bankId: string;
		isIncome: boolean;
		amountMinor: number;
		amount: string;
		overrideName: string | null;
		effectiveNames: string[];
		url: string;
	}>;
	evidence: Array<{ id: number; filename: string; sizeDisplay: string; note: string; url: string }>;
	messages: Array<{ id: number; authorName: string; authorHandle: string; authorPicture: string | null; bodyMd: string; createdAt: string; mine: boolean }>;
	audit: Array<{ actionLabel: string; authorName: string; createdAt: string; detail: string }>;
	members: Array<{ id: number; name: string; handle: string }>;
	can: {
		editNotes: boolean;
		upload: boolean;
		comment: boolean;
		assign: boolean;
		approve: boolean;
		requestChanges: boolean;
	};
	approval: { eligible: boolean; ineligibleReason: string | null };
}

const ACTION_LABELS: Record<string, string> = {
	created: 'Purpose created',
	notes_updated: 'Notes updated',
	evidence_attached: 'Document attached',
	responsibles_changed: 'Responsibility changed',
	submitted: 'Submitted for review',
	approved: 'Approved',
	changes_requested: 'Changes requested',
	reopened: 'Reopened for review'
};

export async function purposeDetail(ctx: TxnCtx, purposeId: number): Promise<PurposeDetail> {
	if (!ctx.can('ViewTransactions')) throw error(403, 'Purpose access denied.');
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	const mine = me(ctx);
	const [allocRows, responsibleIds, historyIds, evidence, messages, auditRows] = await Promise.all([
		allocationsOfPurpose(ctx.db, p.id),
		purposeResponsibles(ctx.db, p.id),
		purposeResponsibleHistory(ctx.db, p.id),
		purposeEvidenceOf(ctx.db, p.id),
		messagesOf(ctx.db, p.id),
		purposeAuditOf(ctx.db, p.id)
	]);
	const ready = purposeReady(p.kind, p.notes, evidence.length);
	const isResponsible = responsibleIds.includes(mine.id);
	const canDocument = ctx.can('DocumentTransactions') || isResponsible;
	const statusSubmitted = p.status === 'submitted';
	// Effective responsibility decides approval eligibility: purpose members,
	// history, allocation overrides, and the allocating transactions' current
	// or historical responsible members.
	const excludedApprovers = new Set<number>([...responsibleIds, ...historyIds]);
	for (const allocation of allocRows) {
		if (allocation.responsible_membership_id !== null) excludedApprovers.add(allocation.responsible_membership_id);
		const txn = await qOne<{ responsible_membership_id: number | null }>(
			ctx.db,
			'SELECT responsible_membership_id FROM transactions WHERE id = ?1 AND org_id = ?2',
			[allocation.transaction_id, ctx.org.id]
		);
		if (txn?.responsible_membership_id != null) excludedApprovers.add(txn.responsible_membership_id);
		const txnHistory = await qAll<{ membership_id: number }>(
			ctx.db,
			'SELECT membership_id FROM responsible_history WHERE transaction_id = ?1',
			[allocation.transaction_id]
		);
		for (const row of txnHistory) excludedApprovers.add(row.membership_id);
	}
	const approvalEligible = p.kind === 'expense' && statusSubmitted && ctx.can('ApproveTransactions') && !excludedApprovers.has(mine.id);
	let ineligibleReason: string | null = null;
	if (p.kind === 'expense' && statusSubmitted && ctx.can('ApproveTransactions') && excludedApprovers.has(mine.id)) {
		ineligibleReason = 'A member responsible for this purpose, now or before, cannot approve it.';
	}
	const txnResponsibleOf = new Map<number, number | null>();
	if (allocRows.length > 0) {
		const txnRows = await qAll<{ id: number; responsible_membership_id: number | null }>(
			ctx.db,
			`SELECT id, responsible_membership_id FROM transactions WHERE org_id = ?1 AND id IN (${allocRows.map(() => '?').join(',')})`,
			[ctx.org.id, ...allocRows.map((a) => a.transaction_id)]
		);
		for (const t of txnRows) txnResponsibleOf.set(t.id, t.responsible_membership_id);
	}
	const nameOf = (id: number | null | undefined) => memName(ctx, id) ?? 'Unassigned';
	return {
		id: p.id,
		revision: p.revision,
		name: p.name,
		kind: p.kind,
		kindLabel: PURPOSE_KIND_LABELS[p.kind],
		notes: p.notes,
		status: p.status,
		statusLabel: purposeStatusLabel(p.status, ready),
		statusTone: p.status === 'approved' ? 'approved' : p.status === 'changes_requested' ? 'changes' : p.status === 'submitted' ? 'review' : 'needs',
		ready,
		totalMinor: allocRows.reduce((sum, a) => sum + a.amount_minor, 0),
		total: fmtMoney(allocRows.reduce((sum, a) => sum + a.amount_minor, 0)),
		approvalNote: p.approval_note,
		approvedByName: memName(ctx, p.approved_by_membership_id),
		approvedAt: p.approved_at === null ? null : fmtTs(p.approved_at),
		suppressed: p.suppressed !== 0,
		responsibles: responsibleIds.map((id) => {
			const m = ctx.memberRows.find((row) => row.id === id);
			return { id, name: m?.name ?? 'Unknown', active: m !== undefined && memActive(m) };
		}),
		responsibleInactive: responsibleIds.some((id) => activeMem(ctx.memberRows, id) === null),
		allocations: allocRows.map((a) => ({
			txnId: a.transaction_id,
			date: a.txn_date,
			time: a.txn_time ?? '',
			counterparty: a.counterparty,
			pocketName: a.pocket_name,
			bankId: a.bank_id ?? '',
			isIncome: a.amount_minor_signed > 0,
			amountMinor: a.amount_minor,
			amount: fmtMoney(a.amount_minor),
			overrideName: memName(ctx, a.responsible_membership_id),
			effectiveNames: effectiveResponsibles(a.responsible_membership_id, responsibleIds, txnResponsibleOf.get(a.transaction_id) ?? null).map(nameOf),
			url: `/org/${ctx.org.slug}/transactions/${a.transaction_id}`
		})),
		evidence: evidence.map((d) => ({
			id: d.id,
			filename: d.filename,
			sizeDisplay: `${Math.max(1, Math.round(d.size_bytes / 1024))} KB`,
			note: d.note,
			url: `/org/${ctx.org.slug}/documents/${d.id}`
		})),
		messages: messages.map((m) => ({
			id: m.id,
			authorName: m.author_name,
			authorHandle: m.author_handle,
			authorPicture: m.author_picture,
			bodyMd: m.body_md,
			createdAt: fmtTs(m.created_at),
			mine: m.author_membership_id === mine.id
		})),
		audit: auditRows.map((a) => ({
			actionLabel: ACTION_LABELS[a.action] ?? a.action,
			authorName: a.author_name,
			createdAt: fmtTs(a.created_at),
			detail: auditDetail(a.action, a.details, (id) => memName(ctx, id))
		})),
		members: ctx.memberRows.filter(memActive).map((m) => ({ id: m.id, name: m.invited ? `${m.name} (invited)` : m.name, handle: m.handle })),
		can: {
			editNotes: canDocument,
			upload: canDocument,
			comment: ctx.can('CommentTransactions'),
			assign: ctx.can('DocumentTransactions'),
			approve: p.kind === 'expense' && statusSubmitted && ctx.can('ApproveTransactions'),
			requestChanges: p.kind === 'expense' && statusSubmitted && ctx.can('ApproveTransactions')
		},
		approval: { eligible: approvalEligible, ineligibleReason }
	};
}

function auditDetail(action: string, details: string, nameOf: (id: number) => string | null): string {
	try {
		const parsed: unknown = JSON.parse(details);
		if (parsed === null || typeof parsed !== 'object') return '';
		const map = parsed as Record<string, unknown>;
		if (action === 'responsibles_changed') {
			const names = (ids: unknown): string =>
				Array.isArray(ids) ? (ids.length === 0 ? 'None' : ids.map((id) => nameOf(id as number) ?? 'Unknown').join(', ')) : '—';
			return `Before: ${names(map.before)}. After: ${names(map.after)}.${typeof map.justification === 'string' && map.justification !== '' ? ` ${map.justification}` : ''}`;
		}
		if (typeof map.filename === 'string') return map.filename;
		if (typeof map.justification === 'string' && map.justification !== '') return map.justification;
		return '';
	} catch {
		return '';
	}
}

// ------------------------------------------------- owed-purpose routing

/** One expense purpose allocation that still needs documentation work.
 * `effective` resolves the allocation override → purpose members → the
 * transaction's inherited member. */
export interface OwedPurposeTask {
	txnId: number;
	txnDate: string;
	purposeId: number;
	purposeName: string;
	counterparty: string;
	pocketName: string;
	status: string;
	ready: boolean;
	effective: number[];
}

/** Purpose-derived documentation state for the action list, digests, and
 * reminders: work still owed on allocated expense transactions. A purpose is
 * owed when its evidence-or-Notes gate is unmet or changes were requested; a
 * transaction with an unallocated remainder is owed by its inherited member.
 * Legacy status/explanation predicates never apply to allocated expenses. */
export async function owedPurposeState(
	db: D1Database,
	orgId: number
): Promise<{
	owedPurposes: OwedPurposeTask[];
		remainders: Array<{ txnId: number; txnDate: string; counterparty: string; pocketName: string; remainderMinor: number; responsibleId: number | null }>;
		allocatedTxnIds: number[];
	}> {
	const rows = await qAll<{
		transaction_id: number;
		txn_date: string;
		counterparty: string;
		pocket_name: string;
		txn_responsible: number | null;
		purpose_id: number;
		purpose_name: string;
		purpose_status: string;
		notes: string;
		override_id: number | null;
		evidence_count: number;
		purpose_resp: string | null;
	}>(
		db,
		`SELECT a.transaction_id, t.txn_date, t.counterparty, p2.name AS pocket_name, t.responsible_membership_id AS txn_responsible,
		        a.purpose_id, pu.name AS purpose_name, pu.status AS purpose_status, pu.notes,
		        a.responsible_membership_id AS override_id,
		        (SELECT COUNT(*) FROM documents d WHERE d.purpose_id = pu.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count,
		        (SELECT GROUP_CONCAT(pr.membership_id) FROM purpose_responsibles pr WHERE pr.purpose_id = pu.id) AS purpose_resp
		 FROM allocations a
		 JOIN transactions t ON t.id = a.transaction_id AND t.org_id = ?1 AND t.suppressed = 0 AND t.amount_minor < 0
		 JOIN pockets p2 ON p2.id = t.pocket_id
		 JOIN purposes pu ON pu.id = a.purpose_id AND pu.kind = 'expense'
		 ORDER BY t.txn_date, t.id, a.id`,
		[orgId]
	);
	const owedPurposes: OwedPurposeTask[] = [];
	for (const row of rows) {
		const ready = purposeReady('expense', row.notes, row.evidence_count);
		if (ready && row.purpose_status !== 'changes_requested') continue;
		const purposeResp = (row.purpose_resp ?? '')
			.split(',')
			.map((id) => Number(id))
			.filter((id) => Number.isInteger(id) && id > 0);
		owedPurposes.push({
			txnId: row.transaction_id,
			txnDate: row.txn_date,
			purposeId: row.purpose_id,
			purposeName: row.purpose_name,
			counterparty: row.counterparty,
			pocketName: row.pocket_name,
			status: row.purpose_status,
			ready,
			effective: effectiveResponsibles(row.override_id, purposeResp, row.txn_responsible)
		});
	}
	const remainderRows = await qAll<{
		id: number;
		txn_date: string;
		counterparty: string;
		pocket_name: string;
		responsible_membership_id: number | null;
		remainder: number;
	}>(
		db,
		`SELECT t.id, t.txn_date, t.counterparty, p2.name AS pocket_name, t.responsible_membership_id, abs(t.amount_minor) - (SELECT COALESCE(SUM(a2.amount_minor), 0) FROM allocations a2 WHERE a2.transaction_id = t.id) AS remainder
		 FROM transactions t JOIN pockets p2 ON p2.id = t.pocket_id
		 WHERE t.org_id = ?1 AND t.suppressed = 0 AND t.amount_minor < 0
		   AND EXISTS (SELECT 1 FROM allocations a3 WHERE a3.transaction_id = t.id)
		   AND abs(t.amount_minor) <> (SELECT COALESCE(SUM(a4.amount_minor), 0) FROM allocations a4 WHERE a4.transaction_id = t.id)
		 ORDER BY t.txn_date, t.id`,
		[orgId]
	);
	return {
		owedPurposes,
		remainders: remainderRows.map((row) => ({
			txnId: row.id,
			txnDate: row.txn_date,
			counterparty: row.counterparty,
			pocketName: row.pocket_name,
			remainderMinor: row.remainder,
			responsibleId: row.responsible_membership_id
		})),
		allocatedTxnIds: [...new Set(rows.map((row) => row.transaction_id))]
	};
}

/** One submitted expense purpose awaiting an independent reviewer. */
export interface SubmittedPurposeTask {
	txnId: number;
	txnDate: string;
	purposeId: number;
	purposeName: string;
	counterparty: string;
	pocketName: string;
	/** Current or historical responsibles (purpose-level, allocation overrides,
	 * and the allocating transactions' members) barred from approving. */
	excluded: number[];
}

export async function submittedPurposeTasks(db: D1Database, orgId: number): Promise<SubmittedPurposeTask[]> {
	const rows = await qAll<{
		transaction_id: number;
		txn_date: string;
		counterparty: string;
		pocket_name: string;
		purpose_id: number;
		purpose_name: string;
		override_id: number | null;
		txn_responsible: number | null;
		purpose_resp: string | null;
		purpose_history: string | null;
		txn_history: string | null;
	}>(
		db,
		`SELECT a.transaction_id, t.txn_date, t.counterparty, p2.name AS pocket_name, t.responsible_membership_id AS txn_responsible,
		        a.purpose_id, pu.name AS purpose_name, a.responsible_membership_id AS override_id,
		        (SELECT GROUP_CONCAT(pr.membership_id) FROM purpose_responsibles pr WHERE pr.purpose_id = pu.id) AS purpose_resp,
		        (SELECT GROUP_CONCAT(ph.membership_id) FROM purpose_responsible_history ph WHERE ph.purpose_id = pu.id) AS purpose_history,
		        (SELECT GROUP_CONCAT(rh.membership_id) FROM responsible_history rh WHERE rh.transaction_id = t.id) AS txn_history
		 FROM allocations a
		 JOIN transactions t ON t.id = a.transaction_id AND t.org_id = ?1 AND t.suppressed = 0 AND t.amount_minor < 0
		 JOIN pockets p2 ON p2.id = t.pocket_id
		 JOIN purposes pu ON pu.id = a.purpose_id AND pu.kind = 'expense' AND pu.status = 'submitted'
				 AND NOT EXISTS (SELECT 1 FROM historical_approval_exemptions he WHERE he.org_id=?1 AND he.purpose_id=pu.id AND he.revoked_at IS NULL)
		 ORDER BY t.txn_date, t.id, a.id`,
		[orgId]
	);
	const ids = (joined: string | null): number[] =>
		(joined ?? '')
			.split(',')
			.map((id) => Number(id))
			.filter((id) => Number.isInteger(id) && id > 0);
	return rows.map((row) => ({
		txnId: row.transaction_id,
		txnDate: row.txn_date,
		purposeId: row.purpose_id,
		purposeName: row.purpose_name,
		counterparty: row.counterparty,
		pocketName: row.pocket_name,
		excluded: [...new Set([...ids(row.purpose_resp), ...ids(row.purpose_history), ...ids(row.txn_history), ...(row.override_id !== null ? [row.override_id] : []), ...(row.txn_responsible !== null ? [row.txn_responsible] : [])])]
	}));
}

// --------------------------------------------------------------- actions

function requirePermission(ctx: TxnCtx, permission: Permission): void {
	if (!ctx.can(permission)) {
		throw error(403, `Access denied: your role does not include “${PERMISSION_LABELS[permission]}”.`);
	}
}

const formStr = (form: FormData, key: string): string => {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
};

function destination(ctx: TxnCtx, id: number, message: string): never {
	redirect(303, `/org/${ctx.org.slug}/purposes/${id}?msg=${encodeURIComponent(message)}`);
}

function purposeAuditStatement(
	ctx: TxnCtx,
	p: PurposeRow,
	actorId: number,
	action: string,
	newStatus: string,
	details: unknown,
	token: string
): D1PreparedStatement {
	return ctx.db
		.prepare(
			'INSERT INTO purpose_audit (org_id,purpose_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS (SELECT 1 FROM purposes WHERE id=?2 AND org_id=?1 AND mutation_token=?9)'
		)
		.bind(ctx.org.id, p.id, actorId, action, p.status, newStatus, JSON.stringify(ctx.delegation ? { actor: `via AI client on behalf of ${ctx.user.name}`, clientId:ctx.delegation.clientId, details } : details), nowMs(), token);
}

async function commitPurposeMutation(ctx: TxnCtx, id: number, token: string, statements: D1PreparedStatement[]): Promise<boolean> {
 if(ctx.delegation){
 statements.unshift(ctx.db.prepare(`INSERT INTO mcp_write_guard(valid) SELECT CASE WHEN EXISTS(
 SELECT 1 FROM mcp_grants g JOIN memberships m ON m.user_id=g.user_id AND m.org_id=g.org_id JOIN roles r ON r.id=m.role_id AND r.org_id=m.org_id
 WHERE g.id=?1 AND g.user_id=?2 AND g.org_id=?3 AND g.client_id=?4 AND g.revoked_at IS NULL AND m.removed_at IS NULL AND m.invited=0
 AND EXISTS(SELECT 1 FROM mcp_tokens t WHERE t.grant_id=g.id AND t.token_hash=?5 AND t.expires_at>?6)
 AND EXISTS(SELECT 1 FROM json_each(g.scope_json) WHERE value='purposes:write')
 AND EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ApproveTransactions')
 AND EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions')
 AND NOT EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ExplainOwnActions')) THEN 1 ELSE 0 END`).bind(ctx.delegation.grantId,ctx.user.id,ctx.org.id,ctx.delegation.clientId,ctx.delegation.tokenHash,nowMs()));
 statements.push(ctx.db.prepare(`INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at,actor_type,delegated_user_id,client_id) SELECT NULL,?1,'ai.mcp.purpose_review',?2,'committed',?3,'AI',?4,?5 WHERE EXISTS(SELECT 1 FROM purposes WHERE id=?6 AND org_id=?1 AND mutation_token=?7)`).bind(ctx.org.id,`purpose:${id}`,nowMs(),ctx.user.id,ctx.delegation.clientId,id,token));
 }
	statements.push(
		ctx.db.prepare('SELECT mutation_token=?1 AS won FROM purposes WHERE id=?2 AND org_id=?3').bind(token, id, ctx.org.id)
	);
	const results = await ctx.db.batch<{ won: number }>(statements);
	const probe = results[results.length - 1]?.results ?? [];
	return probe[0]?.won === 1;
}

/** Atomically guarded purpose creation: the name is unique per (org, kind)
 * case-insensitively, enforced in the INSERT itself so concurrent creators
 * cannot both win (legacy migrated duplicates are preserved by NOT imposing
 * a unique index). Returns the new id, or null when the name already exists. */
export const INSERT_PURPOSE_GUARDED_SQL = `INSERT INTO purposes (org_id, name, kind, created_by_membership_id, created_at, updated_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE NOT EXISTS (
  SELECT 1 FROM purposes WHERE org_id = ?1 AND kind = ?3 AND lower(name) = lower(?2)
) RETURNING id`;

export async function createPurposeRow(
	db: D1Database,
	orgId: number,
	name: string,
	kind: PurposeKind,
	createdBy: number
): Promise<number | null> {
	const row = await db.prepare(INSERT_PURPOSE_GUARDED_SQL).bind(orgId, name, kind, createdBy, nowMs()).first<{ id: number }>();
	return row?.id ?? null;
}

/** POST ?/create on the purposes page. Names are unique per kind. */
export async function createPurpose(ctx: TxnCtx, form: FormData): Promise<never> {
	requirePermission(ctx, 'DocumentTransactions');
	const name = formStr(form, 'name').trim();
	const kind = formStr(form, 'kind');
	if (name === '' || byteLen(name) > 300) throw error(400, 'Supply a purpose name of up to 300 characters.');
	if (kind !== 'income' && kind !== 'expense') throw error(400, 'Choose whether the purpose records income or expense.');
	const mine = me(ctx);
	const createdId = await createPurposeRow(ctx.db, ctx.org.id, name, kind as PurposeKind, mine.id);
	if (createdId === null) throw error(400, `A ${kind} purpose with this name already exists.`);
	// Best-effort atomic pair: a failed audit row rolls the purpose back so an
	// action never leaves an unaudited record behind.
	try {
		await exec(
			ctx.db,
			'INSERT INTO purpose_audit (org_id,purpose_id,actor_membership_id,action,previous_status,new_status,details,created_at) VALUES (?1,?2,?3,?4,NULL,?5,?6,?7)',
			[ctx.org.id, createdId, mine.id, 'created', 'pending', '{}', nowMs()]
		);
	} catch (cause) {
		await exec(ctx.db, 'DELETE FROM purposes WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM allocations WHERE purpose_id = ?1)', [createdId]);
		throw cause;
	}
	redirect(303, `/org/${ctx.org.slug}/purposes/${createdId}?msg=${encodeURIComponent('Purpose created')}`);
}

/** Reopens an approved/submitted expense purpose after a substantive edit. */
function reopenStatement(ctx: TxnCtx, purposeId: number, previousStatus: string, token: string, actorId: number): D1PreparedStatement[] {
	return [
		ctx.db
			.prepare(
				"UPDATE purposes SET status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note='',updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND status IN ('approved','submitted','changes_requested') AND EXISTS (SELECT 1 FROM allocations WHERE purpose_id=?3 AND transaction_id IN (SELECT id FROM transactions WHERE mutation_token=?2))"
			)
			.bind(nowMs(), token, purposeId, ctx.org.id)
	];
	// ponytail: the purpose audit row for the reopen is written by the caller,
	// which knows the triggering action; the shared statement only resets status.
	void previousStatus;
	void actorId;
}

/** POST ?/notes. Single Notes field; a substantive change reopens approval. */
export async function savePurposeNotes(ctx: TxnCtx, purposeId: number, form: FormData): Promise<never> {
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	const responsibleIds = await purposeResponsibles(ctx.db, p.id);
	const mine = me(ctx);
	if (!ctx.can('DocumentTransactions') && !responsibleIds.includes(mine.id)) {
		throw error(403, 'Only a responsible member or a documentation role can edit these Notes.');
	}
	const notes = formStr(form, 'notes').trim();
	if (byteLen(notes) > 16000) throw error(400, 'Notes are limited to 16,000 characters.');
	if (notes === p.notes.trim()) return destination(ctx, purposeId, 'Notes unchanged');
	const token = randomHex(24);
	const reopen = p.kind === 'expense' && p.status !== 'pending';
	const statements: D1PreparedStatement[] = [
		ctx.db
			.prepare(
				`UPDATE purposes SET notes=?1,${reopen ? "status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note=''," : ''}updated_at=?2,revision=revision+1,mutation_token=?3 WHERE id=?4 AND org_id=?5 AND revision=?6`
			)
			.bind(notes, nowMs(), token, p.id, ctx.org.id, p.revision),
		purposeAuditStatement(ctx, p, mine.id, 'notes_updated', reopen ? 'pending' : p.status, { before: markdownToPlain(p.notes), after: markdownToPlain(notes) }, token)
	];
	const won = await commitPurposeMutation(ctx, purposeId, token, statements);
	if (!won) throw error(409, 'This purpose changed while you were editing. Reload and review the latest Notes.');
	return destination(ctx, purposeId, reopen ? 'Notes saved; the purpose requires review again' : 'Notes saved');
}

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean => sig.every((b, i) => bytes[i] === b);

/** Magic-byte content detection shared with the transaction evidence upload. */
export function sniffDocType(bytes: Uint8Array): string | null {
	if (startsWith(bytes, PDF_SIG)) return 'application/pdf';
	if (startsWith(bytes, PNG_SIG)) return 'image/png';
	if (startsWith(bytes, JPEG_SIG)) return 'image/jpeg';
	return null;
}

/** POST ?/evidence. Purpose-level supporting documents; attaching reopens. */
export async function uploadPurposeEvidence(ctx: TxnCtx, purposeId: number, form: FormData): Promise<never> {
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	const responsibleIds = await purposeResponsibles(ctx.db, p.id);
	const mine = me(ctx);
	if (!ctx.can('DocumentTransactions') && !responsibleIds.includes(mine.id)) {
		throw error(403, 'Only a responsible member or a documentation role can attach documents.');
	}
	const value = form.get('file');
	const file = value instanceof File ? value : null;
	if (file === null) throw error(400, 'Choose a supporting document.');
	if (formStr(form, 'revision') !== String(p.revision)) {
		throw error(409, 'This purpose is out of date. Reload before attaching a document.');
	}
	if (file.size === 0 || file.size > 10 * 1024 * 1024) throw error(400, 'Supporting documents must be between 1 byte and 10 MB.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const contentType = sniffDocType(bytes);
	if (contentType === null) throw error(400, 'Upload a PDF, PNG, or JPEG document.');
	const note = formStr(form, 'note');
	if (byteLen(note) > 2000) throw error(400, 'Document note must be at most 2,000 characters.');
	const bucket: R2Bucket | null = ctx.env.DOCUMENTS ?? null;
	if (!bucket) throw error(503, 'Private document storage is not configured.');
	const token = randomHex(24);
	const key = `org/${ctx.org.id}/purposes/${purposeId}/${token}`;
	await bucket.put(key, bytes);
	const reopen = p.kind === 'expense' && p.status !== 'pending';
	const statements: D1PreparedStatement[] = [
		ctx.db
			.prepare(
				`UPDATE purposes SET ${reopen ? "status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note=''," : ''}updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5`
			)
			.bind(nowMs(), token, p.id, ctx.org.id, p.revision),
		ctx.db
			.prepare(
				"INSERT INTO documents(org_id,purpose_id,kind,r2_key,filename,content_type,size_bytes,note,uploaded_by_membership_id,created_at) SELECT ?1,?2,'evidence',?3,?4,?5,?6,?7,?8,?9 WHERE EXISTS(SELECT 1 FROM purposes WHERE id=?2 AND mutation_token=?10)"
			)
			.bind(ctx.org.id, purposeId, key, file.name, contentType, bytes.length, note, mine.id, nowMs(), token),
		purposeAuditStatement(ctx, p, mine.id, 'evidence_attached', reopen ? 'pending' : p.status, { filename: file.name, note }, token)
	];
	const won = await commitPurposeMutation(ctx, purposeId, token, statements);
	if (!won) throw error(409, 'The purpose changed during upload. Reload and attach the document again.');
	return destination(ctx, purposeId, reopen ? 'Evidence attached; the purpose requires review again' : 'Evidence attached');
}

/** POST ?/message. Discussion messages are permanent and never reopen
 * approval; every message notifies responsibles plus mentions. */
export async function postPurposeMessage(ctx: TxnCtx, purposeId: number, form: FormData): Promise<never> {
	requirePermission(ctx, 'CommentTransactions');
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	const body = formStr(form, 'body').trim();
	if (body === '' || byteLen(body) > 16000) throw error(400, 'Write a message of up to 16,000 characters.');
	const mine = me(ctx);
	const responsibleIds = await purposeResponsibles(ctx.db, p.id);
	await exec(
		ctx.db,
		'INSERT INTO purpose_messages (org_id,purpose_id,author_membership_id,body_md,created_at) VALUES (?1,?2,?3,?4,?5)',
		[ctx.org.id, purposeId, mine.id, body, nowMs()]
	);
	const recipients = purposeNoticeRecipients(ctx.memberRows, ctx.roleRows, ctx.user.id, responsibleIds, body);
	if (recipients.length > 0) {
		await enqueuePurposeNotices(ctx.db, ctx.org, purposeId, recipients, 'discussion');
		await ctx.deliverMail?.();
	}
	return destination(ctx, purposeId, 'Message posted');
}

/** POST ?/responsibles. Reassignment carries a mandatory justification that
 * is logged permanently in the discussion and history; newly responsible
 * members and mentions in the justification are notified (dedup, sender
 * excluded). */
export async function setPurposeResponsibles(ctx: TxnCtx, purposeId: number, form: FormData): Promise<never> {
	requirePermission(ctx, 'DocumentTransactions');
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	const ids = form
		.getAll('responsible_id[]')
		.map((value) => (typeof value === 'string' && /^[0-9]{1,15}$/.test(value) ? Number(value) : null))
		.filter((id): id is number => id !== null);
	for (const id of ids) {
		if (activeMem(ctx.memberRows, id) === null) throw error(400, 'Responsible members must be active members of this organization.');
	}
	const next = [...new Set(ids)].sort((a, b) => a - b);
	const justification = formStr(form, 'justification').trim();
	if (justification === '' || byteLen(justification) > 4000) {
		throw error(400, 'A reassignment justification of up to 4,000 characters is required.');
	}
	const before = (await purposeResponsibles(ctx.db, p.id)).sort((a, b) => a - b);
	if (before.join(',') === next.join(',')) return destination(ctx, purposeId, 'Responsibility unchanged');
	const mine = me(ctx);
	const now = nowMs();
	const token = randomHex(24);
	const names = (list: number[]) => list.map((id) => memName(ctx, id) ?? 'Unknown').join(', ') || 'the transaction responsible member';
	const messageBody = `**Responsibility updated** — now ${names(next)}.\n\n${justification}`;
	const reopen = p.kind === 'expense' && p.status !== 'pending';
	const statements: D1PreparedStatement[] = [
		ctx.db
			.prepare(
				`UPDATE purposes SET ${reopen ? "status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note=''," : ''}updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5`
			)
			.bind(now, token, p.id, ctx.org.id, p.revision),
		ctx.db.prepare('DELETE FROM purpose_responsibles WHERE purpose_id=?1 AND EXISTS(SELECT 1 FROM purposes WHERE id=?1 AND mutation_token=?2)').bind(p.id, token)
	];
	for (const id of next) {
		statements.push(
			ctx.db
				.prepare('INSERT INTO purpose_responsibles (purpose_id,membership_id,since) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM purposes WHERE id=?1 AND mutation_token=?4)')
				.bind(p.id, id, now, token)
		);
	}
	for (const id of new Set([...before, ...next])) {
		statements.push(
			ctx.db
				.prepare('INSERT OR IGNORE INTO purpose_responsible_history (purpose_id,membership_id,since) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM purposes WHERE id=?1 AND mutation_token=?4)')
				.bind(p.id, id, now, token)
		);
	}
	statements.push(
		ctx.db
			.prepare(
				'INSERT INTO purpose_messages (org_id,purpose_id,author_membership_id,body_md,created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS (SELECT 1 FROM purposes WHERE id=?2 AND org_id=?1 AND mutation_token=?6)'
			)
			.bind(ctx.org.id, p.id, mine.id, messageBody, now, token),
		purposeAuditStatement(ctx, p, mine.id, 'responsibles_changed', reopen ? 'pending' : p.status, { before, after: next, justification }, token)
	);
	const won = await commitPurposeMutation(ctx, purposeId, token, statements);
	if (!won) throw error(409, 'The purpose changed while reassigning. Reload and try again.');
	const added = next.filter((id) => !before.includes(id));
	const recipients = purposeNoticeRecipients(ctx.memberRows, ctx.roleRows, ctx.user.id, added, justification);
	if (recipients.length > 0) {
		await enqueuePurposeNotices(ctx.db, ctx.org, purposeId, recipients, 'assignment');
		await ctx.deliverMail?.();
	}
	return destination(ctx, purposeId, reopen ? 'Responsibility updated; the purpose requires review again' : 'Responsibility updated');
}

/** POST ?/approve or ?/request_changes. Per-purpose review: only from
 * submitted, never by a current or former responsible member. */
export async function reviewPurpose(ctx: TxnCtx, purposeId: number, form: FormData, changes: boolean): Promise<never> {
	requirePermission(ctx, 'ApproveTransactions');
	const p = await purposeById(ctx.db, ctx.org.id, purposeId);
	if (!p) throw error(404, 'Purpose not found.');
	if (p.kind !== 'expense') throw error(400, 'Income purposes require no review.');
	const note = formStr(form, 'note').trim();
	if (byteLen(note) > 8000 || (changes && note === '')) {
		throw error(400, 'Supply a review note of up to 8,000 characters.');
	}
	if (formStr(form, 'revision') !== String(p.revision)) {
		throw error(409, 'This purpose changed. Reload before recording a decision.');
	}
	const responsibleIds = await purposeResponsibles(ctx.db, p.id);
	const historyIds = await purposeResponsibleHistory(ctx.db, p.id);
	const mine = me(ctx);
	// Effective responsibility decides: an allocation override, else these
	// purpose members, else the allocating transaction's member (current or
	// historical, so a reassignment cannot launder self-approval).
	const allocRows = await allocationsOfPurpose(ctx.db, p.id);
	const excluded = new Set<number>([...responsibleIds, ...historyIds]);
	for (const allocation of allocRows) {
		if (allocation.responsible_membership_id !== null) excluded.add(allocation.responsible_membership_id);
		const txn = await qOne<{ responsible_membership_id: number | null }>(
			ctx.db,
			'SELECT responsible_membership_id FROM transactions WHERE id = ?1 AND org_id = ?2',
			[allocation.transaction_id, ctx.org.id]
		);
		if (txn?.responsible_membership_id !== null && txn?.responsible_membership_id !== undefined) {
			excluded.add(txn.responsible_membership_id);
		}
		const txnHistory = await qAll<{ membership_id: number }>(
			ctx.db,
			'SELECT membership_id FROM responsible_history WHERE transaction_id = ?1',
			[allocation.transaction_id]
		);
		for (const row of txnHistory) excluded.add(row.membership_id);
	}
	if (!mayApprovePurpose([...excluded], [], mine.id)) {
		throw error(403, 'A member responsible for this purpose, now or before, cannot approve it.');
	}
	if (p.status !== 'submitted') {
		throw error(400, 'Only a purpose awaiting review can receive a decision.');
	}
	const token = randomHex(24);
	const status = changes ? 'changes_requested' : 'approved';
	const statements: D1PreparedStatement[] = [
		changes
			? ctx.db
					.prepare(
							"UPDATE purposes SET status='changes_requested',approval_note=?1,updated_at=?2,revision=revision+1,mutation_token=?3 WHERE id=?4 AND org_id=?5 AND revision=?6"
					)
					.bind(note, nowMs(), token, p.id, ctx.org.id, p.revision)
			: ctx.db
					.prepare(
							"UPDATE purposes SET status='approved',approved_by_membership_id=?1,approved_at=?2,approval_note=?3,updated_at=?4,revision=revision+1,mutation_token=?5 WHERE id=?6 AND org_id=?7 AND revision=?8"
					)
					.bind(mine.id, nowMs(), note, nowMs(), token, p.id, ctx.org.id, p.revision),
		purposeAuditStatement(ctx, p, mine.id, changes ? 'changes_requested' : 'approved', status, { note }, token)
	];
	const won = await commitPurposeMutation(ctx, purposeId, token, statements);
	if (!won) throw error(409, 'The purpose changed during review. Reload and try again.');
	return destination(ctx, purposeId, changes ? 'Changes requested' : 'Purpose approved');
}

