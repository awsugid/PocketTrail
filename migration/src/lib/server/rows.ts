// D1 row structs and domain-aggregate builders, ported from
// src/web/aggregate.rs. Every read is org-scoped in SQL.

import type { D1Database } from '$lib/d1';
import { qAll, qOne } from './db';
import { extractMentions, resolveMentions } from '$lib/mentions';
import { fmtTs } from '$lib/fmt';
import { documentationOwed, incomeComplete, runtimeStatus, validateDocumentation, type DomTxn, type DocStatus, type Documentation, type Purpose } from '$lib/domain';
import { parseRolePermissions, type Permission } from './permissions';

export interface OrgRow {
	id: number;
	slug: string;
	name: string;
	is_synthetic: number;
	notifications_enabled: number;
	notification_cutoff_date: string | null;
	notification_revision: number;
	created_at: number;
	creator_membership_id: number | null;
	income_explanation_role_id: number | null;
}

export interface RoleRow {
	id: number;
	org_id: number;
	name: string;
	permissions: string;
}

/** membership joined with its user (memberships always reference a user). */
export interface MemRow {
	id: number;
	org_id: number;
	user_id: string;
	role_id: number;
	handle: string;
	created_at: number;
	removed_at: number | null;
	name: string;
	email: string;
}

export const memActive = (m: MemRow) => m.removed_at === null;

/** Resolve a responsible membership id to an ACTIVE membership row of this
 * org; null when unassigned/removed/foreign. */
export function activeMem(mems: readonly MemRow[], id: number | null | undefined): MemRow | null {
	if (id === null || id === undefined) return null;
	const m = mems.find((candidate) => candidate.id === id);
	return m && memActive(m) ? m : null;
}

export interface TxnRow {
	id: number;
	org_id: number;
	pocket_id: number;
	bank_id: string | null;
	txn_date: string;
	txn_time: string | null;
	counterparty: string;
	transaction_type: string;
	bank_notes: string;
	amount_minor: number;
	balance_minor: number | null;
	explanation: string;
	evidence_unavailable_reason: string;
	responsible_membership_id: number | null;
	status: string;
	approved_by_membership_id: number | null;
	approved_at: number | null;
	approval_note: string;
	suppressed: number;
	suppressed_by_membership_id: number | null;
	suppressed_reason: string;
	suppressed_at: number | null;
	import_batch_id: number | null;
	comment_cursor: number;
	created_at: number;
	updated_at: number;
	revision: number;
	mutation_token: string;
}

export interface SplitRow {
	id: number;
	transaction_id: number;
	label: string;
	amount_minor: number;
	responsible_membership_id: number | null;
	created_at: number;
}

export interface CommentRow {
	id: number;
	org_id: number;
	transaction_id: number;
	author_membership_id: number;
	body: string;
	created_at: number;
	author_name: string;
}

export interface DocRow {
	id: number;
	org_id: number;
	transaction_id: number | null;
	import_batch_id: number | null;
	kind: string;
	r2_key: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	note: string;
	superseded: number;
	uploaded_by_membership_id: number;
	created_at: number;
}

export interface PocketRow {
	id: number;
	org_id: number;
	name: string;
	opening_balance_minor: number;
	owner_membership_id: number | null;
}

export interface MappingRow {
	id: number;
	pocket_id: number;
	pattern: string;
	membership_id: number;
	member_name: string;
}

export async function orgBySlug(db: D1Database, slug: string): Promise<OrgRow | null> {
	return qOne<OrgRow>(db, 'SELECT * FROM organizations WHERE slug = ?1', [slug]);
}

export async function orgsOfUser(db: D1Database, userId: string): Promise<Array<{ slug: string; name: string }>> {
	return qAll<{ slug: string; name: string }>(
		db,
		`SELECT o.slug, o.name FROM organizations o JOIN memberships m ON m.org_id = o.id
		 WHERE m.user_id = ?1 AND m.removed_at IS NULL ORDER BY o.name`,
		[userId]
	);
}

export async function rolesOfOrg(db: D1Database, orgId: number): Promise<RoleRow[]> {
	return qAll<RoleRow>(db, 'SELECT id, org_id, name, permissions FROM roles WHERE org_id = ?1 ORDER BY id', [orgId]);
}

export async function memsOfOrg(db: D1Database, orgId: number): Promise<MemRow[]> {
	return qAll<MemRow>(
		db,
		`SELECT m.id, m.org_id, m.user_id, m.role_id, m.handle, m.created_at, m.removed_at, u.name, u.email
		 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?1 ORDER BY m.id`,
		[orgId]
	);
}

export async function txnById(db: D1Database, orgId: number, id: number): Promise<TxnRow | null> {
	return qOne<TxnRow>(db, 'SELECT * FROM transactions WHERE id = ?1 AND org_id = ?2', [id, orgId]);
}

export async function splitsOf(db: D1Database, txnId: number): Promise<SplitRow[]> {
	return qAll<SplitRow>(db, 'SELECT * FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id', [txnId]);
}

export async function commentsOf(db: D1Database, txnId: number): Promise<CommentRow[]> {
	return qAll<CommentRow>(
		db,
		`SELECT c.id, c.org_id, c.transaction_id, c.author_membership_id, c.body, c.created_at, u.name AS author_name
		 FROM comments c JOIN memberships m ON m.id = c.author_membership_id JOIN users u ON u.id = m.user_id
		 WHERE c.transaction_id = ?1 ORDER BY c.id`,
		[txnId]
	);
}

export async function evidenceOf(db: D1Database, txnId: number): Promise<DocRow[]> {
	return qAll<DocRow>(
		db,
		"SELECT * FROM documents WHERE transaction_id = ?1 AND kind = 'evidence' AND superseded = 0 ORDER BY id",
		[txnId]
	);
}

export async function pocketsOf(db: D1Database, orgId: number): Promise<PocketRow[]> {
	return qAll<PocketRow>(db, 'SELECT * FROM pockets WHERE org_id = ?1 ORDER BY id', [orgId]);
}

export async function mappingsOf(db: D1Database, orgId: number): Promise<MappingRow[]> {
	return qAll<MappingRow>(
		db,
		`SELECT a.id, a.pocket_id, a.pattern, a.membership_id, u.name AS member_name
		 FROM actor_mappings a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
		 WHERE a.org_id = ?1 ORDER BY a.pattern`,
		[orgId]
	);
}

export async function docById(db: D1Database, orgId: number, id: number): Promise<DocRow | null> {
	return qOne<DocRow>(db, 'SELECT * FROM documents WHERE id = ?1 AND org_id = ?2', [id, orgId]);
}

export async function historyOf(db: D1Database, txnId: number): Promise<number[]> {
	const rows = await qAll<{ membership_id: number }>(
		db,
		'SELECT membership_id FROM responsible_history WHERE transaction_id = ?1',
		[txnId]
	);
	return rows.map((row) => row.membership_id);
}

/** Best-effort actor mapping: exact, trimmed, case-insensitive label match
 * within one pocket. */
export function mapCounterparty(mappings: readonly MappingRow[], pocketId: number, counterparty: string): MappingRow | null {
	const want = counterparty.trim().toLowerCase();
	return mappings.find((m) => m.pocket_id === pocketId && m.pattern.trim().toLowerCase() === want) ?? null;
}

/** A tiny DecisionOrg view over freshly read rows: the single authorization
 * vocabulary every decision uses. */
export function decisionOrgFor(mems: readonly MemRow[], roles: readonly RoleRow[], userId: string) {
	const me = mems.find((m) => m.user_id === userId) ?? null;
	const active = me !== null && memActive(me);
	const granted = new Set<Permission>();
	if (me && active) {
		for (const role of roles) {
			if (role.id !== me.role_id) continue;
			for (const p of parseRolePermissions(role.permissions)) granted.add(p);
		}
	}
	return {
		memberExists: () => me !== null,
		memberIsActive: () => active,
		permissionsOf: () => granted
	};
}

/** Build the domain transaction aggregate from persisted rows. Convention:
 * the bank record is signed, purpose amounts are positive magnitudes summing
 * to abs(bank amount). `exclusions` are membership ids of every historical
 * responsible member (anti self-approval laundering). */
export function buildDomTxn(
	t: TxnRow,
	splits: readonly SplitRow[],
	evidence: readonly DocRow[],
	mems: readonly MemRow[],
	exclusions: readonly number[]
): DomTxn {
	const mem = (id: number | null | undefined) => (id === null || id === undefined ? null : mems.find((m) => m.id === id) ?? null);
	const responsible = mem(t.responsible_membership_id);
	const userIdOf = (m: MemRow | null | undefined) => (m ? m.user_id : '');
	const bankMagnitude = Math.abs(t.amount_minor);

	const purposes: Purpose[] =
		splits.length === 0
			? [
					{
						id: '0',
						name: t.explanation.trim() === '' ? `Movement from ${t.counterparty}` : t.explanation,
						amount: bankMagnitude,
						responsibleUserId: userIdOf(responsible)
					}
				]
			: splits.map((s) => ({
					id: String(s.id),
					name: s.label,
					amount: s.amount_minor,
					responsibleUserId: userIdOf(mem(s.responsible_membership_id) ?? responsible)
				}));

	const documentation: Documentation = {
		explanation: t.explanation,
		evidence: evidence.map((d) => d.r2_key),
		evidenceUnavailableReason: t.evidence_unavailable_reason.trim() === '' ? null : t.evidence_unavailable_reason
	};

	const exclusionUsers = new Set<string>();
	for (const id of exclusions) {
		const m = mem(id);
		if (m) exclusionUsers.add(m.user_id);
	}

	const complete = t.amount_minor > 0 ? incomeComplete(t.explanation) : validateDocumentation(previewTxn(t, purposes, documentation)) === null;
	const status: DocStatus = runtimeStatus(t.status, complete);

	return {
		id: String(t.id),
		direction: t.amount_minor < 0 ? 'out' : 'in',
		amount: bankMagnitude,
		date: t.txn_date,
		purposes,
		documentation,
		status,
		approvalExclusions: exclusionUsers
	};
}

function previewTxn(t: TxnRow, purposes: Purpose[], documentation: Documentation): DomTxn {
	return {
		id: String(t.id),
		direction: t.amount_minor < 0 ? 'out' : 'in',
		amount: Math.abs(t.amount_minor),
		date: t.txn_date,
		purposes,
		documentation,
		status: 'draft',
		approvalExclusions: new Set<string>()
	};
}

/** Persisted-status badge info: documentation still owed by the responsible
 * member (Draft/ChangesRequested domain states). */
export function rowNeedsDetails(t: Pick<TxnRow, 'amount_minor' | 'explanation' | 'evidence_unavailable_reason' | 'status'>, evidenceCount: number): boolean {
	if (t.amount_minor > 0) return !incomeComplete(t.explanation);
	const complete =
		t.explanation.trim() !== '' &&
		(evidenceCount > 0 || t.evidence_unavailable_reason.trim() !== '');
	return documentationOwed(t.status, complete);
}

/** Mention author/handle resolution for a stored comment body, restricted to
 * active members. Returns membership ids. */
export function mentionMembershipIds(body: string, mems: readonly MemRow[]): number[] {
	const handles: Array<[string, number]> = mems
		.filter((m) => memActive(m))
		.map((m) => [m.handle.toLowerCase(), m.id] as [string, number]);
	return resolveMentions(extractMentions(body), handles);
}

/** Timestamp string used in domain suppression/comments (display only). */
export const tsLabel = fmtTs;