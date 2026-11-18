// Invitation acceptance, at the statement level the routes run: inviting
// creates the invited membership, a verified Google sign-in claims the
// placeholder, and both acceptance paths close the invitation and clear the
// invited flag. Mirrors the claim upsert in src/routes/login/+page.server.ts
// (Google itself cannot run in unit tests).
import { describe, expect, it } from 'vitest';
import type { D1Database } from '$lib/d1';
import { testDatabase } from './helpers/sqlite';
import { hashToken, encodeToken } from '$lib/server/tokens';
import {
	acceptStatements,
	acceptedInBatch,
	pendingInvitations
} from '$lib/server/invitations';
import { inviteMembershipStatements } from '$lib/server/invited';

const NOW = 1_000_000;

async function seed(db: D1Database) {
	await db.batch([
		db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?1,?2,?3,?4)').bind('g:admin', 'admin@x.com', 'Admin', NOW),
		db.prepare(
			'INSERT INTO organizations(id,slug,name,is_synthetic,notifications_enabled,notification_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)'
		).bind(1, 'org', 'Org', 0, 1, 0, NOW),
		db.prepare('INSERT INTO roles(id,org_id,name,permissions) VALUES(?1,?2,?3,?4)').bind(1, 1, 'Approver', '[]'),
		db.prepare('INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) VALUES(?1,?2,?3,?4,?5)').bind(1, 'g:admin', 1, 'g:admin', NOW)
	]);
}

async function invite(db: D1Database, email: string, token: string, mailStatus = 'sent') {
	await db.batch([
		db.prepare(
			'INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)'
		).bind('inv1', 1, email, 1, 'g:admin', NOW, NOW + 7 * 86_400_000),
		db.prepare(
			"INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) VALUES(?1,?2,'" + mailStatus + "',?3)"
		).bind('inv1', hashToken(token), NOW),
		...inviteMembershipStatements(db, 1, email, 1, NOW)
	]);
}

/** The user upsert the google login action performs: claim the placeholder
 * carrying the verified email, exactly as src/routes/login/+page.server.ts. */
async function googleSignIn(db: D1Database, email: string, sub: string): Promise<string> {
	const owner = await db
		.prepare('SELECT id, google_sub FROM users WHERE LOWER(email)=LOWER(?1)')
		.bind(email)
		.first<{ id: string; google_sub: string | null }>();
	const claimable = owner !== null && owner.google_sub === null && owner.id.startsWith('invite:');
	const uid = claimable ? owner.id : `g:${sub}`;
	if (owner && owner.id !== uid) throw new Error('409');
	await db.batch([
		db.prepare(
			`INSERT INTO users (id, email, name, google_sub, is_platform_admin, created_at, picture)
			 VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL)
			 ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture,
			 google_sub = COALESCE(users.google_sub, excluded.google_sub)`
		).bind(uid, email, email, sub, NOW)
	]);
	return uid;
}

async function invitationRow(db: D1Database) {
	return db.prepare('SELECT id,accepted_at,accepted_by FROM invitations').first<{ id: string; accepted_at: number | null; accepted_by: string | null }>();
}

async function invitedFlag(db: D1Database, email: string) {
	return db
		.prepare('SELECT m.invited FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?1 AND m.org_id=1')
		.bind(email)
		.first<{ invited: number }>();
}

describe('pendingInvitations', () => {
	it('returns rows shaped for the Organizations hub', async () => {
		const { db } = testDatabase();
		await seed(db);
		await invite(db, 'b@x.com', encodeToken());
		const rows = await pendingInvitations(db, 'b@x.com');
		expect(rows).toEqual([
			{ id: 'inv1', email: 'b@x.com', orgName: 'Org', roleName: 'Approver', expiresAt: NOW + 7 * 86_400_000 }
		]);
	});
});

describe('acceptance after a normal Google sign-in', () => {
	it('in-app acceptance closes the invitation and clears the invited flag', async () => {
		const { db } = testDatabase();
		await seed(db);
		await invite(db, 'b@x.com', encodeToken());
		const uid = await googleSignIn(db, 'b@x.com', 'sub1');
		// Never having accepted, the membership stays invited and invitation open.
		expect((await invitedFlag(db, 'b@x.com'))?.invited).toBe(1);
		expect((await invitationRow(db))?.accepted_at).toBeNull();
		const results = await db.batch(acceptStatements(db, uid, 'inv1', 'b@x.com', NOW + 1000, null));
		expect(acceptedInBatch(results)).toBe(true);
		expect((await invitationRow(db))?.accepted_at).toBe(NOW + 1000);
		expect((await invitedFlag(db, 'b@x.com'))?.invited).toBe(0);
		expect(await pendingInvitations(db, 'b@x.com')).toEqual([]);
	});

	it('emailed-link acceptance gates on the sent token hash', async () => {
		const { db } = testDatabase();
		await seed(db);
		const token = encodeToken();
		await invite(db, 'b@x.com', token);
		const uid = await googleSignIn(db, 'b@x.com', 'sub1');
		const wrong = await db.batch(acceptStatements(db, uid, 'inv1', 'b@x.com', NOW + 1000, hashToken(encodeToken())));
		expect(acceptedInBatch(wrong)).toBe(false);
		const right = await db.batch(acceptStatements(db, uid, 'inv1', 'b@x.com', NOW + 1000, hashToken(token)));
		expect(acceptedInBatch(right)).toBe(true);
		expect((await invitedFlag(db, 'b@x.com'))?.invited).toBe(0);
	});

	it('a sign-in alone never accepts: the invited flag survives untouched', async () => {
		const { db } = testDatabase();
		await seed(db);
		await invite(db, 'b@x.com', encodeToken());
		await googleSignIn(db, 'b@x.com', 'sub1');
		expect((await invitedFlag(db, 'b@x.com'))?.invited).toBe(1);
		expect((await invitationRow(db))?.accepted_at).toBeNull();
		// The signed-in invitee still sees the invitation offered for acceptance.
		expect((await pendingInvitations(db, 'b@x.com')).length).toBe(1);
	});
});
