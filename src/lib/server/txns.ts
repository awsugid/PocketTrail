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
import { scheduleDelivery } from './notification_mail';
import {
	allocationsOfTxn,
	createPurposeRow,
	enqueuePurposeNotices,
	purposeById,
	purposeNoticeRecipients,
	purposeResponsibles,
	purposesOfKind,
	sniffDocType
} from './purposes';
import {
	allocationExact,
	allocationRemainder,
	aggregatePurposeStatuses,
	effectiveResponsibles,
	purposeKindOf,
	purposeReady,
	purposeStatusLabel,
	purposeStatusTone,
	validateAllocations,
	type AllocationInput,
	type PurposeKind
} from '#lib/purposes.ts';
import { markdownToPlain } from '#lib/markdown.ts';
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
} from '#lib/domain.ts';
import { fmtMoney, fmtMoment, fmtSize, fmtTs, parseRupiah, rupiahInput, validDate, validTime } from '#lib/fmt.ts';
import { r2Bytes, type D1PreparedStatement, type R2Bucket } from '#lib/d1.ts';

// --------------------------------------------------------------- request ctx

/** Everything the journey handlers need: identity, org rows (including the
 * notification and income-role columns auth.ts's narrower type omits), fresh
 * membership/role rows, and the acting permission set. */
export interface TxnCtx {
	/** Server-created delegation only; never populated from forms. */
	delegation?: { clientId: string; grantId: string; scope: string; tokenHash: string };
	config: import('./auth').AppConfig;
	session: Session;
	user: UserRow;
	db: import('#lib/d1.ts').D1Database;
	/** Worker bindings (DOCUMENTS bucket for evidence upload/download). */
	env: import('#lib/d1.ts').Bindings;
	org: OrgRow;
	memberRows: MemRow[];
	roleRows: RoleRow[];
	can(permission: Permission): boolean;
	/** Schedule outbox email delivery for this org after queueing notices
	 * (notification_mail.ts scheduleDelivery); set by requireOrg. Resolves to
	 * whether email delivery is enabled; never throws. */
	deliverMail?: () => Promise<boolean>;
}

const memberRefs = (memberRows: readonly MemRow[]) =>
	memberRows.map((row) => ({ userId: row.user_id, roleId: row.role_id, active: row.removed_at === null }));

const roleRefs = (roleRows: readonly RoleRow[]) => roleRows.map((row) => ({ id: row.id, permissions: row.permissions }));

function buildCtx(
	config: import('./auth').AppConfig,
	session: Session,
	user: UserRow,
	db: import('#lib/d1.ts').D1Database,
	env: import('#lib/d1.ts').Bindings,
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
			ExplainOwnActions: 'View and explain assigned Actions only',
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
	if (ctx.can('ExplainOwnActions')) throw error(403, 'Assigned Actions access only.');
	ctx.deliverMail = () => scheduleDelivery(event, ctx.db, ctx.org.id);
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
	allocations: Awaited<ReturnType<typeof allocationsOfTxn>>;
	comments: Awaited<ReturnType<typeof commentsOf>>;
	evidence: Awaited<ReturnType<typeof evidenceOf>>;
}

async function loadFull(db: import('#lib/d1.ts').D1Database, orgId: number, txnId: number): Promise<FullTxn | null> {
	const t = await txnById(db, orgId, txnId);
	if (!t) return null;
	return {
		t,
		splits: await splitsOf(db, txnId),
		allocations: await allocationsOfTxn(db, txnId),
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
			'INSERT INTO transaction_audit (org_id,transaction_id,actor_membership_id,action,previous_status,new_status,details,created_at,actor_type,client_id) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?10,?11 WHERE EXISTS (SELECT 1 FROM transactions WHERE id=?2 AND org_id=?1 AND mutation_token=?9)'
		)
		.bind(ctx.org.id, t.id, me(ctx).id, action, t.status, status, JSON.stringify(ctx.delegation ? { actor: `AI on behalf of ${ctx.user.name}`, clientId: ctx.delegation.clientId, details } : details), nowMs(), token,ctx.delegation ? 'AI' : 'human',ctx.delegation?.clientId ?? null);
}

/** Transactional audit_events row, committed in the same batch and gated by
 * the operation token so a losing run records nothing. */
function auditEventStatement(ctx: TxnCtx, id: number, action: string, token: string): D1PreparedStatement {
	return ctx.db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at,actor_type,delegated_user_id,client_id) SELECT ?1,?2,?3,?4,'committed',?5,?8,?9,?10 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?6 AND org_id=?2 AND mutation_token=?7)"
		)
		.bind(ctx.delegation ? null : ctx.user.id, ctx.org.id, action, `transaction:${id}`, nowMs(), id, token, ctx.delegation ? 'AI' : 'human', ctx.delegation ? ctx.user.id : null, ctx.delegation?.clientId ?? null);
}

/** Runs one atomic batch and reports whether THIS operation won the revision
 * CAS: the winner probe reads the operation token inside the batch instead of
 * interpreting D1's meta.changes aggregate (triggers inflate that count). */
async function commitMutation(ctx: TxnCtx, id: number, token: string, statements: D1PreparedStatement[]): Promise<boolean> {
	if (ctx.delegation) {
		// Revalidate at the write transaction boundary; abort rolls back every statement.
		statements.unshift(ctx.db.prepare(`INSERT INTO mcp_write_guard(valid) SELECT CASE WHEN EXISTS(
 SELECT 1 FROM mcp_grants g JOIN memberships m ON m.user_id=g.user_id AND m.org_id=g.org_id JOIN roles r ON r.id=m.role_id AND r.org_id=m.org_id
 WHERE g.id=?1 AND g.user_id=?2 AND g.org_id=?3 AND g.client_id=?4 AND g.revoked_at IS NULL AND m.removed_at IS NULL AND m.invited=0
 AND EXISTS(SELECT 1 FROM mcp_tokens t WHERE t.grant_id=g.id AND t.token_hash=?7 AND t.expires_at>?5)
 AND EXISTS(SELECT 1 FROM json_each(g.scope_json) WHERE value=?6)
 AND EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='DocumentTransactions')
 AND EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions')
 AND NOT EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ExplainOwnActions')) THEN 1 ELSE 0 END`).bind(ctx.delegation.grantId,ctx.user.id,ctx.org.id,ctx.delegation.clientId,nowMs(),ctx.delegation.scope,ctx.delegation.tokenHash));
	}
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
		if (typeof map.justification === 'string' && map.justification !== '') {
			rows.push(['Justification', map.justification]);
		}
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

function evidenceItem(d: import('./rows').DocRow, slug: string, uploadedBy: string | null): EvidenceItem {
	return { id: String(d.id), url: `/org/${slug}/documents/${d.id}`, filename: d.filename, contentType: d.content_type, sizeBytes: d.size_bytes, sizeDisplay: fmtSize(d.size_bytes), note: d.note, uploadedBy, createdAt: fmtMoment(d.created_at) };
}

export interface EvidenceItem { id: string; url: string; filename: string; contentType: string | null; sizeBytes?: number | null; note?: string | null; uploadedBy?: string | null; createdAt?: string | null; sizeDisplay: string }

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
	/** Purpose allocations (the new documentation path) with per-purpose review state. */
	allocations: Array<{
		id: number;
		purposeId: number;
		purposeName: string;
		kindLabel: string;
		amountMinor: number;
		amount: string;
		rupiah: string;
		overrideName: string | null;
		overrideMemberId: number | null;
		effectiveNames: string[];
		effectiveInactive: boolean;
		statusLabel: string;
		statusTone: 'needs' | 'review' | 'approved' | 'changes';
		ready: boolean;
		canApprove: boolean;
		approveIneligibleReason: string | null;
		notesPreview: string;
		url: string;
		evidence: EvidenceItem[];
	}>;
	allocationTotals: { amountMinor: number; allocatedMinor: number; remainderMinor: number; remainder: string; exact: boolean } | null;
	/** Derived review state once purposes own approval (null while unallocated). */
	purposeReview: { label: string; tone: 'needs' | 'review' | 'approved' | 'changes' } | null;
	/** Purpose catalogue of the matching kind, for the allocation picker. */
	purposes: Array<{ id: number; name: string }>;
	kindLabel: string;
	members: Array<{ id: number; name: string; handle: string }>;
	evidence: EvidenceItem[];
	unassignedEvidence: EvidenceItem[];
	comments: Array<{ authorName: string; body: string; createdAt: string }>;
	approval: { eligible: boolean; ineligibleReason: string | null };
	reviewDecision: { status: string; statusLabel: string; authorName: string; createdAt: string; note: string } | null;
	audit: AuditEntryView[];
	can: {
		edit: boolean;
		allocate: boolean;
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
	const { t, splits, allocations, comments, evidence } = loaded;
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

	// ---------------------------------------------------------- purposes
	const kind: PurposeKind = purposeKindOf(t.amount_minor);
	const purposeCatalogue = await purposesOfKind(ctx.db, ctx.org.id, kind);
	const hasAllocations = allocations.length > 0;
	const responsibleIdsOf = new Map<number, number[]>();
	const historyIdsOf = new Map<number, number[]>();
	const evidenceCounts = new Map<number, number>();
	const purposeEvidence = new Map<number, EvidenceItem[]>();
	for (const allocation of allocations) {
		if (!responsibleIdsOf.has(allocation.purpose_id)) {
			responsibleIdsOf.set(allocation.purpose_id, await purposeResponsibles(ctx.db, allocation.purpose_id));
			historyIdsOf.set(allocation.purpose_id, []);
		}
	}
	if (allocations.length > 0) {
		const rows = await qAll<{ purpose_id: number; membership_id: number }>(
			ctx.db,
			`SELECT pr.purpose_id, pr.membership_id FROM purpose_responsible_history pr WHERE pr.purpose_id IN (${allocations.map(() => '?').join(',')})`,
			allocations.map((a) => a.purpose_id)
		);
		for (const row of rows) historyIdsOf.set(row.purpose_id, [...(historyIdsOf.get(row.purpose_id) ?? []), row.membership_id]);
		const docs = await qAll<import('./rows').DocRow & { uploader_name: string | null }>(
			ctx.db,
			`SELECT d.*, u.name AS uploader_name FROM documents d LEFT JOIN memberships m ON m.id=d.uploaded_by_membership_id LEFT JOIN users u ON u.id=m.user_id WHERE d.org_id=? AND d.purpose_id IN (${allocations.map(() => '?').join(',')}) AND d.kind='evidence' AND d.superseded=0 ORDER BY d.id`,
			[ctx.org.id, ...allocations.map((a) => a.purpose_id)]
		);
		for (const doc of docs) {
			const id = doc.purpose_id!;
			purposeEvidence.set(id, [...(purposeEvidence.get(id) ?? []), evidenceItem(doc, ctx.org.slug, doc.uploader_name)]);
			evidenceCounts.set(id, (evidenceCounts.get(id) ?? 0) + 1);
		}
	}
	const nameOf = (id: number | null | undefined) => memName(ctx, id) ?? 'Unassigned';
	const allocationViews = allocations.map((a) => {
		const pResponsible = responsibleIdsOf.get(a.purpose_id) ?? [];
		const effective = effectiveResponsibles(a.responsible_membership_id, pResponsible, t.responsible_membership_id);
		const ready = purposeReady(a.purpose_kind, a.purpose_notes, evidenceCounts.get(a.purpose_id) ?? 0);
		// Effective responsibility (plus historical responsibles of the purpose
		// and this transaction) bars approving one's own purpose.
		const barred =
			effective.includes(mine.id) ||
			t.responsible_membership_id === mine.id ||
			exclusions.includes(mine.id) ||
			(historyIdsOf.get(a.purpose_id) ?? []).includes(mine.id) ||
			pResponsible.includes(mine.id);
		const approveEligible = a.purpose_status === 'submitted' && ctx.can('ApproveTransactions') && !barred;
		return {
			id: a.id,
			purposeId: a.purpose_id,
			purposeName: a.purpose_name,
			kindLabel: a.purpose_kind === 'income' ? 'Income' : 'Expense',
			amountMinor: a.amount_minor,
			amount: fmtMoney(a.amount_minor),
			rupiah: rupiahInput(a.amount_minor),
			overrideName: memName(ctx, a.responsible_membership_id),
			overrideMemberId: a.responsible_membership_id,
			effectiveNames: effective.map(nameOf),
			effectiveInactive: effective.length === 0 || effective.every((id) => activeMem(ctx.memberRows, id) === null),
			statusLabel: purposeStatusLabel(a.purpose_status, ready),
			statusTone: purposeStatusTone(a.purpose_status, ready),
			ready,
			canApprove: approveEligible,
			approveIneligibleReason:
				a.purpose_status === 'submitted' && ctx.can('ApproveTransactions') && !approveEligible
					? 'A member responsible for this purpose, now or before, cannot approve it.'
					: null,
			notesPreview: a.purpose_notes.trim() === '' ? '' : markdownToPlain(a.purpose_notes, 120),
			url: `/org/${ctx.org.slug}/purposes/${a.purpose_id}`,
			evidence: purposeEvidence.get(a.purpose_id) ?? []
		};
	});
	const allocatedMinor = allocations.reduce((sum, a) => sum + a.amount_minor, 0);
	const remainderMinor = allocationRemainder(bankAbs, allocations.map((a) => a.amount_minor));
	const allocationTotals = {
		amountMinor: bankAbs,
		allocatedMinor,
		remainderMinor,
		remainder: fmtMoney(remainderMinor),
		exact: allocationExact(bankAbs, allocations.map((a) => a.amount_minor))
	};
	const purposeReview =
		kind === 'expense' && hasAllocations
			? (() => {
					const aggregate = aggregatePurposeStatuses(allocations.map((a) => a.purpose_status));
					return { label: aggregate.label, tone: aggregate.tone };
				})()
			: null;

	// needs_details: documentation still owed (Draft/ChangesRequested domain
	// states), derived from completeness; submit/approve enforce the full rule.
	const docsComplete = validateDocumentation(dom) === null && responsiblesOk && activeMem(ctx.memberRows, t.responsible_membership_id) !== null;
	const needsDetails = t.amount_minor > 0 ? !incomeComplete(t.explanation) : purposeReview !== null ? purposeReview.tone !== 'approved' : documentationOwed(t.status, docsComplete);

	// What the "Still needed" notice should actually list.
	const missing: string[] = [];
	if (purposeReview !== null) {
		// Purposes own the documentation; report allocation-level gaps.
		if (remainderMinor > 0) missing.push(`purpose allocations for the remaining ${fmtMoney(remainderMinor)}`);
		for (const view of allocationViews) {
			if (!view.ready) missing.push(`notes or evidence for “${view.purposeName}”`);
			if (view.evidence.length === 0) missing.push(`${view.purposeName} has no evidence`);
			if (view.effectiveInactive) missing.push(`an active responsible member for “${view.purposeName}”`);
		}
	} else {
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
		`SELECT a.action, a.previous_status, a.new_status, a.details, a.created_at, CASE WHEN a.actor_type='AI' THEN 'AI on behalf of '||u.name ELSE u.name END AS author_name FROM transaction_audit a JOIN memberships m ON m.id = a.actor_membership_id JOIN users u ON u.id = m.user_id WHERE a.org_id = ?1 AND a.transaction_id = ?2 ORDER BY a.id DESC LIMIT 100`,
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
			createdAt: fmtMoment(decision.created_at),
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
		statusLabel: purposeReview !== null ? purposeReview.label : domainStatusLabel(t.status),
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
		allocations: allocationViews,
		allocationTotals: purposeReview !== null || hasAllocations ? allocationTotals : null,
		purposeReview,
		purposes: purposeCatalogue,
		kindLabel: kind === 'income' ? 'Income' : 'Expense',
		members: activeMembers(ctx),
		evidence: evidence.filter((d) => d.purpose_id === null).map((d) => evidenceItem(d, ctx.org.slug, memName(ctx, d.uploaded_by_membership_id))),
		unassignedEvidence: t.amount_minor > 0 ? [] : evidence.filter((d) => d.purpose_id === null).map((d) => evidenceItem(d, ctx.org.slug, memName(ctx, d.uploaded_by_membership_id))),
		comments: comments.map((c) => ({ authorName: c.author_name, body: c.body, createdAt: fmtMoment(c.created_at) })),
		approval,
		reviewDecision,
		audit,
		can: {
			edit: t.amount_minor <= 0 && ctx.can('DocumentTransactions'),
			allocate: ctx.can('DocumentTransactions'),
			incomeNotes: t.amount_minor > 0 && canDocument,
			approve: t.amount_minor <= 0 && purposeReview === null && ctx.can('ApproveTransactions'),
			requestChanges: t.amount_minor <= 0 && purposeReview === null && ctx.can('ApproveTransactions'),
			comment: ctx.can('CommentTransactions'),
			suppress: ctx.can('SuppressNotifications'),
			upload: canDocument,
			submit:
				ctx.can('DocumentTransactions') &&
				(purposeReview !== null
					? allocationTotals.exact && allocationViews.every((view) => view.ready && !view.effectiveInactive)
					: docsComplete && t.status === 'changes_requested')
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
	// Invited members are assignable; label them so it is clear they have not joined.
	return ctx.memberRows
		.filter(memActive)
		.map((m) => ({ id: m.id, name: m.invited ? `${m.name} (invited)` : m.name, handle: m.handle }));
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
export async function saveTag(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	if (!ctx.can('DocumentTransactions')) throw error(403, 'Documentation access denied.');
	requireRevision(form, t);
	const removeId = formInt(form, 'remove_tag');
	const name = formStr(form, 'tag').trim();
	if (removeId !== null) {
		if (!Number.isSafeInteger(removeId) || removeId < 1) throw error(400, 'Invalid tag.');
	} else if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
		throw error(400, 'Enter a tag of up to 80 characters.');
	}
	const existing = removeId === null
		? await qOne<{ id: number; name: string }>(ctx.db, 'SELECT id, name FROM tags WHERE org_id=?1 AND name=?2 COLLATE NOCASE', [ctx.org.id, name])
		: await qOne<{ id: number; name: string }>(ctx.db, 'SELECT g.id, g.name FROM tags g JOIN transaction_tags tt ON tt.tag_id=g.id AND tt.org_id=g.org_id WHERE g.org_id=?1 AND g.id=?2 AND tt.transaction_id=?3', [ctx.org.id, removeId, txnId]);
	if (removeId !== null && !existing) throw error(400, 'Tag is not assigned to this transaction.');
	const token = randomHex(24);
	const guard = 'EXISTS (SELECT 1 FROM transactions WHERE id=?2 AND org_id=?1 AND mutation_token=?3)';
	const statements: D1PreparedStatement[] = [ctx.db.prepare('UPDATE transactions SET updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5').bind(nowMs(), token, txnId, ctx.org.id, t.revision)];
	if (removeId === null) {
		statements.push(ctx.db.prepare(`INSERT OR IGNORE INTO tags(org_id,name) SELECT ?1,?4 WHERE ${guard}`).bind(ctx.org.id, txnId, token, name));
		statements.push(ctx.db.prepare(`INSERT OR IGNORE INTO transaction_tags(org_id,transaction_id,tag_id) SELECT ?1,?2,id FROM tags WHERE org_id=?1 AND name=?4 COLLATE NOCASE AND ${guard}`).bind(ctx.org.id, txnId, token, name));
	} else {
		statements.push(ctx.db.prepare(`DELETE FROM transaction_tags WHERE org_id=?1 AND transaction_id=?2 AND tag_id=?4 AND ${guard}`).bind(ctx.org.id, txnId, token, removeId));
	}
	const tagName = existing?.name ?? name;
	statements.push(auditStatement(ctx, t, 'tags_updated', t.status, { [removeId === null ? 'Added tag' : 'Removed tag']: tagName }, token));
	statements.push(auditEventStatement(ctx, txnId, 'transaction.tags_updated', token));
	if (!(await commitMutation(ctx, txnId, token, statements))) throw error(409, 'Transaction changed. Reload before changing tags.');
	return destination(ctx, txnId, removeId === null ? 'Tag added' : 'Tag removed');
}

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

	// Expense documentation now lives on purposes (Notes, evidence,
	// responsibility, approval). The transaction records allocations only.
	if (t.amount_minor <= 0) {
		throw error(400, 'Expense documentation is recorded through purpose allocations.');
	}
	throw error(400, 'Unexpected details request.');
}

// ------------------------------------------------------ purpose allocations

export interface AllocationDraftRow {
	purposeId: number;
	amountMinor: number;
	override: number | null;
}

/** Removes purposes this request created but never allocated (any failure
 * path); a purpose with allocations is never touched. */
async function cleanupCreatedPurposes(db: import('#lib/d1.ts').D1Database, ids: readonly number[]): Promise<void> {
	for (const id of ids) {
		await exec(db, 'DELETE FROM purposes WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM allocations WHERE purpose_id = ?1)', [id]);
	}
}

/** POST ?/allocations. Draft partial allocations are allowed (the remainder
 * stays visible); overallocation is rejected. Effective responsibility is
 * the allocation override, else the purpose's own members, else the
 * transaction's; a reassignment requires a justification, and explicit
 * overrides survive a whole-transaction responsible change untouched. */
export async function saveAllocations(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const required: Permission = 'DocumentTransactions';
	if (!ctx.can(required)) {
		throw error(403, `Access denied: your role does not include “${permissionLabel(required)}”.`);
	}
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, allocations: oldAllocations } = loaded;
	requireRevision(form, t);
	const kind = purposeKindOf(t.amount_minor);
	const magnitude = Math.abs(t.amount_minor);
	if (!(magnitude > 0)) throw error(400, 'The bank amount cannot be allocated.');
	const responsible = formInt(form, 'responsible_member_id');
	if (responsible !== null && activeMem(ctx.memberRows, responsible) === null) {
		throw error(400, 'The inherited responsible member must be an active member of this organization.');
	}

	// ------------------------------------------------------------ parse rows
	const refs = formStrings(form, 'alloc_purpose[]');
	const amounts = formStrings(form, 'alloc_amount[]');
	const members = formStrings(form, 'alloc_member[]');
	const quickPurpose = formStr(form, 'quick_purpose').trim();
	const quickDescription = formStr(form, 'quick_notes').trim();
	const quickInvoice = formStr(form, 'quick_invoice').trim();
	if (quickInvoice) {
		let url: URL;
		try { url = new URL(quickInvoice); } catch { throw error(400, 'Enter a valid invoice URL.'); }
		if (!['https:', 'http:'].includes(url.protocol) || byteLen(quickInvoice) > 2000) throw error(400, 'Invoice URL must be an HTTP or HTTPS URL of at most 2,000 characters.');
	}
	const quickNotes = [quickDescription, quickInvoice ? `Invoice URL: ${quickInvoice}` : ''].filter(Boolean).join('\n\n');
	if (byteLen(quickNotes) > 16000) throw error(400, 'Notes are limited to 16,000 characters.');
	if (quickPurpose || quickNotes) {
		if (refs.length || oldAllocations.length) throw error(400, 'Quick purpose is only available for an unallocated transaction.');
		if (!quickPurpose) throw error(400, 'Enter a purpose name.');
		refs.push(quickPurpose);
		amounts.push(rupiahInput(magnitude));
		members.push('');
	}
	if (refs.length !== amounts.length || refs.length !== members.length) {
		throw error(400, 'purpose rows are malformed');
	}
	if (refs.length > 100) throw error(400, 'At most 100 purposes can be allocated on one transaction.');
	const catalogue = await purposesOfKind(ctx.db, ctx.org.id, kind);
	const catalogueLower = new Set(catalogue.map((p) => p.name.toLowerCase()));
	const newRowNames: string[] = [];
	interface DraftRow {
		purposeId: number | null;
		newName: string | null;
		amountMinor: number;
		override: number | null;
	}
	const drafts: DraftRow[] = [];
	for (let i = 0; i < refs.length; i += 1) {
		const ref = (refs[i] ?? '').trim();
		const amountRaw = (amounts[i] ?? '').trim();
		if (ref === '' && amountRaw === '') continue; // untouched default row
		if (ref === '') throw error(400, `purpose row ${i + 1} has an empty purpose`);
		const parsedAmount = parseRupiah(amountRaw);
		if (parsedAmount === null || parsedAmount <= 0) {
			throw error(400, `purpose row ${i + 1} amount must be a positive IDR magnitude`);
		}
		const member = (members[i] ?? '').trim();
		let override: number | null = null;
		if (member !== '') {
			if (!/^-?[0-9]{1,18}$/.test(member)) throw error(400, 'purpose row has an invalid member');
			override = Number(member);
			if (activeMem(ctx.memberRows, override) === null) {
				throw error(400, 'A purpose row override must be an active member of this organization.');
			}
		}
		if (/^[0-9]{1,15}$/.test(ref)) {
			const purpose = await purposeById(ctx.db, ctx.org.id, Number(ref));
			if (purpose === null || purpose.kind !== kind) {
				throw error(400, `purpose row ${i + 1} references a purpose of the wrong direction`);
			}
			drafts.push({ purposeId: purpose.id, newName: null, amountMinor: parsedAmount, override });
		} else {
			// A picked suggestion posts as the purpose name; a typed new name
			// creates the purpose. An existing name of this kind resolves to it.
			const name = (ref.startsWith('new:') ? ref.slice(4) : ref).trim();
			if (name === '' || byteLen(name) > 300) throw error(400, `purpose row ${i + 1} has an invalid new purpose name`);
			const existing = catalogue.find((p) => p.name.toLowerCase() === name.toLowerCase());
			if (existing) {
				drafts.push({ purposeId: existing.id, newName: null, amountMinor: parsedAmount, override });
			} else {
				if (newRowNames.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
					throw error(400, `purpose row ${i + 1} repeats the new purpose “${name}”`);
				}
				newRowNames.push(name);
				drafts.push({ purposeId: null, newName: name, amountMinor: parsedAmount, override });
			}
		}
	}
	const invalidDrafts = validateAllocations(
		magnitude,
		drafts.map((row) => ({ purposeId: row.purposeId ?? -1, amountMinor: row.amountMinor, responsibleMembershipId: row.override }))
	);
	if (invalidDrafts !== null) throw error(400, invalidDrafts);

	// ------------------------------------------------- diff + responsibility
	// The diff runs BEFORE any write, keyed by purpose id or new-name, so a
	// rejected save (missing justification, malformed rows) creates nothing.
	interface KeyedRow {
		key: string;
		purposeId: number | null;
		newName: string | null;
		amountMinor: number;
		override: number | null;
	}
	const keyedDrafts: KeyedRow[] = drafts.map((row) => ({
		key: row.purposeId !== null ? `p${row.purposeId}` : `n:${row.newName!.toLowerCase()}`,
		purposeId: row.purposeId,
		newName: row.newName,
		amountMinor: row.amountMinor,
		override: row.override
	}));
	const oldByPurpose = new Map(oldAllocations.map((a) => [a.purpose_id, a]));
	const oldByKey = new Map<string, (typeof oldAllocations)[number]>(oldAllocations.map((a) => [`p${a.purpose_id}`, a]));
	const nextByKey = new Map<string, KeyedRow>(keyedDrafts.map((r) => [r.key, r]));
	const involvedIds = [...oldByPurpose.keys()];
	const purposeResponsibleMap = new Map<number, number[]>();
	for (const id of involvedIds) purposeResponsibleMap.set(id, await purposeResponsibles(ctx.db, id));
	const effectiveOf = (override: number | null, purposeId: number | null, txnResponsible: number | null) =>
		effectiveResponsibles(override, purposeId === null ? [] : (purposeResponsibleMap.get(purposeId) ?? []), txnResponsible);
	let structureChanged = responsible !== t.responsible_membership_id;
	let responsibilityChanged = structureChanged;
	const changedPurposeIds = new Set<number>();
	const responsibilityDeltaKeys = new Map<string, number[]>(); // key → added members
	for (const key of new Set([...oldByKey.keys(), ...nextByKey.keys()])) {
		const before = oldByKey.get(key);
		const after = nextByKey.get(key);
		const rowChanged =
			before === undefined ||
			after === undefined ||
			before.amount_minor !== after.amountMinor ||
			before.responsible_membership_id !== after.override;
		if (rowChanged) {
			if (after?.purposeId !== null && after?.purposeId !== undefined) changedPurposeIds.add(after.purposeId);
			if (before !== undefined) changedPurposeIds.add(before.purpose_id);
			structureChanged = true;
		}
		const beforeIds = before ? effectiveOf(before.responsible_membership_id, before.purpose_id, t.responsible_membership_id) : [];
		const afterIds = after ? effectiveOf(after.override, after.purposeId, responsible) : [];
		const added = afterIds.filter((mid) => !beforeIds.includes(mid));
		if (added.length > 0 || beforeIds.some((mid) => !afterIds.includes(mid))) {
			responsibilityChanged = true;
			if (added.length > 0) responsibilityDeltaKeys.set(key, added);
		}
	}
	const justification = formStr(form, 'justification').trim();
	if (byteLen(justification) > 4000) throw error(400, 'Justification must be at most 4,000 characters.');
	if (responsibilityChanged && justification === '') {
		throw error(400, 'A justification is required whenever responsibility changes.');
	}
	if (!structureChanged) return destination(ctx, txnId, 'Allocations unchanged');

	// ------------------------------------------------------- create purposes
	// Guarded against concurrent creators: a lost name race rejects the save.
	const createdPurposeIds: number[] = [];
	const keyToId = new Map<string, number>();
	for (const row of keyedDrafts) {
		if (row.purposeId !== null) {
			keyToId.set(row.key, row.purposeId);
			continue;
		}
		const created = await createPurposeRow(ctx.db, ctx.org.id, row.newName!, kind, me(ctx).id);
		if (created === null) {
			await cleanupCreatedPurposes(ctx.db, createdPurposeIds);
			throw error(400, `A purpose named “${row.newName}” already exists — choose it from the list.`);
		}
		createdPurposeIds.push(created);
		keyToId.set(row.key, created);
	}
	const nextRows: AllocationDraftRow[] = keyedDrafts.map((row) => ({
		purposeId: keyToId.get(row.key) as number,
		amountMinor: row.amountMinor,
		override: row.override
	}));
	const finalInvalid = validateAllocations(
		magnitude,
		nextRows.map((row) => ({ purposeId: row.purposeId, amountMinor: row.amountMinor, responsibleMembershipId: row.override }))
	);
	if (finalInvalid !== null) {
		await cleanupCreatedPurposes(ctx.db, createdPurposeIds);
		throw error(400, finalInvalid);
	}

	let quickUpdate: { id: number; revision: number; notes: string; status: string; before: string } | null = null;
	if (quickNotes && quickPurpose) {
		const id = nextRows[0]?.purposeId;
		const purpose = id === undefined ? null : await purposeById(ctx.db, ctx.org.id, id);
		if (!purpose) { await cleanupCreatedPurposes(ctx.db, createdPurposeIds); throw error(409, 'Purpose no longer exists.'); }
		const notes = [purpose.notes.trim(), quickNotes].filter(Boolean).join('\n\n');
		if (byteLen(notes) > 16000) { await cleanupCreatedPurposes(ctx.db, createdPurposeIds); throw error(400, 'Combined purpose notes exceed 16,000 characters.'); }
		quickUpdate = { id: purpose.id, revision: purpose.revision, notes, status: purpose.status, before: purpose.notes };
	}

	// ------------------------------------------------------------- commit
	const now = nowMs();
	const token = randomHex(24);
	const nameLookup = new Map<number, string>();
	for (const p of await purposesOfKind(ctx.db, ctx.org.id, kind)) nameLookup.set(p.id, p.name);
	const purposeNameOf = (purposeId: number): string => nameLookup.get(purposeId) ?? `purpose ${purposeId}`;
	interface AllocSnapRow {
		purpose_name: string;
		amount_minor: number;
		responsible_membership_id: number | null;
	}
	const allocSnapshot = (txnResponsible: number | null, rows: readonly AllocSnapRow[]) => ({
		explanation: t.explanation,
		responsible_member_id: txnResponsible,
		evidence_unavailable_reason: t.evidence_unavailable_reason,
		purposes: rows.map((row) => ({
			label: row.purpose_name,
			amount_minor: row.amount_minor,
			responsible_membership_id: row.responsible_membership_id
		}))
	});
	const afterSnapRows: AllocSnapRow[] = nextRows.map((row) => ({
		purpose_name: purposeNameOf(row.purposeId),
		amount_minor: row.amountMinor,
		responsible_membership_id: row.override
	}));

	const statements: D1PreparedStatement[] = [
		ctx.db
			.prepare(
				'UPDATE transactions SET responsible_membership_id=?1,updated_at=?2,revision=revision+1,mutation_token=?3 WHERE id=?4 AND org_id=?5 AND revision=?6'
			)
			.bind(responsible, now, token, txnId, ctx.org.id, t.revision),
		ctx.db
			.prepare('DELETE FROM allocations WHERE transaction_id=?1 AND EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?2)')
			.bind(txnId, token)
	];
	for (const row of nextRows) {
		statements.push(
			ctx.db
					.prepare(
							'INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,responsible_membership_id,created_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?7)'
					)
					.bind(ctx.org.id, row.purposeId, txnId, row.amountMinor, row.override, now, token)
		);
	}
	if (quickUpdate) {
		const p = quickUpdate;
		statements.push(ctx.db.prepare(`UPDATE purposes SET notes=?1, status=CASE WHEN kind='expense' THEN 'pending' ELSE status END, approved_by_membership_id=CASE WHEN kind='expense' THEN NULL ELSE approved_by_membership_id END, approved_at=CASE WHEN kind='expense' THEN NULL ELSE approved_at END, approval_note=CASE WHEN kind='expense' THEN '' ELSE approval_note END, updated_at=?2, revision=revision+1, mutation_token=?3 WHERE id=?4 AND org_id=?5 AND revision=?6 AND EXISTS(SELECT 1 FROM transactions WHERE id=?7 AND mutation_token=?3)`).bind(p.notes, now, token, p.id, ctx.org.id, p.revision, txnId));
		statements.push(ctx.db.prepare("INSERT INTO purpose_audit (org_id,purpose_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,'notes_updated',?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM purposes WHERE id=?2 AND mutation_token=?8)").bind(ctx.org.id, p.id, me(ctx).id, p.status, kind === 'expense' ? 'pending' : p.status, JSON.stringify({before: markdownToPlain(p.before), after: markdownToPlain(p.notes)}), now, token));
		// Abort the entire D1 batch if the purpose changed since it was read.
		statements.push(ctx.db.prepare('INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,created_at) SELECT ?1,?2,?3,0,?4 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?5) AND NOT EXISTS(SELECT 1 FROM purposes WHERE id=?2 AND mutation_token=?5)').bind(ctx.org.id, p.id, txnId, now, token));
	}
	// Reassignment must not launder self-approval: record the union of old and
	// new responsible ids (inherited and override) as transaction history.
	const historyIds = new Set<number>([...(responsible !== null ? [responsible] : []), ...(t.responsible_membership_id !== null ? [t.responsible_membership_id] : [])]);
	for (const allocation of oldAllocations) if (allocation.responsible_membership_id !== null) historyIds.add(allocation.responsible_membership_id);
	for (const row of nextRows) if (row.override !== null) historyIds.add(row.override);
	for (const memberId of historyIds) {
		statements.push(
			ctx.db
				.prepare('INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?1 AND mutation_token=?4)')
					.bind(txnId, memberId, now, token)
		);
	}
	// Substantive allocation changes reopen the affected expense purposes.
	const reopenList = [...changedPurposeIds]
		.map((id) => ({ id, previous: oldByPurpose.get(id)?.purpose_status ?? 'pending' }))
		.filter((entry) => ['approved', 'submitted', 'changes_requested'].includes(entry.previous));
	for (const entry of reopenList) {
		statements.push(
			ctx.db
				.prepare(
						"UPDATE purposes SET status='pending',approved_by_membership_id=NULL,approved_at=NULL,approval_note='',updated_at=?1,revision=revision+1 WHERE id=?2 AND kind='expense' AND status IN ('approved','submitted','changes_requested') AND EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?4)"
					)
					.bind(now, entry.id, txnId, token),
			ctx.db
				.prepare(
						"INSERT INTO purpose_audit (org_id,purpose_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,'reopened',?4,'pending',?5,?6 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?7 AND mutation_token=?8)"
					)
					.bind(ctx.org.id, entry.id, me(ctx).id, entry.previous, JSON.stringify({ via: 'allocation change' }), now, txnId, token)
		);
	}
	statements.push(
		auditStatement(
				ctx,
				t,
				'allocations_updated',
				t.status,
				{
					before: allocSnapshot(t.responsible_membership_id, oldAllocations),
					after: allocSnapshot(responsible, afterSnapRows),
					justification
				},
				token
			),
		auditEventStatement(ctx, txnId, 'transaction.allocations_updated', token)
	);
	const won = await commitMutation(ctx, txnId, token, statements).catch(async (cause) => {
		await cleanupCreatedPurposes(ctx.db, createdPurposeIds);
		throw cause;
	});
	if (!won) {
		await cleanupCreatedPurposes(ctx.db, createdPurposeIds);
		throw error(409, 'This transaction changed while you were editing it. Reload and review the latest allocations.');
	}

	// ------------------------------------------------------- notifications
	if (responsibilityChanged) {
		for (const [key, added] of responsibilityDeltaKeys) {
			const purposeId = keyToId.get(key);
			if (purposeId === undefined) continue;
			const recipients = purposeNoticeRecipients(ctx.memberRows, ctx.roleRows, ctx.user.id, added, justification);
			if (recipients.length > 0) await enqueuePurposeNotices(ctx.db, ctx.org, purposeId, recipients, 'assignment');
		}
		await ctx.deliverMail?.();
	}
	return destination(ctx, txnId, 'Allocations saved');
}

// ----------------------------------------------------------------- submit

/** POST ?/submit. Domain-decided; the runtime update is one revision CAS. */
export async function submitDocumentation(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	if (!ctx.can('DocumentTransactions')) {
		throw error(403, `Access denied: your role does not include “${permissionLabel('DocumentTransactions')}”.`);
	}
	const loaded = await loadFull(ctx.db, ctx.org.id, txnId);
	if (!loaded) throw error(404, 'Transaction not found.');
	const { t, splits, allocations, comments, evidence } = loaded;
	if (t.amount_minor > 0) throw error(400, 'Income notes require no submission or approval.');
	requireRevision(form, t);
	const bankAbs = Math.abs(t.amount_minor);

	if (allocations.length > 0) {
		// Purposes own documentation: the allocation must be exact and every
		// expense purpose must carry evidence or Notes and an active responsible
		// member before its review can start.
		if (!allocationExact(bankAbs, allocations.map((a) => a.amount_minor))) {
			throw error(400, `Purpose allocations must add up to ${fmtMoney(bankAbs)} before review.`);
		}
		const evidenceCounts = new Map<number, number>();
	const purposeEvidence = new Map<number, EvidenceItem[]>();
		const docs = await qAll<import('./rows').DocRow & { uploader_name: string | null }>(
			ctx.db,
			`SELECT d.*, u.name AS uploader_name FROM documents d LEFT JOIN memberships m ON m.id=d.uploaded_by_membership_id LEFT JOIN users u ON u.id=m.user_id WHERE d.org_id=? AND d.purpose_id IN (${allocations.map(() => '?').join(',')}) AND d.kind='evidence' AND d.superseded=0 ORDER BY d.id`,
			[ctx.org.id, ...allocations.map((a) => a.purpose_id)]
		);
		for (const doc of docs) {
			const id = doc.purpose_id!;
			purposeEvidence.set(id, [...(purposeEvidence.get(id) ?? []), evidenceItem(doc, ctx.org.slug, doc.uploader_name)]);
			evidenceCounts.set(id, (evidenceCounts.get(id) ?? 0) + 1);
		}
		for (const allocation of allocations) {
			if (allocation.purpose_kind === 'income') continue;
			if (!purposeReady(allocation.purpose_kind, allocation.purpose_notes, evidenceCounts.get(allocation.purpose_id) ?? 0)) {
				throw error(400, `The purpose “${allocation.purpose_name}” needs evidence or Notes before review.`);
			}
			const pResponsible = await purposeResponsibles(ctx.db, allocation.purpose_id);
			const effective = effectiveResponsibles(allocation.responsible_membership_id, pResponsible, t.responsible_membership_id);
			if (effective.length === 0 || effective.every((id) => activeMem(ctx.memberRows, id) === null)) {
				throw error(400, `The purpose “${allocation.purpose_name}” needs an active responsible member before review.`);
			}
		}
		const now = nowMs();
		const token = randomHex(24);
		const statements: D1PreparedStatement[] = [
			ctx.db
				.prepare('UPDATE transactions SET revision=revision+1,updated_at=?1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5')
				.bind(now, token, txnId, ctx.org.id, t.revision),
			auditStatement(ctx, t, 'documentation_submitted', t.status, {}, token),
			auditEventStatement(ctx, txnId, 'transaction.submitted', token)
		];
		for (const allocation of allocations) {
			if (allocation.purpose_kind !== 'expense' || allocation.purpose_status === 'approved') continue;
			statements.push(
				ctx.db
					.prepare(
							"UPDATE purposes SET status='submitted',updated_at=?1,revision=revision+1 WHERE id=?2 AND status IN ('pending','changes_requested') AND EXISTS(SELECT 1 FROM transactions WHERE id=?3 AND mutation_token=?4)"
						)
					.bind(now, allocation.purpose_id, txnId, token),
				ctx.db
					.prepare(
							"INSERT INTO purpose_audit (org_id,purpose_id,actor_membership_id,action,previous_status,new_status,details,created_at) SELECT ?1,?2,?3,'submitted',?4,'submitted','{}',?5 WHERE EXISTS(SELECT 1 FROM transactions WHERE id=?6 AND mutation_token=?7)"
						)
					.bind(ctx.org.id, allocation.purpose_id, me(ctx).id, allocation.purpose_status, now, txnId, token)
			);
		}
		const won = await commitMutation(ctx, txnId, token, statements);
		if (!won) throw error(409, 'The transaction changed during submission. Reload and try again.');
		return destination(ctx, txnId, 'Documentation submitted for purpose review');
	}

	// Legacy unallocated expense path (pre-purpose records).
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
	const { t, splits, allocations, comments, evidence } = loaded;
	if (t.amount_minor > 0) throw error(400, 'Income notes require no approval or change request.');
	if (allocations.length > 0) {
		throw error(400, 'Each purpose is approved individually — open a purpose from the allocation list.');
	}
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
		await ctx.deliverMail?.();
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
	await ctx.deliverMail?.();
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

/** POST ?/document. Magic-byte content detection; the R2 object is written
 * first, and on a losing CAS it is retained for recovery rather than deleted. */
export async function uploadDocument(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	if (t.amount_minor <= 0 || !(await mayDocument(ctx, t))) throw error(403, 'Income documentation access denied.');
	const value = form.get('file');
	const file = value instanceof File ? value : null;
	if (file === null) throw error(400, 'Choose a supporting document.');
	requireRevision(form, t);
	if (file.size === 0 || file.size > 10 * 1024 * 1024) {
		throw error(400, 'Supporting documents must be between 1 byte and 10 MB.');
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const contentType = sniffDocType(bytes);
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

/** Move legacy transaction evidence to one allocated purpose atomically. */
export async function moveEvidence(ctx: TxnCtx, txnId: number, form: FormData): Promise<never> {
	const t = await txnById(ctx.db, ctx.org.id, txnId);
	if (!t) throw error(404, 'Transaction not found.');
	if (t.amount_minor > 0 || !ctx.can('DocumentTransactions')) throw error(403, 'Documentation access denied.');
	requireRevision(form, t);
	const documentId = formInt(form, 'documentId');
	const purposeId = formInt(form, 'purposeId');
	if (documentId === null || purposeId === null) throw error(400, 'Choose evidence and a purpose.');
	const document = await docById(ctx.db, ctx.org.id, documentId);
	if (!document || document.transaction_id !== txnId || document.purpose_id !== null || document.kind !== 'evidence' || document.superseded !== 0) throw error(404, 'Unassigned evidence not found.');
	const allocation = await qOne<{ id: number }>(ctx.db, 'SELECT id FROM allocations WHERE org_id=?1 AND transaction_id=?2 AND purpose_id=?3', [ctx.org.id, txnId, purposeId]);
	if (!allocation) throw error(400, 'Choose a purpose allocated to this transaction.');
	const token = randomHex(24);
	const won = await commitMutation(ctx, txnId, token, [
		ctx.db.prepare('UPDATE transactions SET updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5').bind(nowMs(), token, txnId, ctx.org.id, t.revision),
		ctx.db.prepare("UPDATE documents SET purpose_id=?1,transaction_id=NULL WHERE id=?2 AND org_id=?3 AND transaction_id=?4 AND purpose_id IS NULL AND kind='evidence' AND superseded=0 AND EXISTS(SELECT 1 FROM transactions WHERE id=?4 AND mutation_token=?5) AND EXISTS(SELECT 1 FROM allocations WHERE org_id=?3 AND transaction_id=?4 AND purpose_id=?1)").bind(purposeId, documentId, ctx.org.id, txnId, token),
		auditStatement(ctx, t, 'evidence_attached', t.status, { filename: document.filename, purposeId }, token),
		auditEventStatement(ctx, txnId, 'transaction.evidence_attached', token)
	]);
	if (!won) throw error(409, 'The transaction changed. Reload before moving evidence.');
	return destination(ctx, txnId, 'Evidence moved to purpose');
}

/** GET /org/:slug/documents/:id. Same-org lookup first; without
 * ViewTransactions only income recipients of the tied income transaction may
 * download (purpose evidence requires ViewTransactions). Missing bucket
 * content reports 404 while the metadata row stays. */
export async function downloadDocument(ctx: TxnCtx, documentId: number, download = false): Promise<Response> {
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
	const allowed = ['application/pdf', 'image/png', 'image/jpeg'].includes(document.content_type);
	return new Response(bytes, {
		headers: {
			'Content-Type': allowed ? document.content_type : 'application/octet-stream',
			'Content-Disposition': `${download || !allowed ? 'attachment' : 'inline'}; filename="${filename === '' ? 'document' : filename}"`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "frame-ancestors 'self'"
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
