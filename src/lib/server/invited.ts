// Invited members: the membership an invitation creates up front so the
// invitee can be mapped, made responsible, and emailed before accepting.
// See CONTEXT.md "Invited member". Statements here are composed into the
// caller's D1 batch so the invitation and its membership change atomically.

import type { D1Database, D1PreparedStatement } from '#lib/d1.ts';
import { PLACEHOLDER_USER_PREFIX } from './rows';
import { randomHex } from './tokens';

/** Create (or refresh) the invited membership for `email`. A placeholder user
 * is created only when no user row carries that email yet. An existing
 * active, accepted membership is never touched; a removed or still-invited
 * one becomes invited with the new role. */
export function inviteMembershipStatements(
	db: D1Database,
	orgId: number,
	email: string,
	roleId: number,
	now: number
): D1PreparedStatement[] {
	const placeholder = `${PLACEHOLDER_USER_PREFIX}${randomHex(16)}`;
	return [
		db
			.prepare(
				'INSERT INTO users(id,email,name,created_at) SELECT ?1,?2,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=?2 COLLATE NOCASE)'
			)
			.bind(placeholder, email, now),
		db
			.prepare(
				'INSERT INTO memberships(org_id,user_id,role_id,handle,created_at,invited) SELECT ?1,u.id,?2,u.id,?3,1 FROM users u WHERE u.email=?4 COLLATE NOCASE ON CONFLICT(org_id,user_id) DO UPDATE SET role_id=excluded.role_id,removed_at=NULL,invited=1 WHERE memberships.removed_at IS NOT NULL OR memberships.invited=1'
			)
			.bind(orgId, roleId, now, email)
	];
}

/** Withdraw an invited member: end the membership, drop their mappings, and
 * hand expenses still pending documentation back to each pocket's owner
 * (recorded in responsible history). Only ever affects invited=1 rows, so an
 * accepted member is never touched by an invitation revoke. */
export function withdrawInvitedStatements(
	db: D1Database,
	orgId: number,
	email: string,
	now: number
): D1PreparedStatement[] {
	const invited =
		'SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=?1 AND m.invited=1 AND m.removed_at IS NULL AND u.email=?2 COLLATE NOCASE';
	return [
		db
			.prepare(`DELETE FROM actor_mappings WHERE org_id=?1 AND membership_id IN (${invited})`)
			.bind(orgId, email),
		db
			.prepare(
				`UPDATE transactions SET responsible_membership_id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=transactions.pocket_id AND p.org_id=?1), updated_at=?3, revision=revision+1 WHERE org_id=?1 AND amount_minor<0 AND status='pending' AND responsible_membership_id IN (${invited})`
			)
			.bind(orgId, email, now),
		db
			.prepare(
				`UPDATE transaction_splits SET responsible_membership_id=NULL WHERE responsible_membership_id IN (${invited}) AND transaction_id IN (SELECT id FROM transactions WHERE org_id=?1 AND status='pending')`
			)
			.bind(orgId, email),
		db
			.prepare(
				'INSERT OR IGNORE INTO responsible_history(transaction_id,membership_id,since) SELECT t.id,t.responsible_membership_id,?2 FROM transactions t WHERE t.org_id=?1 AND t.updated_at=?2 AND t.responsible_membership_id IS NOT NULL'
			)
			.bind(orgId, now),
		db
			.prepare(`UPDATE memberships SET removed_at=?3 WHERE id IN (${invited})`)
			.bind(orgId, email, now)
	];
}
