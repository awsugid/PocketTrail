// Organization listing and creation, ported from src/web/orgs.rs. Creating an
// organization is a platform-admin capability; the creator becomes its first
// Admin member and pocket owner in one atomic batch.

import { error, redirect } from '@sveltejs/kit';
import { ALL_PERMISSIONS } from '$lib/domain';
import {
	assertFormCsrf,
	assertSameOrigin,
	orgsOfUser,
	requireLogin,
	type CtxEvent,
	type LoginState
} from './auth';
import { nowMs, qOne } from './db';
import { pendingInvitations, type PendingInvitation } from './invitations';

/** Lowercase letters/digits/hyphens, 2-48 chars, no leading/trailing hyphen. */
export function validSlug(s: string): boolean {
	if (s.length < 2 || s.length > 48) return false;
	if (!/^[a-z0-9-]+$/.test(s)) return false;
	return !s.startsWith('-') && !s.endsWith('-');
}

export async function orgsPageData(login: LoginState, url: URL) {
	const organizations = await orgsOfUser(login.db, login.user.id);
	const invitations = await pendingInvitations(login.db, login.user.email);
	return {
		user: {
			name: login.user.name,
			email: login.user.email,
			isPlatformAdmin: login.user.is_platform_admin !== 0
		},
		organizations,
		invitations,
		canCreate: login.user.is_platform_admin !== 0,
		csrfToken: login.session.csrf,
		msg: url.searchParams.get('msg') ?? ''
	};
}

function str(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

export async function createOrg(event: CtxEvent, login: LoginState, form: FormData): Promise<never> {
	if (login.user.is_platform_admin === 0) {
		throw error(403, 'Only platform administrators can create organizations.');
	}
	assertSameOrigin(event.request, event.url);
	assertFormCsrf(form.get('csrf_token'), login.session);
	const name = str(form, 'name').trim();
	const slug = str(form, 'slug').trim();
	if (name === '' || name.length > 120) {
		throw error(400, 'Organization name required (max 120 chars).');
	}
	if (!validSlug(slug)) {
		throw error(400, 'Slug must be lowercase letters/digits/hyphens (2-48 chars).');
	}
	const exists = await qOne(login.db, 'SELECT id FROM organizations WHERE slug = ?1', [slug]);
	if (exists) throw error(400, 'Slug already in use.');
	const now = nowMs();
	// Admin role with all permissions; creator becomes its first member.
	const all: string[] = [...ALL_PERMISSIONS];
	// Org, Admin role, first membership, Main Pocket, and the audit row commit
	// in one batch; the org id is resolved by its unique slug in SQL.
	const orgId = '(SELECT id FROM organizations WHERE slug = ?1)';
	await login.db.batch([
		login.db
			.prepare(
				'INSERT INTO organizations (slug, name, is_synthetic, notifications_enabled, created_at) VALUES (?1, ?2, 0, 0, ?3)'
			)
			.bind(slug, name, now),
		login.db
			.prepare(`INSERT INTO roles (org_id, name, permissions) VALUES (${orgId}, 'Admin', ?2)`)
			.bind(slug, JSON.stringify(all)),
		login.db
			.prepare(
				`INSERT INTO memberships (org_id, user_id, role_id, handle, created_at) SELECT ${orgId}, ?2, id, ?2, ?3 FROM roles WHERE org_id = ${orgId} AND name = 'Admin'`
			)
			.bind(slug, login.user.id, now),
		login.db
			.prepare(
				`INSERT INTO pockets (org_id, name, opening_balance_minor, owner_membership_id) SELECT ${orgId}, 'Main Pocket', 0, id FROM memberships WHERE org_id=${orgId} AND user_id=?2`
			)
			.bind(slug, login.user.id),
		login.db
			.prepare(
				`UPDATE organizations SET creator_membership_id=(SELECT id FROM memberships WHERE org_id=${orgId} AND user_id=?2) WHERE id=${orgId}`
			)
			.bind(slug, login.user.id),
		login.db
			.prepare(
				`INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?2, ${orgId}, 'org.created', ?3, 'committed', ?4 WHERE EXISTS(SELECT 1 FROM organizations WHERE slug = ?1)`
			)
			.bind(slug, login.user.id, `organization:${slug}`, now)
	]);
	return redirect(303, `/org/${slug}/transactions`);
}

/** Convenience wrapper used by the /orgs route action. */
export async function createOrgAction(event: CtxEvent): Promise<never> {
	const login = await requireLogin(event);
	const form = await event.request.formData();
	return createOrg(event, login, form);
}

export type { PendingInvitation };
