// Authentication and organization guards, ported from the guard half of
// src/web/mod.rs.
//
// Every protected server load and action calls `requireLogin`/`requireMember`
// itself. SvelteKit parent loads can run concurrently or be reused during
// navigation, so an org layout load is chrome, never a security gate.

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Bindings, D1Database } from '$lib/d1';
import { nowSecs, qAll, qOne } from './db';
import {
	authorize,
	authzMessage,
	memberIsActive,
	permissionsFor,
	type MemberRef,
	type Permission,
	type RoleRef
} from './permissions';
import {
	SESSION_COOKIE,
	decodeCookie,
	hostIsLoopback,
	sessionCookieOptions,
	type CookieOptions,
	type Session
} from './session';
import { googlePicture } from './profile';

/** The parts of a request event the guards need. */
export type CtxEvent = Pick<RequestEvent, 'cookies' | 'platform' | 'request' | 'url'>;

export interface AppConfig {
	/** Non-null only when SECRET_SESSION_KEY has at least 32 characters. */
	secret: string | null;
	localDev: boolean;
	googleClientId: string | null;
}

export interface UserRow {
	id: string;
	email: string;
	name: string;
	google_sub: string | null;
	picture: string | null;
	is_platform_admin: number;
	created_at: number;
}

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

export interface MemberRow {
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

export interface RoleRow {
	id: number;
	org_id: number;
	name: string;
	permissions: string;
}

export function bindings(platform: App.Platform | undefined): Bindings {
	if (!platform) throw error(500, 'Platform bindings are unavailable.');
	return platform.env;
}

export function appConfig(platform: App.Platform | undefined): AppConfig {
	const env = bindings(platform);
	const secret = env.SECRET_SESSION_KEY;
	return {
		// A short key is treated as unset, exactly as App::from_env does.
		secret: typeof secret === 'string' && secret.length >= 32 ? secret : null,
		localDev: env.LOCAL_DEV === 'true',
		googleClientId: typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID !== ''
			? env.GOOGLE_CLIENT_ID
			: null
	};
}

export function isHttps(url: URL): boolean {
	return url.protocol === 'https:';
}

export function sessionCookie(secure: boolean): CookieOptions {
	return sessionCookieOptions(secure);
}

/** Verified session from the request cookie, or `null` when absent, tampered
 * with, expired, or when no signing key is configured. */
export async function sessionOf(event: CtxEvent, config: AppConfig): Promise<Session | null> {
	const secret = config.secret;
	if (!secret) return null;
	const raw = event.cookies.get(SESSION_COOKIE);
	if (!raw) return null;
	return decodeCookie(secret, raw, nowSecs());
}

/** Fixture sign-in is available only on a loopback host with LOCAL_DEV set and
 * a configured signing key — the same three gates as src/web/auth_routes.rs. */
export function devLoginAllowed(config: AppConfig, url: URL): boolean {
	return config.localDev && config.secret !== null && hostIsLoopback(url.host);
}

export interface LoginState {
	config: AppConfig;
	session: Session;
	user: UserRow;
	db: D1Database;
}

const USER_SQL =
	'SELECT id, email, name, google_sub, picture, is_platform_admin, created_at FROM users WHERE id = ?1';

/** Requires a logged-in user; fails closed with 503 when no signing key is
 * configured, and redirects to /login for any missing or stale session. */
export async function requireLogin(event: CtxEvent): Promise<LoginState> {
	const config = appConfig(event.platform);
	if (!config.secret) {
		throw error(503, 'SECRET_SESSION_KEY is not configured; authentication fails closed.');
	}
	const session = await sessionOf(event, config);
	if (!session) throw redirect(303, '/login');
	const db = bindings(event.platform).DB;
	const user = await qOne<UserRow>(db, USER_SQL, [session.uid]);
	if (!user) throw redirect(303, '/login');
	return { config, session, user, db };
}

export interface TenantContext {
	config: AppConfig;
	session: Session;
	user: UserRow;
	db: D1Database;
	org: OrgRow;
	memberRows: MemberRow[];
	roleRows: RoleRow[];
	permissions: Set<Permission>;
	can(permission: Permission): boolean;
}

async function orgBySlug(db: D1Database, slug: string): Promise<OrgRow | null> {
	return qOne<OrgRow>(db, 'SELECT * FROM organizations WHERE slug = ?1', [slug]);
}

async function membersOfOrg(db: D1Database, orgId: number): Promise<MemberRow[]> {
	return qAll<MemberRow>(
		db,
		`SELECT m.id, m.org_id, m.user_id, m.role_id, m.handle, m.created_at, m.removed_at,
		        u.name, u.email
		 FROM memberships m JOIN users u ON u.id = m.user_id
		 WHERE m.org_id = ?1 ORDER BY m.id`,
		[orgId]
	);
}

async function rolesOfOrg(db: D1Database, orgId: number): Promise<RoleRow[]> {
	return qAll<RoleRow>(db, 'SELECT id, org_id, name, permissions FROM roles WHERE org_id = ?1 ORDER BY id', [
		orgId
	]);
}

export async function orgsOfUser(
	db: D1Database,
	userId: string
): Promise<Array<{ slug: string; name: string }>> {
	return qAll<{ slug: string; name: string }>(
		db,
		`SELECT o.slug, o.name FROM organizations o
		 JOIN memberships m ON m.org_id = o.id
		 WHERE m.user_id = ?1 AND m.removed_at IS NULL ORDER BY o.name`,
		[userId]
	);
}

/** Common props every organization page passes to OrgShell: identity, active
 * organization context, membership list, and the session-bound CSRF token. */
export async function shellContext(ctx: TenantContext) {
	const organizations = await orgsOfUser(ctx.db, ctx.user.id);
	return {
		user: {
			name: ctx.user.name,
			email: ctx.user.email,
			picture: ctx.user.picture ? googlePicture(ctx.user.picture) : null,
			isPlatformAdmin: ctx.user.is_platform_admin !== 0
		},
		org: {
			slug: ctx.org.slug,
			name: ctx.org.name,
			notificationsEnabled: ctx.org.notifications_enabled !== 0
		},
		organizations,
		members: ctx.memberRows.map((m) => ({
			id: m.id,
			name: m.name,
			email: m.email,
			handle: m.handle,
			active: m.removed_at === null
		})),
		csrfToken: ctx.session.csrf,
		localMode: ctx.config.localDev
	};
}

/** Requires an active membership of `slug` that grants `permission`. The
 * permission check runs on freshly read membership rows for this request. */
export async function requireMember(
	event: CtxEvent,
	slug: string,
	permission: Permission
): Promise<TenantContext> {
	const login = await requireLogin(event);
	const org = await orgBySlug(login.db, slug);
	if (!org) throw error(404, 'Unknown organization.');
	const memberRows = await membersOfOrg(login.db, org.id);
	const roleRows = await rolesOfOrg(login.db, org.id);
	const members: MemberRef[] = memberRows.map((row) => ({
		userId: row.user_id,
		roleId: row.role_id,
		active: row.removed_at === null
	}));
	const roles: RoleRef[] = roleRows.map((row) => ({ id: row.id, permissions: row.permissions }));
	if (!memberIsActive(members, login.user.id)) {
		throw error(403, 'Active organization membership required.');
	}
	const failure = authorize(members, roles, login.user.id, permission);
	if (failure) throw error(403, `Access denied: ${authzMessage(failure)}.`);
	const permissions = permissionsFor(members, roles, login.user.id);
	return {
		config: login.config,
		session: login.session,
		user: login.user,
		db: login.db,
		org,
		memberRows,
		roleRows,
		permissions,
		can: (candidate: Permission) => permissions.has(candidate)
	};
}

/** Rejects browser cross-origin mutations. Applied on every POST in addition to
 * the framework's own origin check, so a configuration change cannot silently
 * remove the only guard. */
export function assertSameOrigin(request: Request, url: URL): void {
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) {
		throw error(403, 'Cross-origin requests are not allowed.');
	}
	if (request.headers.get('sec-fetch-site') === 'cross-site') {
		throw error(403, 'Cross-site requests are not allowed.');
	}
}

/** Compares a submitted CSRF token with the one bound to the current session. */
export function assertFormCsrf(value: FormDataEntryValue | null, session: Session): void {
	const sent = typeof value === 'string' ? value : '';
	if (sent === '' || sent !== session.csrf) {
		throw error(403, 'CSRF token missing or invalid.');
	}
}
