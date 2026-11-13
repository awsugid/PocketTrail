// Pending invitations never grant access until explicitly accepted by a
// matching verified Google user, either from Organizations or through the
// single-use emailed link. Ported from src/web/invitations.rs. Delivery rows
// are durable: create/resend only records send outcomes, they never undo the
// invitation itself. Raw tokens live in links only; D1 stores the SHA-256
// hash, and the token never lands in audit rows, logs, or redirects.

import { error, redirect } from '@sveltejs/kit';
import type { D1Database, D1PreparedStatement, D1Result } from '$lib/d1';
import { assertFormCsrf, assertSameOrigin, requireLogin, type CtxEvent, type LoginState } from './auth';
import { normalizeTarget } from './audit_rules';
import { nowMs, qAll, qOne } from './db';
import { rolesOfOrg } from './rows';
import { validEmail } from './profile';
import { encodeToken, hashToken, randomHex } from './tokens';
import { deliverMail, msgQuery, outcomeMessage, type MailEnv } from './invitation_mail';

export interface PendingInvitation {
	id: string;
	email: string;
	orgName: string;
	roleName: string;
	expiresAt: number;
}

/** Still-open invitations offered to the signed-in visitor (Organizations). */
export async function pendingInvitations(
	db: D1Database,
	email: string
): Promise<PendingInvitation[]> {
	return qAll<PendingInvitation>(
		db,
		'SELECT i.id,i.email,o.name AS org_name,r.name AS role_name,i.expires_at FROM invitations i JOIN organizations o ON o.id=i.org_id JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.email=?1 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2',
		[email, nowMs()]
	);
}

function str(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

// ------------------------------------------------------------------ create

export async function createInvitation(
	ctx: TenantContextLike,
	form: FormData,
	env: MailEnv,
	baseUrl: string
): Promise<never> {
	const email = str(form, 'email')
		.trim()
		.toLowerCase();
	if (!validEmail(email)) {
		throw error(400, 'Enter a valid email address.');
	}
	const role = Number(str(form, 'role_id'));
	const roleId = Number.isSafeInteger(role) ? role : 0;
	const roles = await rolesOfOrg(ctx.db, ctx.org.id);
	if (!roles.some((r) => r.id === roleId)) {
		throw error(400, 'Choose an organization role.');
	}
	if (ctx.memberRows.some((m) => m.removed_at === null && m.email.toLowerCase() === email.toLowerCase())) {
		throw error(400, 'This person is already an active member.');
	}
	const roleName = roles.find((r) => r.id === roleId)?.name ?? '';
	const id = randomHex(32);
	const token = encodeToken();
	const now = nowMs();
	const expiresAt = now + 7 * 86400000;
	await ctx.db.batch([
		ctx.db
			.prepare(
				'UPDATE invitations SET revoked_at=?1 WHERE org_id=?2 AND email=?3 COLLATE NOCASE AND revoked_at IS NULL AND accepted_at IS NULL'
			)
			.bind(now, ctx.org.id, email),
		ctx.db
			.prepare(
				'INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)'
			)
			.bind(id, ctx.org.id, email, roleId, ctx.user.id, now, expiresAt),
		ctx.db
			.prepare(
				"INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) VALUES(?1,?2,'pending',?3)"
			)
			.bind(id, hashToken(token), now),
		committedEvent(ctx.db, ctx.org.id, ctx.user.id, 'invitation.created', normalizeTarget(ctx.path))
	]);
	const outcome = await deliverMail(env, ctx.db, {
		invitationId: id,
		token,
		baseUrl
	});
	return redirect(303, `/org/${ctx.org.slug}/settings?${msgQuery(outcomeMessage(outcome))}`);
}

// ------------------------------------------------------------------ resend

interface OpenInvitation {
	email: string;
	role_name: string;
	expires_at: number;
}

async function openInvitation(
	db: D1Database,
	orgId: number,
	id: string,
	now: number
): Promise<OpenInvitation | null> {
	return qOne<OpenInvitation>(
		db,
		'SELECT i.email,r.name AS role_name,i.expires_at FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?1 AND i.org_id=?2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3',
		[id, orgId, now]
	);
}

export async function resendInvitation(
	ctx: TenantContextLike,
	id: string,
	env: MailEnv,
	baseUrl: string
): Promise<never> {
	const now = nowMs();
	const inv = await openInvitation(ctx.db, ctx.org.id, id, now);
	if (!inv) throw error(404, 'Invitation not found.');
	const token = encodeToken();
	// The batch itself re-validates that the invitation is still open, so a
	// concurrent revoke/accept between the pre-check above and this batch
	// produces no supersede, no new delivery row, no audit event, no send.
	const results = await ctx.db.batch([
		ctx.db
			.prepare(
				"UPDATE invitation_mail SET status='superseded' WHERE invitation_id=?1 AND status!='superseded' AND EXISTS(SELECT 1 FROM invitations i WHERE i.id=?1 AND i.org_id=?2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3)"
			)
			.bind(id, ctx.org.id, now),
		ctx.db
			.prepare(
				"INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) SELECT ?1,?2,'pending',?3 WHERE EXISTS(SELECT 1 FROM invitations i WHERE i.id=?1 AND i.org_id=?4 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?3)"
			)
			.bind(id, hashToken(token), now, ctx.org.id),
		ctx.db
			.prepare(
				"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.resent',?2,'committed',?5 FROM invitations i WHERE i.id=?3 AND (SELECT changes())=1"
			)
			.bind(ctx.user.id, normalizeTarget(ctx.path), id, ctx.org.id, now)
	]);
	const inserted = changesOf(results[1]) === 1;
	if (!inserted) throw error(404, 'Invitation is no longer open.');
	const outcome = await deliverMail(env, ctx.db, { invitationId: id, token, baseUrl });
	return redirect(303, `/org/${ctx.org.slug}/settings?${msgQuery(outcomeMessage(outcome))}`);
}

// ------------------------------------------------------------------ revoke

export async function revokeInvitation(ctx: TenantContextLike, id: string): Promise<never> {
	await ctx.db.batch([
		ctx.db
			.prepare(
				'UPDATE invitations SET revoked_at=?1 WHERE id=?2 AND org_id=?3 AND accepted_at IS NULL AND revoked_at IS NULL'
			)
			.bind(nowMs(), id, ctx.org.id),
		ctx.db
			.prepare(
				"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.revoked',?2,'committed',?5 FROM invitations i WHERE i.id=?3 AND i.org_id=?4 AND (SELECT changes())=1"
			)
			.bind(ctx.user.id, normalizeTarget(ctx.path), id, ctx.org.id, nowMs())
	]);
	return redirect(303, `/org/${ctx.org.slug}/settings`);
}

// --------------------------------------------------------------- acceptance

/**
 * The two acceptance statements for an invitation: grant (restoring a removed
 * membership is allowed; an active membership is never touched) and mark
 * accepted only when the grant took effect. Both run atomically.
 *
 * `gate` = token hash for emailed-link acceptance: the grant AND the
 * acceptance are additionally guarded on that hash still being a `sent`
 * delivery row inside the same atomic batch. In-app acceptance passes null.
 */
export function acceptStatements(
	db: D1Database,
	userId: string,
	invitationId: string,
	email: string,
	now: number,
	gate: string | null
): D1PreparedStatement[] {
	if (gate !== null) {
		return [
			db
				.prepare(
					"INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) SELECT i.org_id,?1,i.role_id,?1,?2 FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id JOIN invitation_mail im ON im.invitation_id=i.id AND im.token_hash=?5 AND im.status='sent' WHERE i.id=?3 AND i.email=?4 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2 ON CONFLICT(org_id,user_id) DO UPDATE SET role_id=excluded.role_id,removed_at=NULL WHERE memberships.removed_at IS NOT NULL"
				)
				.bind(userId, now, invitationId, email, gate),
			db
				.prepare(
					"UPDATE invitations SET accepted_at=?1,accepted_by=?2 WHERE id=?3 AND email=?4 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=invitations.org_id AND m.user_id=?2 AND m.removed_at IS NULL) AND EXISTS(SELECT 1 FROM invitation_mail x WHERE x.invitation_id=invitations.id AND x.token_hash=?5 AND x.status='sent')"
				)
				.bind(now, userId, invitationId, email, gate)
		];
	}
	return [
		db
			.prepare(
				'INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) SELECT i.org_id,?1,i.role_id,?1,?2 FROM invitations i JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?3 AND i.email=?4 COLLATE NOCASE AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2 ON CONFLICT(org_id,user_id) DO UPDATE SET role_id=excluded.role_id,removed_at=NULL WHERE memberships.removed_at IS NOT NULL'
			)
			.bind(userId, now, invitationId, email),
		db
			.prepare(
				'UPDATE invitations SET accepted_at=?1,accepted_by=?2 WHERE id=?3 AND email=?4 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=invitations.org_id AND m.user_id=?2 AND m.removed_at IS NULL)'
			)
			.bind(now, userId, invitationId, email)
	];
}

/** True when the acceptance UPDATE (batch statement index 1) actually wrote. */
export function acceptedInBatch(results: D1Result<unknown>[]): boolean {
	return changesOf(results[1]) === 1;
}

function changesOf(result: D1Result<unknown> | undefined): number {
	return result?.meta?.changes ?? 0;
}

/** Committed audit row that only lands when THIS batch accepted the
 * invitation: `(SELECT changes())=1` gates it to the preceding write. */
function acceptAudit(
	db: D1Database,
	userId: string,
	invitationId: string,
	target: string,
	now: number
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,i.org_id,'invitation.accepted',?2,'committed',?4 FROM invitations i WHERE i.id=?3 AND (SELECT changes())=1"
		)
		.bind(userId, target, invitationId, now);
}

/** In-app acceptance from Organizations (POST /invitations/:id/accept). The
 * caller has already gated login, same-origin, and CSRF. */
export async function acceptFromOrganizations(
	event: CtxEvent,
	id: string,
	login: LoginState
): Promise<never> {
	if (login.user.google_sub === null) {
		throw error(403, 'Verified Google sign-in required.');
	}
	const now = nowMs();
	// Explicit no-op: expired, revoked, already accepted, or wrong recipient
	// is a 404, never a silent redirect.
	const open = await qOne<{ ok: number }>(
		login.db,
		'SELECT 1 AS ok FROM invitations WHERE id=?1 AND email=?2 COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?3',
		[id, login.user.email, now]
	);
	if (!open) throw error(404, 'This invitation is no longer available.');
	const statements = acceptStatements(login.db, login.user.id, id, login.user.email, now, null);
	statements.push(
		acceptAudit(login.db, login.user.id, id, normalizeTarget(event.url.pathname), now)
	);
	const results = await login.db.batch(statements);
	if (!acceptedInBatch(results)) {
		throw error(403, 'This invitation could not be accepted.');
	}
	return redirect(303, '/orgs');
}

// ------------------------------------------------------- emailed-link flow

export interface TokenTarget {
	invitationId: string;
}

/** One-time lookup binding an emailed token to a still-open invitation. */
export async function tokenTarget(
	db: D1Database,
	token: string,
	now: number
): Promise<TokenTarget | null> {
	const row = await qOne<{ invitation_id: string }>(
		db,
		"SELECT im.invitation_id AS invitation_id FROM invitation_mail im JOIN invitations i ON i.id=im.invitation_id WHERE im.token_hash=?1 AND im.status='sent' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2",
		[hashToken(token), now]
	);
	return row ? { invitationId: row.invitation_id } : null;
}

export interface InvitationDetail {
	email: string;
	orgName: string;
	roleName: string;
	expiresAt: number;
}

/** Still-open invitation details for display (org/role names joined). */
export async function pendingFor(
	db: D1Database,
	id: string,
	now: number
): Promise<InvitationDetail | null> {
	return qOne<InvitationDetail>(
		db,
		'SELECT i.email,o.name AS orgName,r.name AS roleName,i.expires_at AS expiresAt FROM invitations i JOIN organizations o ON o.id=i.org_id JOIN roles r ON r.id=i.role_id AND r.org_id=i.org_id WHERE i.id=?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?2',
		[id, now]
	);
}

/** Emailed-link acceptance (POST on the /invitations/accept page). */
export async function acceptByLink(event: CtxEvent, form: FormData): Promise<never> {
	const login = await requireLogin(event);
	assertSameOrigin(event.request, event.url);
	assertFormCsrf(form.get('csrf_token'), login.session);
	if (login.user.google_sub === null) {
		throw error(403, 'Verified Google sign-in required.');
	}
	const token = str(form, 'token');
	if (token === '') throw error(404, 'This invitation link is not valid.');
	const now = nowMs();
	const target = await tokenTarget(login.db, token, now);
	if (!target) throw error(404, 'This invitation link is no longer valid.');
	const statements = acceptStatements(
		login.db,
		login.user.id,
		target.invitationId,
		login.user.email,
		now,
		hashToken(token)
	);
	statements.push(
		acceptAudit(login.db, login.user.id, target.invitationId, normalizeTarget(event.url.pathname), now)
	);
	const results = await login.db.batch(statements);
	if (!acceptedInBatch(results)) {
		throw error(403, 'This invitation could not be accepted.');
	}
	return redirect(303, '/orgs');
}

/** Viewer facts for the acceptance page: logged-in identity, if any. */
export async function viewerOf(event: CtxEvent) {
	const login = await requireLogin(event).catch(() => null);
	if (!login) return null;
	return {
		email: login.user.email,
		verified: login.user.google_sub !== null,
		csrf: login.session.csrf
	};
}

// Shared context passed by the settings route after requireMember:
// db/user/org/memberRows plus the request path for audit normalization.
export interface TenantContextLike {
	db: D1Database;
	user: UserRowLike;
	org: { id: number; slug: string };
	memberRows: Array<{ id: number; user_id: string; email: string; removed_at: number | null }>;
	path: string;
}

interface UserRowLike {
	id: string;
	email: string;
}

function committedEvent(
	db: D1Database,
	orgId: number,
	actorId: string,
	action: string,
	target: string
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)"
		)
		.bind(actorId, orgId, action, target, nowMs());
}

/** Route-layer adapter: build the module context from a requireMember result. */
export function inviteCtxFrom(
	ctx: {
		db: import('$lib/d1').D1Database;
		user: { id: string; email: string };
		org: { id: number; slug: string };
		memberRows: ReadonlyArray<{ id: number; user_id: string; email: string; removed_at: number | null }>;
	},
	path: string
): TenantContextLike {
	return {
		db: ctx.db,
		user: { id: ctx.user.id, email: ctx.user.email },
		org: { id: ctx.org.id, slug: ctx.org.slug },
		memberRows: ctx.memberRows.map((m) => ({
			id: m.id,
			user_id: m.user_id,
			email: m.email,
			removed_at: m.removed_at
		})),
		path
	};
}
