// Server logic for the complete transaction journey, ported from
// src/web/txns.rs: detail view model, documentation edits, submit/review,
// comments, suppression, evidence upload/download, manual creation.
//
// Bank records keep signed amounts; purpose splits are positive magnitudes
// summing to abs(bank amount). Every mutation commits through one atomic D1
// batch guarded by a revision CAS (`WHERE ... AND revision=?`); its winner is
// probed inside the same batch with the random operation token (never
// meta.changes — triggers inflate that count), and every audit row is gated by
// the same token so a losing run records nothing.

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	assertSameOrigin,
	assertFormCsrf,
	bindings,
	requireLogin,
	shellContext,
	type UserRow
} from './auth';
import type { Session } from './session';
import { committed } from './audit';
import { actionLabel } from './audit_rules';
import { counterpartyDisplay } from './ledger';
import { permissionsFor, type Permission } from './permissions';
import { exec, nowMs, qAll, qOne } from './db';
import { randomHex } from './tokens';
import {
	activeMem,
	buildDomTxn,
	commentsOf,
	docById,
	evidenceOf,
	historyOf,
	memActive,
	memsOfOrg,
	orgBySlug,
	pocketsOf,
	rolesOfOrg,
	splitsOf,
	txnById,
	type MemRow,
	type OrgRow,
	type RoleRow,
	type SplitRow,
	type TxnRow
} from './rows';
import { enqueueAssignment, enqueueMentions } from './txns_notify';
import {
	approveTransaction,
	ALL_PERMISSIONS,
	documentationOwed,
	incomeComplete,
	incomeRecipients,
	requestChanges as domainRequestChanges,
	statusLabel as domainStatusLabel,
	submitTransaction,
	userMessage,
	validateDocumentation,
	type DomTxn,
	type DomainError
} from '$lib/domain';
import { fmtMoney, fmtSize, fmtTs, parseRupiah, rupiahInput, validDate, validTime } from '$lib/fmt';
import { r2Bytes, type D1PreparedStatement, type R2Bucket } from '$lib/d1';

// --------------------------------------------------------------- request ctx

/** Everything the journey handlers need: identity, org rows (including the
 * notification and income-role columns auth.ts's narrower type omits), fresh
 * membership/role rows, and the acting permission set. */
export interface TxnCtx {
	config: import('./auth').AppConfig;
	session: Session;
	user: UserRow;
	db: import('$lib/d1').D1Database;
	/** Worker bindings (DOCUMENTS bucket for evidence upload/download). */
	env: import('$lib/d1').Bindings;
	org: OrgRow;
	memberRows: MemRow[];
	roleRows: RoleRow[];
	can(permission: Permission): boolean;
}

const memberRefs = (memberRows: readonly MemRow[]) =>
	memberRows.map((row) => ({ userId: row.user_id, roleId: row.role_id, active: row.removed_at === null }));

const roleRefs = (roleRows: readonly RoleRow[]) => roleRows.map((row) => ({ id: row.id, permissions: row.permissions }));

function buildCtx(
	config: import('./auth').AppConfig,
	session: Session,
	user: UserRow,
	db: import('$lib/d1').D1Database,
	env: import('$lib/d1').Bindings,
	org: OrgRow,
	memberRows: MemRow[],
	roleRows: RoleRow[]
): TxnCtx {
	const permissions = permissionsFor(memberRefs(memberRows), roleRefs(roleRows), user.id);
	return {
		config,
		session,
		user,
		db,
		env,
		org,
		memberRows,
		roleRows,
		can: (permission: Permission) => permissions.has(permission)
	};
}

/** Organizer-facing permission wording; mirrors perm_label in
 * src/domain_map.rs and PERMISSION_LABELS in $lib/domain. */
function permissionLabel(permission: Permission): string {
	const labels: Record<Permission, string> = {
		ViewTransactions: 'View transactions',
		CommentTransactions: 'Comment on transactions',
		DocumentTransactions: 'Document transactions',
		ApproveTransactions: 'Approve or request changes',
		ImportStatements: 'Import statements and manage actor mappings',
		ManageRoles: 'Manage roles',
		ManageMembers: 'Manage members',
		ManageNotifications: 'Manage notifications',
		SuppressNotifications: 'Suppress transaction notifications',
		UpdateStock: 'Update stock'
	};
	return labels[permission];
}

type CtxEvent = Parameters<typeof requireLogin>[0];

/** Active membership of `slug`, optionally requiring one permission. Ports
 * require_active_member (no permission) and require_member (with one) from
 * src/web/mod.rs; the org row is the full row so the income-routing and
 * notification columns are available. */
export async function requireOrg(event: CtxEvent, slug: string, permission?: Permission): Promise<TxnCtx> {
	const login = await requireLogin(event);
	const org = await orgBySlug(login.db, slug);
	if (!org) throw error(404, 'Unknown organization.');
	const memberRows = await memsOfOrg(login.db, org.id);
	const roleRows = await rolesOfOrg(login.db, org.id);
	const mine = memberRows.find((m) => m.user_id === login.user.id);
	if (!mine || !memActive(mine)) {
		throw error(403, 'Active organization membership required.');
	}
	const ctx = buildCtx(login.config, login.session, login.user, login.db, bindings(event.platform), org, memberRows, roleRows);
	if (permission !== undefined && !ctx.can(permission)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(permission)}”.`);
	}
	return ctx;
}

/** Shared action preamble: same-origin, body parse, session CSRF. */
export async function actionForm(event: CtxEvent, session: Session): Promise<FormData> {
	assertSameOrigin(event.request, event.url);
	const form = await event.request.formData();
	assertFormCsrf(form.get('csrf_token'), session);
	return form;
}

// -------------------------------------------------------------- form helpers

const formStr = (form: FormData, key: string): string => {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
};

const formStrings = (form: FormData, key: string): string[] =>
	form.getAll(key).map((value) => (typeof value === 'string' ? value : ''));

const formHas = (form: FormData, key: string): boolean => form.get(key) !== null;

/** Strict i64-shaped integer from a form field; null when absent or malformed. */
function formInt(form: FormData, key: string): number | null {
	const raw = formStr(form, key).trim();
	if (raw === '' || !/^-?[0-9]{1,18}$/.test(raw)) return null;
	return Number(raw);
}

/** Rust string .len() is bytes; keep the size limits byte-exact. */
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Numeric route id, or 0 (→ treated as missing) when absent/malformed.
 * Ports the `parse().unwrap_or(0)` id handling of the Rust handlers. */
export function numericPathId(raw: string | undefined): number {
	raw = typeof raw === 'string' && /^[0-9]{1,15}$/.test(raw) ? raw : '';
	return raw === '' ? 0 : Number(raw);
}

function me(ctx: TxnCtx): MemRow {
	const row = ctx.memberRows.find((m) => m.user_id === ctx.user.id);
	if (!row || !memActive(row)) throw error(403, 'Active organization membership required.');
	return row;
}

const memName = (ctx: TxnCtx, id: number | null | undefined): string | null =>
	id === null || id === undefined ? null : (ctx.memberRows.find((m) => m.id === id)?.name ?? null);

async function incomeRecipientsOf(ctx: TxnCtx, t: TxnRow): Promise<number[]> {
	const pocket = await qOne<{ owner_membership_id: number | null }>(
		ctx.db,
		'SELECT owner_membership_id FROM pockets WHERE id=?1 AND org_id=?2',
		[t.pocket_id, ctx.org.id]
	);
	return incomeRecipients(
		ctx.org.income_explanation_role_id,
		pocket?.owner_membership_id ?? null,
		ctx.memberRows.map((m) => ({ id: m.id, roleId: m.role_id, active: memActive(m) }))
	);
}

/** DocumentTransactions, or an income recipient for income movements. */
async function mayDocument(ctx: TxnCtx, t: TxnRow): Promise<boolean> {
	if (ctx.can('DocumentTransactions')) return true;
	return t.amount_minor > 0 && (await incomeRecipientsOf(ctx, t)).includes(me(ctx).id);
}

interface FullTxn {
	t: TxnRow;
	splits: SplitRow[];
	comments: Awaited<ReturnType<typeof commentsOf>>;
	evidence: Awaited<ReturnType<typeof evidenceOf>>;
}

async function loadFull(db: import('$lib/d1').D1Database, orgId: number, txnId: number): Promise<FullTxn | null> {
	const t = await txnById(db, orgId, txnId);
	if (!t) return null;
	return {
		t,
		splits: await splitsOf(db, txnId),
		comments: await commentsOf(db, txnId),
		evidence: await evidenceOf(db, txnId)
	};
}

function destination(ctx: TxnCtx, id: number, message: string): never {
	redirect(303, `/org/${ctx.org.slug}/transactions/${id}?msg=${encodeURIComponent(message)}`);
}

function requireRevision(form: FormData, t: TxnRow): void {
	if (formInt(form, 'revision') !== t.revision) {
		throw error(409, 'This form is out of date. Reload the transaction before changing or reviewing it.');
	}
}

// ------------------------------------------------------------ mutation commits

function auditStatement(
	ctx: TxnCtx,
	t: TxnRow,
	action: string,
	status: string,
	details: unknown,
	token: string
): D1PreparedStatement {
	return ctx.db
		.prepare(
			'INSERT INTO transaction_audit (org_id,transaction_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS (SELECT 1 FROM transactions WHERE id=?2 AND org_id=?1 AND mutation_token=?9)'
		)
		.bind(ctx.org.id, t.id, me(ctx).id, action, t.status, status, JSON.stringify(details), nowMs(), token);
}

/** Transactional audit_events row, committed in the same batch and gated by
 * the operation token so a losing run records nothing. */
function auditEventStatement(ctx: TxnCtx, id: number, action: string, token: string): D1PreparedStatement {
	return ctx.db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,?3,?4,'committed',?5 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?6 AND org_id=?2 AND mutation_token=?7)"
		)
		.bind(ctx.user.id, ctx.org.id, action, `transaction:${id}`, nowMs(), id, token);
}

/** Runs one atomic batch and reports whether THIS operation won the revision
 * CAS: the winner probe reads the operation token inside the batch instead of
 * interpreting D1's meta.changes aggregate (triggers inflate that count). */
async function commitMutation(ctx: TxnCtx, id: number, token: string, statements: D1PreparedStatement[]): Promise<boolean> {
	statements.push(
		ctx.db
			.prepare('SELECT mutation_token=?1 AS won FROM transactions WHERE id=?2 AND org_id=?3')
			.bind(token, id, ctx.org.id)
	);
	const results = await ctx.db.batch<{ won: number }>(statements);
	const probe = results[results.length - 1]?.results ?? [];
	return probe[0]?.won === 1;
}

// ------------------------------------------------------------- split parsing

export interface ValidSplit {
	label: string;
	amount_minor: number;
	responsible: number | null;
}

export type SplitParseResult = { splits: ValidSplit[]; error: null } | { splits: null; error: string };

/** Parse + validate the split form arrays. Purpose amounts are positive
 * magnitudes (the bank record carries the sign); blank untouched rows are
 * dropped. Port of parse_splits in src/web/txns.rs. */
export function parseSplits(labels: string[], amounts: string[], members: string[], bankAbs: number): SplitParseResult {
	if (labels.length !== amounts.length || labels.length !== members.length) {
		return { splits: null, error: 'purpose rows are malformed' };
	}
	if (labels.length > 100) {
		return { splits: null, error: 'At most 100 purposes can be recorded on one transaction.' };
	}
	const out: ValidSplit[] = [];
	for (let i = 0; i < labels.length; i += 1) {
		const label = (labels[i] ?? '').trim();
		const amount = (amounts[i] ?? '').trim();
		if (label === '' && amount === '') continue; // untouched default row
		if (label === '') return { splits: null, error: `purpose row ${i + 1} has an empty label` };
		if (byteLen(label) > 300) return { splits: null, error: `purpose row ${i + 1} label too long` };
		const parsed = parseRupiah(amount);
		if (parsed === null) return { splits: null, error: `purpose row ${i + 1} has an invalid amount` };
		if (parsed <= 0) {
			return {
				splits: null,
				error: `purpose row ${i + 1} amount must be a positive magnitude (the bank record carries the sign)`
			};
		}
		const member = (members[i] ?? '').trim();
		let responsible: number | null = null;
		if (member !== '') {
			if (!/^-?[0-9]{1,18}$/.test(member)) return { splits: null, error: 'purpose row has an invalid member' };
			responsible = Number(member);
		}
		out.push({ label, amount_minor: parsed, responsible });
	}
	// Overflow-exact total (parent invariant): BigInt keeps the comparison exact
	// even for absurd magnitudes, matching the i128 fold in Rust.
	let total = 0n;
	for (const split of out) total += BigInt(split.amount_minor);
	if (out.length > 0 && total !== BigInt(bankAbs)) {
		return { splits: null, error: `Purpose allocations must add up to ${fmtMoney(bankAbs)}.` };
	}
	return { splits: out, error: null };
}

/** Parent invariant: every assigned responsible member (transaction-level and
 * explicit split-level) must be an active member of this organization. */
export function validateResponsiblesActive(
	t: Pick<TxnRow, 'responsible_membership_id'>,
	splits: ReadonlyArray<Pick<SplitRow, 'responsible_membership_id'>>,
	mems: readonly MemRow[]
): string | null {
	const check = (id: number | null | undefined, what: string): string | null => {
		if (id === null || id === undefined) return null;
		const member = mems.find((m) => m.id === id);
		if (!member) return `${what} references an unknown member`;
		if (!memActive(member)) return `${what} is assigned to removed member ${member.name}`;
		return null;
	};
	const txnLevel = check(t.responsible_membership_id, 'Responsible member');
	if (txnLevel) return txnLevel;
	for (const split of splits) {
		const splitLevel = check(split.responsible_membership_id, 'Purpose responsible member');
		if (splitLevel) return splitLevel;
	}
	return null;
}

interface SnapshotShape {
	explanation: string;
	responsible_member_id: number | null;
	evidence_unavailable_reason: string;
	purposes: Array<{ label: string; amount_minor: number; responsible_member_id: number | null }>;
}

function snapshot(
	t: TxnRow,
	splits: ReadonlyArray<Pick<SplitRow, 'label' | 'amount_minor' | 'responsible_membership_id'>>
): SnapshotShape {
	return {
		explanation: t.explanation,
		responsible_member_id: t.responsible_membership_id,
		evidence_unavailable_reason: t.evidence_unavailable_reason,
		purposes: splits.map((s) => ({
			label: s.label,
			amount_minor: s.amount_minor,
			responsible_member_id: s.responsible_membership_id
		}))
	};
}

const snapshotEqual = (a: SnapshotShape, b: SnapshotShape): boolean => JSON.stringify(a) === JSON.stringify(b);

const recipientsOf = (
	record: Pick<TxnRow, 'responsible_membership_id'>,
	parts: ReadonlyArray<Pick<SplitRow, 'responsible_membership_id'>>
): Set<number> => {
	const ids = new Set<number>();
	if (record.responsible_membership_id !== null) ids.add(record.responsible_membership_id);
	for (const part of parts) {
		if (part.responsible_membership_id !== null) ids.add(part.responsible_membership_id);
	}
	return ids;
};

const sameSet = (a: Set<number>, b: Set<number>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

// -------------------------------------------------------------- history facts

/** One rendered history row: (label, value). Values may contain newlines
 * (purpose lists, before→after diffs). */
export type FactRow = [string, string];

/** Transaction history `details` JSON rendered as organizer-facing rows.
 * Internal keys and minor units never reach the page; unknown shapes fall back
 * to a single "Details" row with the raw text. Port of history_facts in
 * src/domain_map.rs. */
export function historyFacts(details: string, memberName: (id: number) => string | null): FactRow[] {
	let value: unknown;
	try {
		value = JSON.parse(details);
	} catch {
		return details.trim() === '' ? [] : [['Details', details]];
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
	const map = value as Record<string, unknown>;
	const name = (v: unknown): string => {
		const id = typeof v === 'number' && Number.isInteger(v) ? v : null;
		return (id !== null && memberName(id)) || 'Unassigned';
	};
	const asMoney = (v: unknown): string => (typeof v === 'number' && Number.isInteger(v) ? fmtMoney(v) : '—');
	const snapshotRows = (snap: unknown): FactRow[] => {
		const rows: FactRow[] = [];
		if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return rows;
		const s = snap as Record<string, unknown>;
		if (typeof s.explanation === 'string') {
			rows.push(['Explanation', s.explanation === '' ? '—' : s.explanation]);
		}
		if ('responsible_member_id' in s) {
			rows.push(['Responsible member', name(s.responsible_member_id)]);
		}
		if (Array.isArray(s.purposes)) {
			const list = s.purposes.map((entry) => {
				const x = (entry ?? {}) as Record<string, unknown>;
				const label = typeof x.label === 'string' ? x.label : '—';
				return `${label} · ${asMoney(x.amount_minor)} · ${name(x.responsible_member_id)}`;
			});
			rows.push(['Purposes', list.length === 0 ? 'None' : list.join('\n')]);
		}
		if (typeof s.evidence_unavailable_reason === 'string' && s.evidence_unavailable_reason !== '') {
			rows.push(['Document-unavailable reason', s.evidence_unavailable_reason]);
		}
		return rows;
	};
	if ('before' in map && 'after' in map) {
		const before = snapshotRows(map.before);
		const after = snapshotRows(map.after);
		const rows: FactRow[] = [];
		for (const [label, afterValue] of after) {
			const beforeValue = before.find(([l]) => l === label)?.[1];
			if (beforeValue === afterValue) continue; // unchanged rows are omitted
			rows.push([label, beforeValue !== undefined ? `${beforeValue}\n→ ${afterValue}` : afterValue]);
		}
		if (rows.length === 0) rows.push(['Changes', 'No substantive change']);
		return rows;
	}
	const rows: FactRow[] = [];
	for (const [key, entry] of Object.entries(map)) {
		const label = key === 'note' ? 'Note' : key === 'reason' ? 'Reason' : key === 'filename' ? 'File' : key;
		const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
		if (text !== '') rows.push([label, text]);
	}
	return rows;
}

// ------------------------------------------------------------------- detail

export interface AuditEntryView {
	action: string;
	actionLabel: string;
	previousStatus: string;
	newStatus: string;
	previousLabel: string;
	newLabel: string;
	facts: FactRow[];
	authorName: string;
	createdAt: string;
}

export interface TxnDetail {
	id: number;
	revision: number;
	isIncome: boolean;
	incomeComplete: boolean;
	date: string;
	time: string;
	counterparty: string;
	counterpartyDisplay: { name: string; bankAccount: string | null };
	transactionType: string;
	bankNotes: string;
	amountMinor: number;
	amountMagnitudeMinor: number;
	amount: string;
	balanceMinor: number | null;
	balance: string;
	bankId: string;
	pocketName: string;
	explanation: string;
	evidenceUnavailableReason: string;
	responsibleName: string | null;
	responsibleMemberId: number | null;
	responsibleInactive: boolean;
	status: string;
	statusLabel: string;
	needsDetails: boolean;
	suppressed: boolean;
	suppressedReason: string;
	missing: string[];
	splits: Array<{
		label: string;
		amountMinor: number;
		amount: string;
		rupiah: string;
		responsibleName: string | null;
		responsibleMemberId: number | null;
	}>;
	totals: { amountMinor: number; splitTotalMinor: number; balanced: boolean } | null;
	members: Array<{ id: number; name: string; handle: string }>;
	evidence: Array<{ id: number; filename: string; size: number; sizeDisplay: string; note: string; url: string }>;
	comments: Array<{ authorName: string; body: string; createdAt: string }>;
	approval: { eligible: boolean; ineligibleReason: string | null };
	reviewDecision: { status: string; statusLabel: string; authorName: string; createdAt: string; note: string } | null;
	audit: AuditEntryView[];
	can: {
		edit: boolean;
		incomeNotes: boolean;
		approve: boolean;
		requestChanges: boolean;
		comment: boolean;
		suppress: boolean;
		upload: boolean;
		submit: boolean;
	};
}

/** Full detail view model, ported from the detail handler in src/web/txns.rs.
 * Throws 404 for a foreign id and 403 when the viewer has neither
 * ViewTransactions nor income-recipient access. */
export async function txnDetail(ctx: TxnCtx, txnId: number): Promise<TxnDetail> {
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, splits, comments, evidence } = loaded;
	const mine = me(ctx);
	const incomeAccess = t.amount_minor > 0 && (await incomeRecipientsOf(ctx, t)).includes(mine.id);
	if (!ctx.can('ViewTransactions') && !incomeAccess) {
		throw error(403, 'Transaction access denied.');
	}
	const canDocument = ctx.can('DocumentTransactions') || incomeAccess;
	const pocket = await qOne<{ name: string }>(ctx.db, 'SELECT name FROM pockets WHERE id = ?1', [t.pocket_id]);
	const exclusions = await historyOf(ctx.db, t.id);
	const dom = buildDomTxn(t, splits, evidence, ctx.memberRows, exclusions);
	const domOrg = decisionOrg(ctx);

	// Approval eligibility probed with the real domain rule.
	const probe = approveTransaction(domOrg, dom, ctx.user.id);
	const approval = probe === null ? { eligible: true, ineligibleReason: null } : { eligible: false, ineligibleReason: userMessage(probe) };

	const bankAbs = Math.abs(t.amount_minor);
	let splitTotal = 0n;
	for (const s of splits) splitTotal += BigInt(s.amount_minor);
	const totals =
		splits.length === 0
			? null
			: {
					amountMinor: bankAbs,
					splitTotalMinor: Number(splitTotal),
					balanced: splitTotal === BigInt(bankAbs)
			  };

	const responsiblesOk = validateResponsiblesActive(t, splits, ctx.memberRows) === null;
	// needs_details: documentation still owed (Draft/ChangesRequested domain
	// states), derived from completeness; submit/approve enforce the full rule.
	const docsComplete = validateDocumentation(dom) === null && responsiblesOk && activeMem(ctx.memberRows, t.responsible_membership_id) !== null;
	const needsDetails = t.amount_minor > 0 ? !incomeComplete(t.explanation) : documentationOwed(t.status, docsComplete);

	// What the "Still needed" notice should actually list.
	const missing: string[] = [];
	if (t.explanation.trim() === '') missing.push('an explanation');
	if (activeMem(ctx.memberRows, t.responsible_membership_id) === null) missing.push('an active responsible member');
	if (splits.length === 0) {
		missing.push('at least one purpose');
	} else if (splitTotal !== BigInt(bankAbs)) {
		missing.push('purposes that add up to the bank amount');
	}
	if (evidence.length === 0 && t.evidence_unavailable_reason.trim() === '') {
		missing.push('supporting documents or a document-unavailable reason');
	}

	interface AuditViewRow {
		action: string;
		previous_status: string;
		new_status: string;
		details: string;
		author_name: string;
		created_at: number;
	}
	const auditRows = await qAll<AuditViewRow>(
		ctx.db,
		'SELECT a.action, a.previous_status, a.new_status, a.details, a.created_at, u.name AS author_name FROM transaction_audit a JOIN memberships m ON m.id = a.actor_membership_id JOIN users u ON u.id = m.user_id WHERE a.org_id = ?1 AND a.transaction_id = ?2 ORDER BY a.id DESC LIMIT 100',
		[ctx.org.id, txnId]
	);

	// Keep the latest review decision readable without opening raw audit history.
	let reviewDecision: TxnDetail['reviewDecision'] = null;
	const decision = auditRows.find((a) => a.action === 'approved' || a.action === 'changes_requested');
	if (decision) {
		let note = '';
		try {
			const parsed: unknown = JSON.parse(decision.details);
			if (parsed !== null && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).note === 'string') {
		const noteValue = (parsed as Record<string, unknown>).note;
		if (typeof noteValue === 'string') note = noteValue;
			}
		} catch {
			note = '';
		}
		reviewDecision = {
			status: decision.new_status,
			statusLabel: domainStatusLabel(decision.new_status),
			authorName: decision.author_name,
			createdAt: fmtTs(decision.created_at),
			note
		};
	}

	const audit = auditRows.map((a) => ({
		action: a.action,
		actionLabel: actionLabel(a.action),
		previousStatus: a.previous_status,
		newStatus: a.new_status,
		previousLabel: domainStatusLabel(a.previous_status),
		newLabel: domainStatusLabel(a.new_status),
		facts: historyFacts(a.details, (id) => memName(ctx, id)),
		authorName: a.author_name,
		createdAt: fmtTs(a.created_at)
	}));

	return {
		id: t.id,
		revision: t.revision,
		isIncome: t.amount_minor > 0,
		incomeComplete: incomeComplete(t.explanation),
		date: t.txn_date,
		time: t.txn_time ?? '',
		counterparty: t.counterparty,
		counterpartyDisplay: counterpartyDisplay(t.counterparty),
		transactionType: t.transaction_type,
		bankNotes: t.bank_notes,
		amountMinor: t.amount_minor,
		amountMagnitudeMinor: bankAbs,
		amount: fmtMoney(t.amount_minor),
		balanceMinor: t.balance_minor,
		balance: fmtMoney(t.balance_minor ?? 0),
		bankId: t.bank_id ?? '',
		pocketName: pocket?.name ?? '',
		explanation: t.explanation,
		evidenceUnavailableReason: t.evidence_unavailable_reason,
		responsibleName: memName(ctx, t.responsible_membership_id),
		responsibleMemberId: t.responsible_membership_id,
		responsibleInactive: t.responsible_membership_id !== null && activeMem(ctx.memberRows, t.responsible_membership_id) === null,
		status: t.status,
		statusLabel: domainStatusLabel(t.status),
		needsDetails,
		suppressed: t.suppressed !== 0,
		suppressedReason: t.suppressed_reason,
		missing,
		splits: splits.map((s) => ({
			label: s.label,
			amountMinor: s.amount_minor,
			amount: fmtMoney(s.amount_minor),
			rupiah: rupiahInput(s.amount_minor),
			responsibleName: memName(ctx, s.responsible_membership_id),
			responsibleMemberId: s.responsible_membership_id
		})),
		totals,
		members: activeMembers(ctx),
		evidence: evidence.map((d) => ({
			id: d.id,
			filename: d.filename,
			size: d.size_bytes,
			sizeDisplay: fmtSize(d.size_bytes),
			note: d.note,
			url: `/org/${ctx.org.slug}/documents/${d.id}`
		})),
		comments: comments.map((c) => ({ authorName: c.author_name, body: c.body, createdAt: fmtTs(c.created_at) })),
		approval,
		reviewDecision,
		audit,
		can: {
			edit: t.amount_minor <= 0 && ctx.can('DocumentTransactions'),
			incomeNotes: t.amount_minor > 0 && canDocument,
			approve: t.amount_minor <= 0 && ctx.can('ApproveTransactions'),
			requestChanges: t.amount_minor <= 0 && ctx.can('ApproveTransactions'),
			comment: ctx.can('CommentTransactions'),
			suppress: ctx.can('SuppressNotifications'),
			upload: canDocument,
			submit: ctx.can('DocumentTransactions') && docsComplete && t.status === 'changes_requested'
		}
	};
}

function decisionOrg(ctx: TxnCtx) {
	// Mirrors decisionOrgFor in rows.ts, over this request's freshly read rows.
	const mine = ctx.memberRows.find((m) => m.user_id === ctx.user.id) ?? null;
	const active = mine !== null && memActive(mine);
	const granted = new Set<Permission>();
	if (mine && active) {
		for (const p of ALL_PERMISSIONS) if (ctx.can(p)) granted.add(p);
	}
	return {
		memberExists: () => mine !== null,
		memberIsActive: () => active,
		permissionsOf: () => granted
	};
}

export function activeMembers(ctx: TxnCtx): Array<{ id: number; name: string; handle: string }> {
	return ctx.memberRows.filter(memActive).map((m) => ({ id: m.id, name: m.name, handle: m.handle }));
}

/** Shell chrome for the journey pages, built over this request's context. */
export function txnShell(ctx: TxnCtx) {
	return shellContext({
		config: ctx.config,
		session: ctx.session,
		user: ctx.user,
		db: ctx.db,
		org: ctx.org,
		memberRows: ctx.memberRows,
		roleRows: ctx.roleRows,
		permissions: permissionsFor(memberRefs(ctx.memberRows), roleRefs(ctx.roleRows), ctx.user.id),
		can: ctx.can
	});
}

// ------------------------------------------------------------- save details

/** POST ?/details. Income branch rewrites notes only; expense branch updates
 * explanation, reason, responsible, and purposes behind one revision CAS. */
export async function saveDetails(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, splits: oldSplits } = loaded;
	if (!(await mayDocument(ctx, t))) throw error(403, 'Documentation access denied.');
	requireRevision(form, t);
	const explanation = formStr(form, 'explanation').trim();

	if (t.amount_minor > 0) {
		if (explanation === '' || byteLen(explanation) > 16000) {
			throw error(400, 'Supply income notes of up to 16,000 characters.');
		}
		if (
			!ctx.can('DocumentTransactions') &&
			['responsible_member_id', 'split_label[]', 'split_amount[]', 'split_member[]', 'evidence_unavailable_reason'].some((key) => formHas(form, key))
		) {
			throw error(403, 'Income recipients may add notes and attachments only.');
		}
		const token = randomHex(24);
		const update = ctx.db
			.prepare('UPDATE transactions SET explanation=?1,updated_at=?2,revision=revision+1,mutation_token=?3 WHERE id=?4 AND org_id=?5 AND revision=?6')
			.bind(explanation, nowMs(), token, txnId, ctx.org.id, t.revision);
		const won = await commitMutation(ctx, txnId, token, [
			update,
			auditStatement(ctx, t, 'income_notes_updated', t.status, { before: t.explanation, after: explanation }, token),
			auditEventStatement(ctx, txnId, 'transaction.income_notes_updated', token)
		]);
		if (!won) throw error(409, 'Transaction changed. Reload before saving income notes.');
		return destination(ctx, txnId, 'Income notes saved; no approval required');
	}

	const reason = formStr(form, 'evidence_unavailable_reason').trim();
	if (explanation === '' || byteLen(explanation) > 16000 || byteLen(reason) > 2000) {
		throw error(400, 'Supply an explanation of up to 16,000 characters and a document note of up to 2,000 characters.');
	}
	const responsible = formInt(form, 'responsible_member_id');
	if (activeMem(ctx.memberRows, responsible) === null) {
		throw error(400, 'Choose an active responsible member of this organization.');
	}
	const magnitude = Math.abs(t.amount_minor);
	if (!(magnitude > 0)) throw error(400, 'The bank amount cannot be allocated.');
	const parsed = parseSplits(formStrings(form, 'split_label[]'), formStrings(form, 'split_amount[]'), formStrings(form, 'split_member[]'), magnitude);
	if (parsed.error !== null) throw error(400, parsed.error);
	const now = nowMs();
	const nextSplits: SplitRow[] = parsed.splits.map((s, i) => ({
		id: -(i + 1),
		transaction_id: txnId,
		label: s.label,
		amount_minor: s.amount_minor,
		responsible_membership_id: s.responsible,
		created_at: now
	}));
	const nextShape = { ...t, explanation, evidence_unavailable_reason: reason, responsible_membership_id: responsible };
	const invalid = validateResponsiblesActive(nextShape, nextSplits, ctx.memberRows);
	if (invalid !== null) throw error(400, invalid);
	if (snapshotEqual(snapshot(t, oldSplits), snapshot(nextShape, nextSplits))) {
		return destination(ctx, txnId, 'Details unchanged');
	}
	const token = randomHex(24);
	const statements = [
		ctx.db
			.prepare(
				"UPDATE transactions SET explanation=?1,evidence_unavailable_reason=?2,responsible_membership_id=?3,status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note='',updated_at=?4,revision=revision+1,mutation_token=?5 WHERE id=?6 AND org_id=?7 AND revision=?8"
			)
			.bind(explanation, reason, responsible, now, token, txnId, ctx.org.id, t.revision),
		ctx.db
			.prepare('DELETE FROM transaction_splits WHERE transaction_id=?1 AND EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?2)')
			.bind(txnId, token)
	];
	for (const split of nextSplits) {
		statements.push(
			ctx.db
				.prepare(
					'INSERT INTO transaction_splits(transaction_id,label,amount_minor,responsible_membership_id,created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?6)'
				)
				.bind(txnId, split.label, split.amount_minor, split.responsible_membership_id, now, token)
		);
	}
	// Reassignment must not launder self-approval: record the union of old and
	// new responsible ids (transaction-level and split-level) as history.
	const allResponsibles = new Set<number>([
		...recipientsOf(t, oldSplits),
		...recipientsOf(nextShape, nextSplits)
	]);
	for (const memberId of allResponsibles) {
		statements.push(
			ctx.db
				.prepare('INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?4)')
				.bind(txnId, memberId, now, token)
		);
	}
	statements.push(auditStatement(ctx, t, 'details_updated', 'pending', { before: snapshot(t, oldSplits), after: snapshot(nextShape, nextSplits) }, token));
	statements.push(auditEventStatement(ctx, txnId, 'transaction.details_updated', token));
	const won = await commitMutation(ctx, txnId, token, statements);
	if (!won) throw error(409, 'This transaction changed while you were editing it. Reload and review the latest details.');
	if (!sameSet(recipientsOf(nextShape, nextSplits), recipientsOf(t, oldSplits))) {
		await enqueueAssignment(ctx.db, ctx.org, ctx.memberRows, ctx.roleRows, { ...nextShape, status: 'pending' });
	}
	return destination(ctx, txnId, 'Details saved; approval requires current documentation');
}

// ----------------------------------------------------------------- submit

/** POST ?/submit. Domain-decided; the runtime update is one revision CAS. */
export async function submitDocumentation(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	if (!ctx.can('DocumentTransactions')) {
		throw error(403, `Access denied: your role does not include “${permissionLabel('DocumentTransactions')}”.`);
	}
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, splits, comments, evidence } = loaded;
	if (t.amount_minor > 0) throw error(400, 'Income notes require no submission or approval.');
	requireRevision(form, t);
	const invalidResponsibles = validateResponsiblesActive(t, splits, ctx.memberRows);
	if (invalidResponsibles !== null) throw error(400, invalidResponsibles);
	const history = await historyOf(ctx.db, txnId);
	const dom = buildDomTxn(t, splits, evidence, ctx.memberRows, history);
	if (dom.status === 'submitted') {
		return destination(ctx, txnId, 'Documentation is ready for review');
	}
	const denial = submitTransaction(decisionOrg(ctx), dom, ctx.user.id);
	if (denial !== null) throw error(400, `This transaction cannot be submitted: ${userMessage(denial)}.`);
	const token = randomHex(24);
	const update = ctx.db
		.prepare("UPDATE transactions SET status='pending',revision=revision+1,updated_at=?1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5")
		.bind(nowMs(), token, txnId, ctx.org.id, t.revision);
	const won = await commitMutation(ctx, txnId, token, [
		update,
		auditStatement(ctx, t, 'documentation_submitted', 'pending', {}, token),
		auditEventStatement(ctx, txnId, 'transaction.submitted', token)
	]);
	if (!won) throw error(409, 'The transaction changed during submission. Reload and try again.');
	return destination(ctx, txnId, 'Documentation submitted');
}

// ------------------------------------------------------------- approve/review

export function approve(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	return review(ctx, txnId, form, false);
}

export function requestChanges(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	return review(ctx, txnId, form, true);
}

async function review(ctx: TxnCtx, txnId: number, form: FormData, changes: boolean): Promise<never> {
	const required: Permission = 'ApproveTransactions';
	if (!ctx.can(required)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(required)}”.`);
	}
	const note = formStr(form, 'note').trim();
	if (byteLen(note) > 8000 || (changes && note === '')) {
		throw error(400, 'Supply a review note of up to 8,000 characters.');
	}
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, splits, comments, evidence } = loaded;
	if (t.amount_minor > 0) throw error(400, 'Income notes require no approval or change request.');
	requireRevision(form, t);
	if (!changes) {
		const invalidResponsibles = validateResponsiblesActive(t, splits, ctx.memberRows);
		if (invalidResponsibles !== null) throw error(400, invalidResponsibles);
	}
	const history = await historyOf(ctx.db, txnId);
	const dom = buildDomTxn(t, splits, evidence, ctx.memberRows, history);
	const denial = changes ? domainRequestChanges(decisionOrg(ctx), dom, ctx.user.id) : approveTransaction(decisionOrg(ctx), dom, ctx.user.id);
	if (denial !== null) {
		const status = denial.kind === 'SelfApprovalDenied' ? 403 : 400;
		throw error(status, `This decision cannot be recorded: ${userMessage(denial)}.`);
	}
	const status = changes ? 'changes_requested' : 'approved';
	const token = randomHex(24);
	const now = nowMs();
	const update = ctx.db
		.prepare(
			'UPDATE transactions SET status=?1,approved_by_membership_id=?2,approved_at=?3,approval_note=?4,updated_at=?5,revision=revision+1,mutation_token=?6 WHERE id=?7 AND org_id=?8 AND revision=?9'
		)
		.bind(status, changes ? null : me(ctx).id, changes ? null : now, note, now, token, txnId, ctx.org.id, t.revision);
	const won = await commitMutation(ctx, txnId, token, [
		update,
		auditStatement(ctx, t, status, status, { note }, token),
		auditEventStatement(ctx, txnId, `transaction.${status}`, token)
	]);
	if (!won) throw error(409, 'The transaction changed during review. Reload before deciding.');
	if (changes) {
		await enqueueAssignment(ctx.db, ctx.org, ctx.memberRows, ctx.roleRows, { ...t, status });
	}
	return destination(ctx, txnId, changes ? 'Changes requested' : 'Transaction approved');
}

// ---------------------------------------------------------------- comments

/** POST ?/comment. Comments and their audit row commit atomically; comments
 * never bump the transaction revision, so there is no operation token. */
export async function addComment(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const required: Permission = 'CommentTransactions';
	if (!ctx.can(required)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(required)}”.`);
	}
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	const body = formStr(form, 'body').trim();
	if (body === '' || byteLen(body) > 16000) {
		throw error(400, 'Write a comment of up to 16,000 characters.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare('INSERT INTO comments(org_id,transaction_id,author_membership_id,body,created_at) VALUES(?1,?2,?3,?4,?5)')
			.bind(ctx.org.id, txnId, me(ctx).id, body, nowMs()),
		committed(ctx.db, ctx.org.id, ctx.user.id, 'transaction.commented', `transaction:${txnId}`)
	]);
	// Comments do not modify the transaction revision or approval.
	await enqueueMentions(ctx.db, ctx.org, ctx.memberRows, ctx.roleRows, ctx.user.id, t, body);
	return destination(ctx, txnId, 'Comment added');
}

// ------------------------------------------------------------- suppression

export function suppress(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	return setSuppression(ctx, txnId, form, true);
}

export function unsuppress(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	return setSuppression(ctx, txnId, form, false);
}

async function setSuppression(ctx: TxnCtx, txnId: number, form: FormData, suppress: boolean): Promise<never> {
	const required: Permission = 'SuppressNotifications';
	if (!ctx.can(required)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(required)}”.`);
	}
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	const reason = formStr(form, 'reason').trim();
	requireRevision(form, t);
	if (suppress && (reason === '' || byteLen(reason) > 2000)) {
		throw error(400, 'Supply a suppression reason of up to 2,000 characters.');
	}
	const token = randomHex(24);
	const now = nowMs();
	const update = ctx.db
		.prepare(
			'UPDATE transactions SET suppressed=?1,suppressed_by_membership_id=?2,suppressed_reason=?3,suppressed_at=?4,revision=revision+1,mutation_token=?5 WHERE id=?6 AND org_id=?7 AND revision=?8'
		)
		.bind(suppress ? 1 : 0, suppress ? me(ctx).id : null, reason, suppress ? now : null, token, txnId, ctx.org.id, t.revision);
	const action = suppress ? 'notifications_suppressed' : 'notifications_resumed';
	const statements = [
		update,
		auditStatement(ctx, t, action, t.status, { reason }, token),
		auditEventStatement(ctx, txnId, `transaction.${action}`, token)
	];
	if (suppress) {
		// Suppression also cancels every undelivered outbox row about this
		// transaction, plus this organization's queued digests.
		statements.push(
			ctx.db
				.prepare("UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND cancelled_at IS NULL AND (transaction_id=?3 OR kind='digest') AND EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?4)")
				.bind(now, ctx.org.id, txnId, token)
		);
	}
	const won = await commitMutation(ctx, txnId, token, statements);
	if (!won) throw error(409, 'The transaction changed. Reload before changing notification settings.');
	return destination(ctx, txnId, suppress ? 'All transaction notifications suppressed' : 'Future transaction notifications resumed');
}

// ---------------------------------------------------------------- evidence

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean => sig.every((b, i) => bytes[i] === b);

/** POST ?/document. Magic-byte content detection; the R2 object is written
 * first, and on a losing CAS it is retained for recovery rather than deleted. */
export async function uploadDocument(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	if (!(await mayDocument(ctx, t))) throw error(403, 'Documentation access denied.');
	const value = form.get('file');
	const file = value instanceof File ? value : null;
	if (file === null) throw error(400, 'Choose a supporting document.');
	requireRevision(form, t);
	if (file.size === 0 || file.size > 10 * 1024 * 1024) {
		throw error(400, 'Supporting documents must be between 1 byte and 10 MB.');
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const contentType = startsWith(bytes, PDF_SIG)
		? 'application/pdf'
		: startsWith(bytes, PNG_SIG)
			? 'image/png'
			: startsWith(bytes, JPEG_SIG)
				? 'image/jpeg'
				: null;
	if (contentType === null) throw error(400, 'Upload a PDF, PNG, or JPEG document.');
	const note = formStr(form, 'note');
	if (byteLen(note) > 2000) {
		throw error(400, 'Document note must be at most 2,000 characters.');
	}
	const bucket: R2Bucket | null = ctx.env.DOCUMENTS ?? null;
	if (!bucket) throw error(503, 'Private document storage is not configured.');
	const token = randomHex(24);
	const key = `org/${ctx.org.id}/transactions/${txnId}/${token}`;
	await bucket.put(key, bytes);
	const now = nowMs();
	// Income keeps its approval history untouched; only expenses reopen.
	const update = ctx.db
		.prepare(
			"UPDATE transactions SET status=CASE WHEN amount_minor>0 THEN status ELSE 'pending' END,approved_at=CASE WHEN amount_minor>0 THEN approved_at ELSE NULL END,approved_by_membership_id=CASE WHEN amount_minor>0 THEN approved_by_membership_id ELSE NULL END,approval_note=CASE WHEN amount_minor>0 THEN approval_note ELSE '' END,updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5"
		)
		.bind(now, token, txnId, ctx.org.id, t.revision);
	const insert = ctx.db
		.prepare(
			"INSERT INTO documents(org_id,transaction_id,kind,r2_key,filename,content_type,size_bytes,note,uploaded_by_membership_id,created_at) SELECT ?1,?2,'evidence',?3,?4,?5,?6,?7,?8,?9 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?2 AND mutation_token=?10)"
		)
		.bind(ctx.org.id, txnId, key, file.name, contentType, bytes.length, note, me(ctx).id, now, token);
	const won = await commitMutation(ctx, txnId, token, [
		update,
		insert,
		auditStatement(ctx, t, 'evidence_attached', t.amount_minor > 0 ? t.status : 'pending', { filename: file.name, note }, token),
		auditEventStatement(ctx, txnId, 'transaction.evidence_attached', token)
	]);
	if (!won) {
		// Retain the unattached private object for recovery rather than delete evidence.
		throw error(409, 'The transaction changed during upload. Reload and attach the document again.');
	}
	return destination(ctx, txnId, t.amount_minor > 0 ? 'Income attachment retained; no approval required' : 'Evidence retained; transaction requires review');
}

/** GET /org/:slug/documents/:id. Same-org lookup first; without
 * ViewTransactions only income recipients of the tied income transaction may
 * download. Missing bucket content reports 404 while the metadata row stays. */
export async function downloadDocument(ctx: TxnCtx, documentId: number): Promise<Response> {
	const document = await docById(ctx.db, ctx.org.id, documentId);
	if (!document) throw error(404, 'Document not found.');
	if (!ctx.can('ViewTransactions')) {
		if (document.transaction_id === null) throw error(403, 'Document access denied.');
		const t = await txnById(ctx.db, ctx.org.id, document.transaction_id);
		if (!t) throw error(404, 'Transaction not found.');
		if (t.amount_minor <= 0 || !(await incomeRecipientsOf(ctx, t)).includes(me(ctx).id)) {
			throw error(403, 'Document access denied.');
		}
	}
	const bucket: R2Bucket | null = ctx.env.DOCUMENTS ?? null;
	if (!bucket) throw error(503, 'Private document storage unavailable.');
	const object = await bucket.get(document.r2_key);
	if (!object) throw error(404, 'Document content is unavailable; its historical record is retained.');
	const bytes = await r2Bytes(object);
	const filename = [...document.filename]
		.filter((c) => /[A-Za-z0-9._\- ]/.test(c))
		.slice(0, 160)
		.join('');
	return new Response(bytes, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': `attachment; filename="${filename === '' ? 'document' : filename}"`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
}

// ----------------------------------------------------------- manual creation

/** POST /org/:slug/transactions/new. Manual bank-style entry: bank_id stays
 * NULL, the amount arrives as an IDR magnitude plus an explicit direction. */
export async function createTransaction(ctx: TxnCtx, form: FormData): Promise<never> {
	const required: Permission = 'DocumentTransactions';
	if (!ctx.can(required)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(required)}”.`);
	}
	const pockets = await pocketsOf(ctx.db, ctx.org.id);
	const pocketId = formInt(form, 'pocket_id') ?? 0;
	if (!pockets.some((p) => p.id === pocketId)) {
		throw error(400, 'Unknown pocket for this organization.');
	}
	const date = formStr(form, 'date');
	if (!validDate(date)) throw error(400, 'Date must be YYYY-MM-DD.');
	const timeRaw = formStr(form, 'time');
	let time: string | null = null;
	if (timeRaw === '') {
		time = null;
	} else if (validTime(timeRaw)) {
		time = timeRaw;
	} else {
		throw error(400, 'Time must be HH:MM.');
	}
	const counterparty = formStr(form, 'counterparty').trim();
	if (counterparty === '') throw error(400, 'Counterparty is required.');
	// Forms speak IDR with an explicit direction; signed minor units stay internal.
	const magnitude = parseRupiah(formStr(form, 'amount'));
	const direction = formStr(form, 'direction');
	let amount: number | null = null;
	if (magnitude !== null && magnitude > 0 && direction === 'out') amount = -magnitude;
	else if (magnitude !== null && magnitude > 0 && direction === 'in') amount = magnitude;
	if (amount === null) {
		throw error(400, 'Amount must be a positive IDR value such as 150000, with a direction of money in or money out.');
	}
	const balanceRaw = formStr(form, 'balance').trim();
	let balance: number | null = null;
	if (balanceRaw !== '') {
		balance = parseRupiah(balanceRaw);
		if (balance === null) throw error(400, 'Balance after must be an IDR value such as 8500000.');
	}
	const responsible = formInt(form, 'responsible_member_id');
	if (responsible !== null && activeMem(ctx.memberRows, responsible) === null) {
		throw error(400, 'Responsible member must be an active member of this organization.');
	}
	const now = nowMs();
	await exec(
		ctx.db,
		"INSERT INTO transactions (org_id, pocket_id, bank_id, txn_date, txn_time, counterparty, transaction_type, bank_notes, amount_minor, balance_minor, explanation, responsible_membership_id, status, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?12)",
		[
			ctx.org.id,
			pocketId,
			date,
			time,
			counterparty,
			formStr(form, 'transaction_type'),
			formStr(form, 'notes'),
			amount,
			balance,
			formStr(form, 'explanation'),
			responsible,
			now
		]
	);
	const created = await qOne<TxnRow>(ctx.db, 'SELECT * FROM transactions WHERE org_id = ?1 ORDER BY id DESC LIMIT 1', [ctx.org.id]);
	if (created && responsible !== null) {
		await exec(
			ctx.db,
			'INSERT OR IGNORE INTO responsible_history (transaction_id, membership_id, since) VALUES (?1, ?2, ?3)',
			[created.id, responsible, now]
		);
	}
	redirect(303, `/org/${ctx.org.slug}/transactions/${created?.id ?? 0}?msg=${encodeURIComponent('Created')}`);
}