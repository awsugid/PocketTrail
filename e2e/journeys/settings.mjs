// Settings and platform journey: per-section permissions, role/member/pocket/
// mapping mutations, invitation lifecycle, notification opt-in gated by a
// preview token, local outbox, and platform administration guards.
import { Client } from '../harness.mjs';
import { csrfFrom, signIn } from './_util.mjs';

export async function checks(ctx) {
	const { extractCsrf } = ctx;
	let failures = 0;
	const check = (name, condition, detail = '') => {
		if (condition) process.stdout.write(`  ok   ${name}\n`);
		else {
			failures += 1;
			process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
		}
	};

	const alice = new Client();
	const bob = new Client();
	const dana = new Client();
	const admin = new Client();
	await signIn(alice, extractCsrf, 'alice');
	await signIn(bob, extractCsrf, 'bob');
	await signIn(dana, extractCsrf, 'dana');
	await signIn(admin, extractCsrf, 'admin');

	const settings = await alice.get('/org/demo-jakarta/settings');
	const html = await settings.text();
	const csrf = csrfFrom(html) ?? '';
	check('settings render for a member', settings.status === 200, String(settings.status));
	const sectionPages = ['pockets', 'routing', 'people', 'roles', 'notifications'];
	for (const section of sectionPages) {
		const page = await alice.get(`/org/demo-jakarta/settings/${section}`);
		check(`settings/${section} renders its own page`, page.status === 200, String(page.status));
	}
	check(
		'the settings index links every focused section',
		sectionPages.every((section) => html.includes(`/settings/${section}`)),
		'section link missing'
	);
	const bobSettings = await bob.get('/org/demo-jakarta/settings');
	const bobCsrf = csrfFrom(await bobSettings.text()) ?? '';
	check('a read-only approver still sees settings', bobSettings.status === 200, String(bobSettings.status));
	check('a member without ledger access is denied settings', (await dana.get('/org/demo-jakarta/settings')).status === 403);

	// ------------------------------------------------------------------- roles
	const roleWithoutView = await alice.postForm('/org/demo-jakarta/settings/roles?/createRole', {
		csrf_token: csrf,
		name: 'Broken role',
		perm: 'DocumentTransactions'
	});
	check('a working role without View transactions is refused', roleWithoutView.status === 400, String(roleWithoutView.status));
	const roleCreated = await alice.postForm('/org/demo-jakarta/settings/roles?/createRole', {
		csrf_token: csrf,
		name: 'Synthetic reviewer',
		perm: 'ViewTransactions'
	});
	check('a well-formed role is created', roleCreated.status === 303, String(roleCreated.status));
	const duplicateRole = await alice.postForm('/org/demo-jakarta/settings/roles?/createRole', {
		csrf_token: csrf,
		name: 'Synthetic reviewer',
		perm: 'ViewTransactions'
	});
	check('a duplicate role name is refused', duplicateRole.status === 400, String(duplicateRole.status));
	const bobRoleWrite = await bob.postForm('/org/demo-jakarta/settings/roles?/createRole', {
		csrf_token: bobCsrf,
		name: 'Unauthorized role',
		perm: 'ViewTransactions'
	});
	check('managing roles needs the permission', bobRoleWrite.status === 403, String(bobRoleWrite.status));

	// ----------------------------------------------------------------- pockets
	const pocket = await alice.postForm('/org/demo-jakarta/settings/pockets?/addPocket', {
		csrf_token: csrf,
		name: 'DEMO savings pocket',
		opening_balance: '250000',
		owner_membership_id: '1'
	});
	check('a pocket is created', pocket.status === 303, String(pocket.status));
	const duplicatePocket = await alice.postForm('/org/demo-jakarta/settings/pockets?/addPocket', {
		csrf_token: csrf,
		name: 'DEMO savings pocket',
		opening_balance: '0',
		owner_membership_id: '1'
	});
	check('a duplicate pocket name is refused', duplicatePocket.status === 400, String(duplicatePocket.status));
	const badOwner = await alice.postForm('/org/demo-jakarta/settings/pockets?/setPocketOwner', {
		csrf_token: csrf,
		id: '1',
		owner_membership_id: '999'
	});
	check('a pocket owner must be an active member', badOwner.status === 400, String(badOwner.status));

	// ---------------------------------------------------------------- mappings
	const mapping = await alice.postForm('/org/demo-jakarta/settings/routing?/addMapping', {
		csrf_token: csrf,
		pattern: 'Synthetic Vendor',
		pocket_id: '1',
		member_id: '2'
	});
	check('a statement label can be mapped', mapping.status === 303, String(mapping.status));
	const duplicateMapping = await alice.postForm('/org/demo-jakarta/settings/routing?/addMapping', {
		csrf_token: csrf,
		pattern: 'synthetic vendor',
		pocket_id: '1',
		member_id: '1'
	});
	check('a normalized duplicate mapping is refused', duplicateMapping.status === 400, String(duplicateMapping.status));

	// ------------------------------------------------------------------ people
	const unknownMember = await alice.postForm('/org/demo-jakarta/settings/people?/addMember', {
		csrf_token: csrf,
		user_id: 'nobody@example.test',
		role_id: '4'
	});
	check('adding an unknown identity is refused', unknownMember.status === 400, String(unknownMember.status));
	const duplicateMember = await alice.postForm('/org/demo-jakarta/settings/people?/addMember', {
		csrf_token: csrf,
		user_id: 'dana@example.test',
		role_id: '4'
	});
	check('adding an existing membership is refused', duplicateMember.status === 400, String(duplicateMember.status));
	const addedMember = await alice.postForm('/org/demo-jakarta/settings/people?/addMember', {
		csrf_token: csrf,
		user_id: 'admin@example.test',
		role_id: '4'
	});
	check('a signed-in identity can be granted membership', addedMember.status === 303, String(addedMember.status));

	const revoked = await alice.postForm('/org/demo-jakarta/settings/people?/removeMember', {
		csrf_token: csrf,
		id: '4'
	});
	check('access can be revoked', revoked.status === 303, String(revoked.status));
	const danaAfter = await dana.get('/org/demo-jakarta/transactions');
	check('revoked access is effective immediately', danaAfter.status === 403, String(danaAfter.status));
	const restore = await alice.postForm('/org/demo-jakarta/settings/people?/restoreMember', {
		csrf_token: csrf,
		id: '4'
	});
	check('a membership can be restored', restore.status === 303, String(restore.status));
	const selfRemoval = await alice.postForm('/org/demo-jakarta/settings/people?/removeMember', {
		csrf_token: csrf,
		id: '1'
	});
	check('a member cannot remove their own membership', selfRemoval.status === 400, String(selfRemoval.status));

	// ----------------------------------------------------------- invitations
	const invited = await alice.postForm('/org/demo-jakarta/settings/invitations', {
		csrf_token: csrf,
		email: 'invitee@example.test',
		role_id: '4'
	});
	check('an invitation can be created', invited.status === 303, String(invited.status));
	const withInvite = await (await alice.get('/org/demo-jakarta/settings/people')).text();
	check('the pending invitation is listed', withInvite.includes('invitee@example.test'));
	check('invitation mail delivery is reported as local-only', /no email is sent/i.test(withInvite));
	const invitationId = withInvite.match(/settings\/invitations\/([0-9a-f]{32,64})\/revoke/)?.[1];
	check('the invitation exposes a revoke control', Boolean(invitationId), 'no invitation id');
	if (invitationId) {
		const revokedInvite = await alice.postForm(`/org/demo-jakarta/settings/invitations/${invitationId}/revoke`, {
			csrf_token: csrf
		});
		check('an invitation can be revoked', revokedInvite.status === 303, String(revokedInvite.status));
		const afterRevoke = await (await alice.get('/org/demo-jakarta/settings/people')).text();
		check('a revoked invitation leaves the pending list', !afterRevoke.includes('invitee@example.test'));
	}
	const linkPage = await alice.get('/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
	check('an unknown invitation token is not found', linkPage.status === 404, String(linkPage.status));

	// ---------------------------------------------------------- notifications
	const noPreview = await alice.postForm('/org/demo-jakarta/settings/notifications?/saveNotifications', {
		csrf_token: csrf,
		enabled: 'on',
		cutoff_date: '2025-01-01',
		preview_token: ''
	});
	check('enabling notifications needs a fresh preview', noPreview.status === 400, String(noPreview.status));
	const previewPage = await alice.get('/org/demo-jakarta/settings/notifications?cutoff_date=2025-01-01');
	const previewHtml = await previewPage.text();
	const previewToken = previewHtml.match(/name="preview_token"\s+value="([0-9a-f]+)"/)?.[1] ?? '';
	check('the preview lists recipients for the cutoff', /recipient/.test(previewHtml) && previewToken !== '', 'no preview token');
	const enabled = await alice.postForm('/org/demo-jakarta/settings/notifications?/saveNotifications', {
		csrf_token: csrf,
		enabled: 'on',
		cutoff_date: '2025-01-01',
		preview_token: previewToken
	});
	check('notifications can be enabled with a previewed cutoff', enabled.status === 303, String(enabled.status));
	const digest = await alice.postForm('/org/demo-jakarta/notifications/digest', { csrf_token: csrf });
	check('a digest capture is accepted', digest.status === 303, String(digest.status));
	const afterDigest = await (await alice.get('/org/demo-jakarta/settings')).text();
	check('the local outbox is shown', /Local outbox/.test(afterDigest));
	check('no delivery transport is claimed', /no email|Delivery stays/i.test(afterDigest));
	const bobNotify = await bob.postForm('/org/demo-jakarta/settings/notifications?/saveNotifications', {
		csrf_token: bobCsrf,
		enabled: 'on',
		cutoff_date: '2025-01-01',
		preview_token: ''
	});
	check('changing notification settings needs the permission', bobNotify.status === 403, String(bobNotify.status));

	// ----------------------------------------------------------------- platform
	const platform = await admin.get('/platform');
	check('a platform administrator sees the platform page', platform.status === 200, String(platform.status));
	const platformHtml = await platform.text();
	const adminCsrf = csrfFrom(platformHtml) ?? '';
	check('platform administration grants no organization finances', /grants no access|not.*financial/i.test(platformHtml));
	check('a non-administrator is denied the platform page', (await bob.get('/platform')).status === 403);
	const selfAdmin = await admin.postForm('/platform/users/admin', {
		csrf_token: adminCsrf,
		user_id: 'admin',
		admin: 'true'
	});
	check('an administrator cannot change their own access', selfAdmin.status === 400, String(selfAdmin.status));
	const grant = await admin.postForm('/platform/users/admin', {
		csrf_token: adminCsrf,
		user_id: 'bob',
		admin: 'true'
	});
	check('platform access can be granted to another account', grant.status === 303, String(grant.status));
	const bobPlatform = await bob.get('/platform');
	check('the granted account can open the platform page', bobPlatform.status === 200, String(bobPlatform.status));
	const revoke = await admin.postForm('/platform/users/admin', {
		csrf_token: adminCsrf,
		user_id: 'bob',
		admin: 'false'
	});
	check('platform access can be revoked', revoke.status === 303, String(revoke.status));
	check('a revoked administrator loses the platform page', (await bob.get('/platform')).status === 403);

	const template = await admin.postForm('/platform/role-templates', {
		csrf_token: adminCsrf,
		name: 'Synthetic template',
		perm: 'ViewTransactions'
	});
	check('a platform role template is saved', template.status === 303, String(template.status));

	return failures;
}
