// Notification enqueue call sites for the transaction journey, ported from
// src/web/notify.rs (enqueue_for, enqueue_mentions, enqueue_assignment and the
// gated insert_row INSERT ... SELECT). Integration note: the notify integrator
// may move/merge this file; the SQL and gating rules here must stay identical
// to the Rust application.
//
// Bodies never carry financial details or attachments (product policy): they
// name the organization, the fact of a task/mention, and the in-app link only.

import { extractMentions } from '$lib/mentions';
import { documentationOwed, incomeComplete, incomeRecipients } from '$lib/domain';
import { shouldNotify } from '$lib/notify_rules';
import { permissionsFor, type Permission } from './permissions';
import { exec, nowMs, qOne } from './db';
import { evidenceOf, memActive, splitsOf, type MemRow, type OrgRow, type RoleRow, type TxnRow } from './rows';
import type { D1Database } from '$lib/d1';

const memberRefs = (mems: readonly MemRow[]) =>
	mems.map((row) => ({ userId: row.user_id, roleId: row.role_id, active: row.removed_at === null }));

const roleRefs = (roles: readonly RoleRow[]) => roles.map((row) => ({ id: row.id, permissions: row.permissions }));

const hasPermission = (mems: readonly MemRow[], roles: readonly RoleRow[], member: MemRow, permission: Permission): boolean =>
	permissionsFor(memberRefs(mems), roleRefs(roles), member.user_id).has(permission);

// ------------------------------------------------------------- mention match

/** One candidate recipient for @mention resolution (pre-filtered by the
 * caller to active members holding ViewTransactions, author excluded). */
interface MentionCand {
	id: number;
	/** Lowercased handle (comment tokens match this exactly). */
	handle: string;
	/** Display name as inserted by UI mention chips ("@Full Name"). */
	name: string;
}

/** Memberships mentioned in `body`: exact `@handle` tokens plus exact
 * `@Display Name` spans (case-insensitive, word boundaries on the outer edge
 * so `x@Alice` and `@Alice2` never match). Deduped, input order. Port of
 * mention_recipients + name_mentioned in src/web/notify.rs. */
export function mentionRecipients(body: string, cands: readonly MentionCand[]): number[] {
	const lower = body.toLowerCase();
	const tokens = extractMentions(body);
	const out: number[] = [];
	for (const cand of cands) {
		const hit = tokens.some((t) => t === cand.handle) || nameMentioned(lower, cand.name.trim().toLowerCase());
		if (hit && !out.includes(cand.id)) out.push(cand.id);
	}
	return out;
}

function nameMentioned(lowerBody: string, lowerName: string): boolean {
	if (lowerName === '') return false;
	const pat = `@${lowerName}`;
	let from = 0;
	while (from <= lowerBody.length) {
		const pos = lowerBody.indexOf(pat, from);
		if (pos < 0) return false;
		const beforeOk = pos === 0 || !isAlnum(lowerBody[pos - 1]);
		const after = pos + pat.length;
		const afterOk = after >= lowerBody.length || !isAlnum(lowerBody[after]);
		if (beforeOk && afterOk) return true;
		from = pos + 1;
	}
	return false;
}

const isAlnum = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9]/.test(ch);

// ------------------------------------------------------------------- enqueue

const INSERT_ROW_SQL =
	"INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, subject, body, created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 FROM organizations o JOIN memberships m ON m.org_id=o.id JOIN roles r ON r.id=m.role_id AND r.org_id=o.id LEFT JOIN transactions t ON t.id=?4 AND t.org_id=o.id WHERE o.id=?1 AND o.notifications_enabled=1 AND m.id=?3 AND m.removed_at IS NULL AND (?8 IS NULL OR o.notification_revision=?8) AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (?4 IS NULL AND ?2='digest' AND (m.role_id=o.income_explanation_role_id OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND EXISTS(SELECT 1 FROM pockets p WHERE p.org_id=o.id AND p.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND ((m.role_id=o.income_explanation_role_id) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=o.id))))) AND (?4 IS NULL OR (t.id IS NOT NULL AND t.suppressed=0 AND (?2='mention' OR o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date)))";

/** SQL-level re-check of the enqueue gates (org enabled, active membership,
 * role/income predicates, suppression, cutoff). `expectedRevision` pins a
 * digest to the organization snapshot it read; assignment/mention pass null.
 * Port of insert_row in src/web/notify.rs. */
async function insertRow(
	db: D1Database,
	orgId: number,
	kind: string,
	toMid: number,
	txnId: number | null,
	subject: string,
	body: string,
	now: number,
	expectedRevision: number | null
): Promise<void> {
	await exec(db, INSERT_ROW_SQL, [orgId, kind, toMid, txnId, subject, body, now, expectedRevision]);
}

/** Core enqueue: gates each recipient through shouldNotify (org enabled, not
 * suppressed, active member, cutoff for assignments). Port of enqueue_for. */
async function enqueueFor(
	db: D1Database,
	org: OrgRow,
	mems: readonly MemRow[],
	t: TxnRow,
	recipients: readonly number[],
	kind: 'assignment' | 'mention'
): Promise<void> {
	const suppressed = t.suppressed !== 0;
	const cutoff = org.notification_cutoff_date !== null && org.notification_cutoff_date !== '' ? org.notification_cutoff_date : null;
	const enabled = org.notifications_enabled !== 0;
	const now = nowMs();
	for (const mid of recipients) {
		const member = mems.find((m) => m.id === mid);
		if (!member) continue;
		if (!shouldNotify(kind, enabled, suppressed, memActive(member), t.txn_date, cutoff)) continue;
		const link = `/org/${org.slug}/transactions/${t.id}`;
		const [subject, body] =
			kind === 'mention'
				? [`You were mentioned — ${org.name}`, `You were mentioned in ${org.name}. Sign in to read the discussion.\n${link}`]
				: [`Documentation assignment — ${org.name}`, `A transaction needs your documentation in ${org.name}.\n${link}`];
		await insertRow(db, org.id, kind, mid, t.id, subject, body, now, null);
	}
}

async function incomeRecipientsFor(db: D1Database, org: OrgRow, mems: readonly MemRow[], t: TxnRow): Promise<number[]> {
	const pocket = await qOne<{ owner_membership_id: number | null }>(
		db,
		'SELECT owner_membership_id FROM pockets WHERE id=?1 AND org_id=?2',
		[t.pocket_id, org.id]
	);
	return incomeRecipients(
		org.income_explanation_role_id,
		pocket?.owner_membership_id ?? null,
		mems.map((m) => ({ id: m.id, roleId: m.role_id, active: memActive(m) }))
	);
}

/** Enqueue mention notifications for a stored comment. Resolves both
 * `@handle` tokens and UI-chip `@Full Name` spans against ACTIVE members
 * holding ViewTransactions (income recipients also qualify for income
 * movements), excluding the author. Exact matches only; no replay — one call
 * covers exactly this comment body. Port of enqueue_mentions. */
export async function enqueueMentions(
	db: D1Database,
	org: OrgRow,
	mems: readonly MemRow[],
	roles: readonly RoleRow[],
	authorUserId: string,
	t: TxnRow,
	body: string
): Promise<void> {
	const incomeRecps = t.amount_minor > 0 ? await incomeRecipientsFor(db, org, mems, t) : [];
	const cands: MentionCand[] = mems
		.filter((m) => memActive(m) && m.user_id !== authorUserId)
		.filter((m) => incomeRecps.includes(m.id) || hasPermission(mems, roles, m, 'ViewTransactions'))
		.map((m) => ({ id: m.id, handle: m.handle.toLowerCase(), name: m.name.trim() }));
	const ids = mentionRecipients(body, cands);
	await enqueueFor(db, org, mems, t, ids, 'mention');
}

/** Enqueue the initial assignment notice to the transaction-level responsible
 * member (no-op when unassigned; inactive/removed members are gated out).
 * Port of enqueue_assignment. */
export async function enqueueAssignment(
	db: D1Database,
	org: OrgRow,
	mems: readonly MemRow[],
	roles: readonly RoleRow[],
	t: TxnRow
): Promise<void> {
	if (t.amount_minor > 0) {
		if (incomeComplete(t.explanation)) return;
		await enqueueFor(db, org, mems, t, await incomeRecipientsFor(db, org, mems, t), 'assignment');
		return;
	}
	const evidence = await evidenceOf(db, t.id);
	const complete = t.explanation.trim() !== '' && (evidence.length > 0 || t.evidence_unavailable_reason.trim() !== '');
	if (!documentationOwed(t.status, complete)) return;
	const recipientIds = new Set<number>();
	if (t.responsible_membership_id !== null) recipientIds.add(t.responsible_membership_id);
	for (const split of await splitsOf(db, t.id)) {
		if (split.responsible_membership_id !== null) recipientIds.add(split.responsible_membership_id);
	}
	const recipients = [...recipientIds].filter((mid) => {
		const member = mems.find((m) => m.id === mid);
		return member !== undefined && hasPermission(mems, roles, member, 'ViewTransactions');
	});
	await enqueueFor(db, org, mems, t, recipients, 'assignment');
}