// Append-only audit trail (audit_events) helpers, ported from src/web/audit.rs.
// The request layer records intent (attempt), rejections (denied) and failures
// (failed); the statement that performs a change records `committed` inside the
// same transaction. Never store request bodies, query strings, credentials, or
// amounts.

import type { D1Database, D1PreparedStatement } from '$lib/d1';
import { exec, nowMs, qAll, qOne } from './db';
import { PAGE_SIZE, normalizeTarget, observe, orgSlug, pageOffset, type ObserveDecision } from './audit_rules';

export interface Attempt {
	actor: string | null;
	org: number | null;
	action: string;
	target: string;
	/** True when an attempt row was written (mutations and private
	 * downloads); false for watched private page views, where only explicit
	 * denials are ever recorded. */
	intent: boolean;
	/** Watched requests resolve their org scope lazily: only a recorded
	 * denial needs it, so ordinary page views skip the lookup. */
	watchSlug: string | null;
}

async function record(
	db: D1Database,
	a: Pick<Attempt, 'actor' | 'org' | 'action' | 'target'>,
	outcome: string
): Promise<void> {
	await exec(db, INSERT_VALUES, [a.actor, a.org, a.action, a.target, outcome, nowMs()]);
}

const INSERT_VALUES =
	'INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,?5,?6)';

/** Decide what the request layer observes and, for real intents, write the
 * attempt row before the handler runs. `actor` is the signed-in user id or
 * null for anonymous/preauth sessions. */
export async function auditBegin(
	db: D1Database,
	path: string,
	post: boolean,
	actor: string | null
): Promise<Attempt | null> {
	const observed: ObserveDecision | null = observe(path, post);
	if (!observed) return null;
	const slug = orgSlug(path);
	const org = observed.intent && slug ? await orgIdBySlug(db, slug) : null;
	const attempt: Attempt = {
		actor,
		org,
		action: observed.action,
		target: normalizeTarget(path),
		intent: observed.intent,
		watchSlug: observed.intent ? null : slug
	};
	if (observed.intent) await record(db, attempt, 'attempt');
	return attempt;
}

async function orgIdBySlug(db: D1Database, slug: string): Promise<number | null> {
	const row = await qOne<{ id: number }>(db, 'SELECT id FROM organizations WHERE slug = ?1', [slug]);
	return row ? row.id : null;
}

/** Classify the outcome at request end; a null classification (watched page
 * view, or success owned by the mutation's own transaction) writes nothing. */
export async function auditFinish(
	db: D1Database,
	a: Attempt | null,
	outcome: string | null
): Promise<void> {
	if (!a || !outcome) return;
	let scope = a;
	if (a.watchSlug) {
		const org = await orgIdBySlug(db, a.watchSlug);
		scope = { ...a, org, watchSlug: null };
	}
	await record(db, scope, outcome);
}

/** Committed-outcome statement to append to a mutation's D1 batch, so the
 * audit row commits atomically with the change it describes. Scope rule:
 * org-scoped handlers pass the org id; platform/global events pass null. */
export function committed(
	db: D1Database,
	org: number | null,
	actor: string,
	action: string,
	target: string
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)"
		)
		.bind(actor, org, action, target, nowMs());
}

/** Change-gated variant for single-statement UPDATE/DELETE mutations: the
 * audit row is written only when the immediately preceding statement in the
 * same batch matched a row (changes() = 1). */
export function committedIfChanged(
	db: D1Database,
	org: number | null,
	actor: string,
	action: string,
	target: string
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,?3,?4,'committed',?5 WHERE changes()=1"
		)
		.bind(actor, org, action, target, nowMs());
}

/** One-shot committed event outside any mutation (authentication lifecycle). */
export async function auditEvent(
	db: D1Database,
	actor: string | null,
	org: number | null,
	action: string,
	target: string
): Promise<void> {
	await record(db, { actor, org, action, target }, 'committed');
}

export interface AuditEventView {
	id: number;
	actor_id: string | null;
	actor_name: string | null;
	org_id: number | null;
	action: string;
	target: string;
	outcome: string;
	created_at: number;
}

/** One page of an organization's audit trail (org-admin scope: own org only). */
export function listOrg(db: D1Database, org: number, page: number): Promise<AuditEventView[]> {
	return qAll<AuditEventView>(
		db,
		`SELECT a.*, u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
		 WHERE a.org_id=?1 ORDER BY a.id DESC LIMIT ?2 OFFSET ?3`,
		[org, PAGE_SIZE + 1, pageOffset(page)]
	);
}

/** One page of the global trail (platform scope: org_id IS NULL only). */
export function listPlatform(db: D1Database, page: number): Promise<AuditEventView[]> {
	return qAll<AuditEventView>(
		db,
		`SELECT a.*, u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
		 WHERE a.org_id IS NULL ORDER BY a.id DESC LIMIT ?1 OFFSET ?2`,
		[PAGE_SIZE, pageOffset(page)]
	);
}