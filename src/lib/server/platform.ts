// Platform administration: users, platform audit trail, organizations list,
// and role templates. Ported from src/web/platform.rs. Platform administration
// does not confer organization membership; every mutation writes its audit
// event in the same D1 batch as the change.

import { error, redirect } from '@sveltejs/kit';
import type { CtxEvent, LoginState } from './auth';
import { assertFormCsrf, assertSameOrigin, requireLogin } from './auth';
import { committed, listPlatform } from './audit';
import { actionLabel, outcomeLabel, pageNumber, targetLabel } from './audit_rules';
import { nowMs, qAll, qOne } from './db';
import { parseRolePermissions, PERMISSION_LABELS } from './permissions';
import { permissionBundle } from './settings';

export async function requirePlatformAdmin(event: CtxEvent): Promise<LoginState> {
	const login = await requireLogin(event);
	if (login.user.is_platform_admin === 0) {
		throw error(403, 'Platform administrator required.');
	}
	return login;
}

export interface TemplateRow {
	id: number;
	name: string;
	permissions: string;
}

const PAGE_SIZE = 50;

function pages(total: number): number {
	return Math.ceil(Math.max(total, 1) / PAGE_SIZE);
}

/** 1-based window shown for a page of `count` rows; empty pages clamp to 1–0. */
function windowOf(page: number, count: number): [number, number] {
	const from = (page - 1) * PAGE_SIZE + 1;
	return [from, from + count - 1];
}

export async function platformPageData(login: LoginState, url: URL) {
	const db = login.db;
	const usersTotal =
		(await qOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users'))?.n ?? 0;
	const eventsTotal =
		(await qOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM audit_events WHERE org_id IS NULL'))
			?.n ?? 0;
	const usersPage = Math.min(pageNumber(url.searchParams.get('users')), pages(usersTotal));
	const eventsPage = Math.min(pageNumber(url.searchParams.get('events')), pages(eventsTotal));
	const users = await qAll<{
		id: string;
		name: string;
		email: string;
		is_platform_admin: number;
	}>(db, 'SELECT * FROM users ORDER BY name LIMIT ?1 OFFSET ?2', [
		PAGE_SIZE,
		(usersPage - 1) * PAGE_SIZE
	]);
	const [usersFrom, usersTo] = windowOf(usersPage, users.length);
	const events = await listPlatform(db, eventsPage);
	const [eventsFrom, eventsTo] = windowOf(eventsPage, events.length);
	// Cross-links keep the other section's page while paginating one.
	const usersAt = (n: number) => `/platform?events=${eventsPage}&users=${n}`;
	const eventsAt = (n: number) => `/platform?users=${usersPage}&events=${n}`;
	const organizations = await qAll<{
		slug: string;
		name: string;
		created_at: number;
		members: number;
	}>(
		db,
		'SELECT o.slug, o.name, o.created_at, (SELECT COUNT(*) FROM memberships m WHERE m.org_id=o.id AND m.removed_at IS NULL) AS members FROM organizations o ORDER BY o.name LIMIT 200'
	);
	const templates = await qAll<TemplateRow>(
		db,
		'SELECT id, name, permissions FROM role_templates ORDER BY name',
		[]
	);

	return {
		csrfToken: login.session.csrf,
		user: {
			name: login.user.name,
			email: login.user.email,
			picture: login.user.picture,
			isPlatformAdmin: true
		},
		organizations,
		users: users.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			admin: u.is_platform_admin !== 0,
			isSelf: u.id === login.user.id
		})),
		usersPage,
		usersPages: pages(usersTotal),
		usersFrom,
		usersTo,
		usersTotal,
		usersPrev: usersPage > 1 ? usersAt(usersPage - 1) : null,
		usersNext: usersPage < pages(usersTotal) ? usersAt(usersPage + 1) : null,
		roleTemplates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			labels: [...parseRolePermissions(t.permissions)].map((p) => PERMISSION_LABELS[p])
		})),
		events: events.map((e) => ({
			id: e.id,
			actorName: e.actor_name,
			actionLabel: actionLabel(e.action),
			targetLabel: targetLabel(e.target),
			outcomeLabel: outcomeLabel(e.outcome),
			outcome: e.outcome,
			createdAt: e.created_at
		})),
		eventsPage,
		eventsPages: pages(eventsTotal),
		eventsFrom,
		eventsTo,
		eventsTotal,
		eventsPrev: eventsPage > 1 ? eventsAt(eventsPage - 1) : null,
		eventsNext: eventsPage < pages(eventsTotal) ? eventsAt(eventsPage + 1) : null
	};
}

async function adminForm(event: CtxEvent, login: LoginState): Promise<FormData> {
	assertSameOrigin(event.request, event.url);
	const form = await event.request.formData();
	assertFormCsrf(form.get('csrf_token'), login.session);
	return form;
}

function str(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

// -------------------------------------------------------------- set admin

export async function setAdmin(event: CtxEvent, login: LoginState, form: FormData): Promise<never> {
	const id = str(form, 'user_id');
	const admin = str(form, 'admin');
	let enabled: boolean;
	if (admin === 'true') enabled = true;
	else if (admin === 'false') enabled = false;
	else throw error(400, 'Choose grant or revoke explicitly.');
	if (id === login.user.id) {
		throw error(400, 'Use another administrator to change your own platform access.');
	}
	const exists = await qOne<{ n: number }>(login.db, 'SELECT 1 AS n FROM users WHERE id=?1', [id]);
	if (!exists) throw error(404, 'User not found.');
	// Authorization is re-checked inside the batch: every statement carries an
	// actor-is-admin predicate, so a grant paused before a concurrent demotion
	// of its actor writes nothing (and audits nothing). The trailing probe —
	// read from the same batch results, never a later query — decides the
	// outcome. The count guard prevents removing the final administrator.
	const actorGuard =
		'EXISTS(SELECT 1 FROM users actor WHERE actor.id=?2 AND actor.is_platform_admin=1)';
	const countGuard =
		enabled
			? '1=1'
			: '(SELECT COUNT(*) FROM users WHERE is_platform_admin=1) - EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) >= 1';
	const results = await login.db.batch([
		login.db
			.prepare(
				`INSERT INTO audit_events(actor_id,action,target,outcome,created_at) SELECT ?2,'platform.admin',id,?3,?4 FROM users WHERE id=?1 AND is_platform_admin!=?5 AND ${actorGuard} AND (${countGuard})`
			)
			.bind(
				id,
				login.user.id,
				enabled ? 'granted' : 'revoked',
				nowMs(),
				enabled ? 1 : 0
			),
		login.db
			.prepare(
				`UPDATE users SET is_platform_admin=?3 WHERE id=?1 AND is_platform_admin!=?3 AND ${actorGuard} AND (${countGuard})`
			)
			.bind(id, login.user.id, enabled ? 1 : 0),
		login.db
			.prepare(
				'SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) AS actor_admin, EXISTS(SELECT 1 FROM users WHERE id=?2 AND is_platform_admin=?3) AS target_is_requested'
			)
			.bind(login.user.id, id, enabled ? 1 : 0)
	]);
	const probe = results[results.length - 1]?.results[0] as
		| { actor_admin: number; target_is_requested: number }
		| undefined;
	if (!probe) {
		throw error(409, 'Platform access did not change: at least one other platform administrator must keep access.');
	}
	if (probe.actor_admin === 0) {
		throw error(403, 'Your platform access was revoked while you were working. Reload and try again.');
	}
	if (probe.target_is_requested === 1) return redirect(303, '/platform');
	throw error(
		409,
		'Platform access did not change: at least one other platform administrator must keep access.'
	);
}

// ---------------------------------------------------------- save template

export async function saveTemplate(
	event: CtxEvent,
	login: LoginState,
	form: FormData
): Promise<never> {
	const name = str(form, 'name').trim();
	if (name === '' || name.length > 100) {
		throw error(400, 'Template name must be 1–100 characters.');
	}
	const permissions = permissionBundle(form);
	// Both upsert branches carry the actor-is-admin predicate, so a save
	// paused before a concurrent demotion of its actor writes nothing. The
	// audit row is gated on the upsert actually changing rows, and the
	// trailing probe decides the outcome from the batch results themselves.
	const actorGuard =
		'EXISTS(SELECT 1 FROM users actor WHERE actor.id=?3 AND actor.is_platform_admin=1)';
	const results = await login.db.batch([
		login.db
			.prepare(
				`INSERT INTO role_templates(name,permissions) SELECT ?1,?2 WHERE ${actorGuard} ON CONFLICT(name) DO UPDATE SET permissions=excluded.permissions WHERE ${actorGuard}`
			)
			.bind(name, permissions, login.user.id),
		login.db
			.prepare(
				"INSERT INTO audit_events(actor_id,action,target,outcome,created_at) SELECT ?1,'platform.template',?2,'committed',?3 WHERE (SELECT changes())>0"
			)
			.bind(login.user.id, name, nowMs()),
		login.db
			.prepare('SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND is_platform_admin=1) AS actor_admin')
			.bind(login.user.id)
	]);
	const probe = results[results.length - 1]?.results[0] as { actor_admin: number } | undefined;
	if (probe && probe.actor_admin === 0) {
		throw error(403, 'Your platform access was revoked while you were working. Reload and try again.');
	}
	return redirect(303, '/platform');
}

/** Copy a platform template into one organization as a separate role. The
 * copy snapshots name and permissions; later template edits never change it. */
export async function applyTemplate(
	ctx: {
		db: LoginState['db'];
		user: LoginState['user'];
		org: { id: number; slug: string };
	},
	form: FormData
): Promise<never> {
	const id = Number(str(form, 'template_id'));
	const templateId = Number.isSafeInteger(id) ? id : 0;
	const template = await qOne<TemplateRow>(
		ctx.db,
		'SELECT id, name, permissions FROM role_templates WHERE id=?1',
		[templateId]
	);
	if (!template) throw error(404, 'Role template not found.');
	const roles = await qAll<{ name: string }>(ctx.db, 'SELECT name FROM roles WHERE org_id=?1', [
		ctx.org.id
	]);
	if (roles.some((r) => r.name.toLowerCase() === template.name.toLowerCase())) {
		throw error(
			400,
			'An organization role already uses that name. Rename it or create the role manually.'
		);
	}
	await ctx.db.batch([
		ctx.db
			.prepare(
				'INSERT INTO roles(org_id,name,permissions) SELECT ?1,name,permissions FROM role_templates WHERE id=?2'
			)
			.bind(ctx.org.id, templateId),
		committed(ctx.db, ctx.org.id, ctx.user.id, 'org.roles', template.name)
	]);
	return redirect(303, `/org/${ctx.org.slug}/settings`);
}
