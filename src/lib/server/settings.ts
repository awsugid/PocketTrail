// Organization-scoped configuration: settings page data, role/member/mapping/
// pocket/notification mutations, and the local notification outbox reads.
// Ported from src/web/settings.rs and the read side of src/web/notify.rs.
// Every mutation checks its own permission; every audit row commits in the
// same D1 batch as the change it describes.

import { error, redirect } from '@sveltejs/kit';
import type { D1Database } from '$lib/d1';
import { ALL_PERMISSIONS, documentationOwed, incomeComplete, incomeRecipients } from '$lib/domain';
import { parseRupiah, validDate, fmtTs } from '$lib/fmt';
import { digestBody, digestDue } from '$lib/notify_rules';
import { committed, committedIfChanged, listOrg } from './audit';
import {
	actionLabel,
	outcomeLabel,
	PAGE_SIZE,
	pageNumber,
	targetLabel
} from './audit_rules';
import type { TenantContext, UserRow } from './auth';
import { nowMs, qAll, qOne, exec } from './db';
import { parseRolePermissions, permissionsFor, PERMISSIONS, PERMISSION_LABELS } from './permissions';
import {
	activeMem,
	mappingsOf,
	memActive,
	orgBySlug,
	pocketsOf,
	rolesOfOrg,
	type MemRow,
	type OrgRow,
	type RoleRow
} from './rows';
import { csrfForSecret } from './session';
import { randomHex } from './tokens';

export interface SettingsCtx {
	db: D1Database;
	user: UserRow;
	/** Full organization row (notification_revision, creator/income columns). */
	org: OrgRow;
	/** Every membership row of the org, active or not (Rust `g.mems`). */
	memberRows: MemRow[];
	secret: string | null;
	/** Settings sub-route to return to after a mutation ("pockets", "people",…). */
	section?: string;
}

function str(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function optStr(form: FormData, name: string): string | null {
	const value = str(form, name);
	return value === '' ? null : value;
}

/** First parseable integer, or null when blank/malformed. */
function optInt(form: FormData, name: string): number | null {
	const raw = str(form, name);
	if (raw === '') return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function intOr(form: FormData, name: string, fallback: number): number {
	return optInt(form, name) ?? fallback;
}

/** Redirect back to the settings page with a flash message. */
export function backPath(slug: string, message = '', section = ''): string {
	const query = message === '' ? '' : `?msg=${encodeURIComponent(message)}`;
	const suffix = section === '' ? '' : `/${section}`;
	return `/org/${slug}/settings${suffix}${query}`;
}

// ------------------------------------------------------------ page data

export interface RoleTemplateRow {
	id: number;
	name: string;
	permissions: string;
}

export interface InvitationRow {
	id: string;
	email: string;
	expires_at: number;
	mail_status: string | null;
	mail_error: string | null;
	mail_attempts: number | null;
}

export async function settingsPageData(ctx: TenantContext, url: URL) {
	const db = ctx.db;
	const org = await orgBySlug(db, ctx.org.slug);
	if (!org) throw error(404, 'Unknown organization.');
	const mappings = await mappingsOf(db, org.id);
	const pockets = await pocketsOf(db, org.id);

	const permissionOrder = new Map<string, number>(ALL_PERMISSIONS.map((p, i) => [p, i]));
	const roles = ctx.roleRows.map((r) => ({
		id: r.id,
		name: r.name,
		permissions: [...parseRolePermissions(r.permissions)].sort(
			(a, b) => (permissionOrder.get(a) ?? 0) - (permissionOrder.get(b) ?? 0)
		)
	}));

	const labels = await qAll<{ pocket_id: number; label: string }>(
		db,
		"SELECT DISTINCT b.pocket_id,i.counterparty AS label FROM import_items i JOIN import_batches b ON b.id=i.batch_id WHERE b.org_id=?1 AND trim(i.counterparty)<>'' ORDER BY i.counterparty",
		[org.id]
	);

	const can = {
		roles: ctx.can('ManageRoles'),
		members: ctx.can('ManageMembers'),
		mappings: ctx.can('ImportStatements'),
		notifications: ctx.can('ManageNotifications')
	};

	const roleTemplates = can.roles
		? await qAll<RoleTemplateRow>(db, 'SELECT * FROM role_templates ORDER BY name')
		: [];

	const invitations = can.members
		? await qAll<InvitationRow>(
				db,
				'SELECT i.id,i.email,i.expires_at,im.status AS mail_status,im.error AS mail_error,im.attempts AS mail_attempts FROM invitations i LEFT JOIN invitation_mail im ON im.invitation_id=i.id AND im.id=(SELECT MAX(x.id) FROM invitation_mail x WHERE x.invitation_id=i.id) WHERE i.org_id=?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC',
				[org.id]
		  )
		: [];

	let auditPage = 0;
	let auditHasMore = false;
	let auditEvents: Array<{
		id: number;
		actorName: string | null;
		action: string;
		actionLabel: string;
		target: string;
		targetLabel: string;
		outcome: string;
		outcomeLabel: string;
		createdAtLabel: string;
	}> = [];
	if (can.members) {
		auditPage = pageNumber(url.searchParams.get('page'));
		const events = await listOrg(db, org.id, auditPage);
		auditHasMore = events.length > PAGE_SIZE;
		auditEvents = events.slice(0, PAGE_SIZE).map((e) => ({
			id: e.id,
			actorName: e.actor_name,
			action: e.action,
			actionLabel: actionLabel(e.action),
			target: e.target,
			targetLabel: targetLabel(e.target),
			outcome: e.outcome,
			outcomeLabel: outcomeLabel(e.outcome),
			createdAtLabel: fmtTs(e.created_at)
		}));
	}

	// Notification preview: the cutoff may be previewed without being saved.
	const cutoffParam = url.searchParams.get('cutoff_date');
	const previewCutoff =
		cutoffParam !== null && validDate(cutoffParam) ? cutoffParam : org.notification_cutoff_date;
	let notificationPreview: {
		recipients: Array<{ name: string; pending: number }>;
		totalItems: number;
		limited: boolean;
	} | null = null;
	let previewToken = '';
	let outbox: Array<{ kind: string; toName: string; subject: string; createdAtLabel: string }> = [];
	if (can.notifications) {
		const previewOrg: OrgRow = { ...org, notification_cutoff_date: previewCutoff };
		const targets = await digestTargets(db, previewOrg, ctx.memberRows, ctx.roleRows);
		notificationPreview = previewJson(targets);
		previewToken = await csrfForSecret(ctx.config.secret ?? '', `notifications:${org.id}:${previewCutoff ?? ''}`);
		outbox = (await outboxView(db, org)).map((n) => ({
			kind: n.kind,
			toName: n.to_name,
			subject: n.subject,
			createdAtLabel: fmtTs(n.created_at)
		}));
	}

	return {
		msg: url.searchParams.get('msg') ?? '',
		roles,
		members: ctx.memberRows.map((m) => ({
			id: m.id,
			name: m.name,
			email: m.email,
			handle: m.handle,
			roleId: m.role_id,
			active: memActive(m)
		})),
		permissions: PERMISSIONS.map((id) => ({ id, label: PERMISSION_LABELS[id] })),
		mappings: mappings.map((m) => ({
			id: m.id,
			pocketId: m.pocket_id,
			pattern: m.pattern,
			memberId: m.membership_id,
			memberName: m.member_name
		})),
		incomeExplanationRoleId: org.income_explanation_role_id,
		pockets: pockets.map((p) => {
			const owner = activeMem(ctx.memberRows, p.owner_membership_id);
			return {
				id: p.id,
				name: p.name,
				openingBalanceMinor: p.opening_balance_minor,
				ownerMembershipId: p.owner_membership_id,
				ownerName: owner ? owner.name : null,
				importedLabels: labels.filter((l) => l.pocket_id === p.id).map((l) => l.label)
			};
		}),
		notifications: {
			enabled: org.notifications_enabled !== 0,
			cutoffDate: org.notification_cutoff_date
		},
		can,
		roleTemplates: roleTemplates.map((t) => ({ id: t.id, name: t.name })),
		invitations,
		auditEvents,
		auditPage,
		auditHasMore,
		notificationPreview,
		notificationPreviewCutoff: previewCutoff ?? '',
		previewToken,
		outbox
	};
}

// ------------------------------------------------------- permission bundles

/** Validate and serialize a form's `perm` checkbox set. Unknown permissions are
 * rejected; a nonempty working role must include ViewTransactions; the stored
 * JSON array is sorted (Rust BTreeSet order). */
export function permissionBundle(form: FormData): string {
	const allowed = new Set<string>(PERMISSIONS);
	const requested = new Set<string>();
	for (const value of form.getAll('perm')) {
		if (typeof value === 'string') requested.add(value);
	}
	if (![...requested].every((p) => allowed.has(p))) {
		throw error(400, 'Unknown application permission.');
	}
	if (requested.size > 0 && !requested.has('ViewTransactions')) {
		throw error(
			400,
			'Working roles require View transactions to open organization pages. Select that permission explicitly.'
		);
	}
	return JSON.stringify([...requested].sort());
}

// ---------------------------------------------------------------- roles

export async function saveRole(ctx: SettingsCtx, form: FormData, id: number | null): Promise<never> {
	const name = str(form, 'name').trim();
	if (name === '' || name.length > 100) throw error(400, 'Role name must be 1–100 characters.');
	const permissions = permissionBundle(form);
	const roles = await rolesOfOrg(ctx.db, ctx.org.id);
	if (id !== null && !roles.some((r) => r.id === id)) {
		throw error(404, 'Role not found in this organization.');
	}
	if (roles.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
		throw error(400, 'An organization role already uses that name.');
	}
	if (id !== null) {
		// Change-gated audit: a role deleted by a concurrent request matches zero
		// rows and must not record a committed event.
		await ctx.db.batch([
			ctx.db
				.prepare('UPDATE roles SET name=?1,permissions=?2 WHERE id=?3 AND org_id=?4')
				.bind(name, permissions, id, ctx.org.id),
			committedIfChanged(ctx.db, ctx.org.id, ctx.user.id, 'role.updated', `role:${id}`)
		]);
	} else {
		await ctx.db.batch([
			ctx.db
				.prepare('INSERT INTO roles(org_id,name,permissions) VALUES(?1,?2,?3)')
				.bind(ctx.org.id, name, permissions),
			committed(ctx.db, ctx.org.id, ctx.user.id, 'role.created', `role:${name}`)
		]);
	}
	return redirect(303, backPath(ctx.org.slug, 'Role saved', ctx.section));
}

// --------------------------------------------------------------- members

export async function addMember(ctx: SettingsCtx, form: FormData): Promise<never> {
	const identity = str(form, 'user_id').trim();
	const roleId = intOr(form, 'role_id', 0);
	if (!(await rolesOfOrg(ctx.db, ctx.org.id)).some((r) => r.id === roleId)) {
		throw error(400, 'Choose a role belonging to this organization.');
	}
	const user = await qOne<UserRow>(
		ctx.db,
		'SELECT id, email, name, google_sub, picture, is_platform_admin, created_at FROM users WHERE id=?1 OR LOWER(email)=LOWER(?1)',
		[identity]
	);
	if (!user) {
		throw error(400, 'The user must sign in with Google once before membership can be granted.');
	}
	if (ctx.memberRows.some((m) => m.user_id === user.id)) {
		throw error(400, 'Membership already exists. Change its role or restore it instead.');
	}
	const handle = `member-${randomHex(8)}`;
	await ctx.db.batch([
		ctx.db
			.prepare(
				'INSERT INTO memberships(org_id,user_id,role_id,handle,created_at) VALUES(?1,?2,?3,?4,?5)'
			)
			.bind(ctx.org.id, user.id, roleId, handle, nowMs()),
		committed(ctx.db, ctx.org.id, ctx.user.id, 'member.added', `membership:${handle}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Membership granted', ctx.section));
}

export async function setRole(ctx: SettingsCtx, form: FormData, id: number): Promise<never> {
	if (!ctx.memberRows.some((m) => m.id === id)) throw error(404, 'Membership not found.');
	const roleId = intOr(form, 'role_id', 0);
	if (!(await rolesOfOrg(ctx.db, ctx.org.id)).some((r) => r.id === roleId)) {
		throw error(400, 'Choose a role belonging to this organization.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare('UPDATE memberships SET role_id=?1 WHERE id=?2 AND org_id=?3')
			.bind(roleId, id, ctx.org.id),
		committedIfChanged(ctx.db, ctx.org.id, ctx.user.id, 'member.role_changed', `membership:${id}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Member role changed', ctx.section));
}

async function setMembershipActive(ctx: SettingsCtx, id: number, active: boolean): Promise<never> {
	if (!ctx.memberRows.some((m) => m.id === id)) throw error(404, 'Membership not found.');
	if (
		!active &&
		(await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.owner_membership_id === id)
	) {
		throw error(400, 'Transfer pocket ownership before deactivating this member.');
	}
	if (!active && id === (me(ctx)?.id ?? 0)) {
		throw error(400, 'Ask another membership manager to remove your membership.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare('UPDATE memberships SET removed_at=?1 WHERE id=?2 AND org_id=?3')
			.bind(active ? null : nowMs(), id, ctx.org.id),
		committedIfChanged(
			ctx.db,
			ctx.org.id,
			ctx.user.id,
			active ? 'member.restored' : 'member.removed',
			`membership:${id}`
		)
	]);
	if (!active) {
		// Cancel the removed member's still-pending outbox rows.
		await exec(
			ctx.db,
			'UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND to_membership_id=?3 AND cancelled_at IS NULL',
			[nowMs(), ctx.org.id, id]
		);
	}
	return redirect(
		303,
		backPath(ctx.org.slug, active ? 'Membership restored' : 'Access revoked; historical attribution retained', ctx.section)
	);
}

export function removeMember(ctx: SettingsCtx, id: number): Promise<never> {
	return setMembershipActive(ctx, id, false);
}

export function restoreMember(ctx: SettingsCtx, id: number): Promise<never> {
	return setMembershipActive(ctx, id, true);
}

	function me(ctx: SettingsCtx): MemRow | undefined {
		return ctx.memberRows.find((m) => m.user_id === ctx.user.id);
	}

// -------------------------------------------------------------- mappings

export async function addMapping(ctx: SettingsCtx, form: FormData): Promise<never> {
	const pattern = str(form, 'pattern').trim();
	const pocketId = intOr(form, 'pocket_id', 0);
	if (!(await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.id === pocketId)) {
		throw error(400, 'Choose a pocket in this organization.');
	}
	const memberId = optInt(form, 'member_id');
	const member = activeMem(ctx.memberRows, memberId);
	if (pattern === '' || pattern.length > 300 || member === null) {
		throw error(400, 'Supply a statement label and an active member of this organization.');
	}
	const existing = await mappingsOf(ctx.db, ctx.org.id);
	if (
		existing.some(
			(m) => m.pocket_id === pocketId && m.pattern.trim().toLowerCase() === pattern.toLowerCase()
		)
	) {
		throw error(400, 'This label already has a mapping. Remove it before assigning another member.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare(
				'INSERT INTO actor_mappings(org_id,pattern,membership_id,created_by_membership_id,created_at,pocket_id) VALUES(?1,?2,?3,?4,?5,?6)'
			)
			.bind(ctx.org.id, pattern, member.id, me(ctx)?.id ?? 0, nowMs(), pocketId),
		// The pattern is a bank actor label: never enter the audit log. The
		// mapped membership is the stable, non-sensitive identity.
		committed(ctx.db, ctx.org.id, ctx.user.id, 'mapping.created', `mapping:member-${member.id}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Mapping saved; existing transaction assignments were not changed', ctx.section));
}

export async function deleteMapping(ctx: SettingsCtx, id: number): Promise<never> {
	await ctx.db.batch([
		ctx.db.prepare('DELETE FROM actor_mappings WHERE id=?1 AND org_id=?2').bind(id, ctx.org.id),
		committedIfChanged(ctx.db, ctx.org.id, ctx.user.id, 'mapping.deleted', `mapping:${id}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Mapping removed; historical assignments retained', ctx.section));
}

// --------------------------------------------------------------- pockets

export async function addPocket(ctx: SettingsCtx, form: FormData): Promise<never> {
	const name = str(form, 'name').trim();
	const opening = parseRupiah(str(form, 'opening_balance'));
	if (opening === null) {
		throw error(400, 'Supply an opening balance in IDR.');
	}
	if (name === '' || name.length > 120) {
		throw error(400, 'Pocket name must be 1–120 characters.');
	}
	if ((await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
		throw error(400, 'A pocket already uses that name.');
	}
	const owner = optInt(form, 'owner_membership_id') ?? ctx.org.creator_membership_id;
	const ownerMem = activeMem(ctx.memberRows, owner);
	if (ownerMem === null) {
		throw error(400, 'Choose an active pocket owner.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare(
				'INSERT INTO pockets(org_id,name,opening_balance_minor,owner_membership_id) VALUES(?1,?2,?3,?4)'
			)
			.bind(ctx.org.id, name, opening, ownerMem.id),
		committed(ctx.db, ctx.org.id, ctx.user.id, 'pocket.created', `pocket:${name}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Pocket created', ctx.section));
}

export async function setPocketOwner(ctx: SettingsCtx, form: FormData, id: number): Promise<never> {
	const owner = activeMem(ctx.memberRows, optInt(form, 'owner_membership_id'));
	if (owner === null) {
		throw error(400, 'Choose an active pocket owner.');
	}
	if (!(await pocketsOf(ctx.db, ctx.org.id)).some((p) => p.id === id)) {
		throw error(404, 'Pocket not found.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare('UPDATE pockets SET owner_membership_id=?1 WHERE id=?2 AND org_id=?3')
			.bind(owner.id, id, ctx.org.id),
		// actionLabel intentionally falls back to the raw action code here.
		committedIfChanged(ctx.db, ctx.org.id, ctx.user.id, 'pocket.owner_changed', `pocket:${id}`)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Pocket owner saved; historical assignments retained', ctx.section));
}

// ---------------------------------------------------------- income routing

export async function saveIncomeRole(ctx: SettingsCtx, form: FormData): Promise<never> {
	const raw = str(form, 'income_explanation_role_id');
	const role = raw === '' ? null : (optInt(form, 'income_explanation_role_id') ?? 0);
	if (role !== null && !(await rolesOfOrg(ctx.db, ctx.org.id)).some((r) => r.id === role)) {
		throw error(400, 'Choose a role in this organization.');
	}
	await ctx.db.batch([
		ctx.db
			.prepare('UPDATE organizations SET income_explanation_role_id=?1 WHERE id=?2')
			.bind(role, ctx.org.id),
		committedIfChanged(
			ctx.db,
			ctx.org.id,
			ctx.user.id,
			'income.role_changed',
			`organization:${ctx.org.id}`
		)
	]);
	return redirect(303, backPath(ctx.org.slug, 'Income explanation role saved', ctx.section));
}

// ---------------------------------------------------------- notifications

export async function saveNotifications(ctx: SettingsCtx, form: FormData): Promise<never> {
	const enabled = form.get('enabled') !== null;
	const cutoff = str(form, 'cutoff_date');
	if (enabled && !validDate(cutoff)) {
		throw error(400, 'Choose a valid transaction-date cutoff before enabling notifications.');
	}
	if (enabled) {
		const token = str(form, 'preview_token');
		const expected = await csrfForSecret(
			ctx.secret ?? '',
			`notifications:${ctx.org.id}:${cutoff}`
		);
		if (token !== expected) {
			throw error(400, 'Preview recipients for the selected cutoff before enabling notifications.');
		}
	}
	await ctx.db.batch([
		ctx.db
			.prepare(
				'UPDATE organizations SET notifications_enabled=?1,notification_cutoff_date=?2 WHERE id=?3'
			)
			.bind(enabled ? 1 : 0, optStr(form, 'cutoff_date'), ctx.org.id),
		committedIfChanged(
			ctx.db,
			ctx.org.id,
			ctx.user.id,
			'notifications.settings_changed',
			`organization:${ctx.org.slug}`
		)
	]);
	if (!enabled) {
		await exec(
			ctx.db,
			'UPDATE notification_outbox SET cancelled_at=?1 WHERE org_id=?2 AND cancelled_at IS NULL',
			[nowMs(), ctx.org.id]
		);
	}
	return redirect(
		303,
		backPath(ctx.org.slug, 'Notification settings saved; delivery remains local-outbox only', ctx.section)
	);
}

/** Weekly digest capture (local outbox only): one gated insert per eligible
 * recipient whose cadence allows it. */
export async function sendDigest(ctx: SettingsCtx): Promise<never> {
	if (ctx.org.notifications_enabled === 0) {
		throw error(400, 'Organization notifications are disabled.');
	}
	const targets = await digestTargets(
		ctx.db,
		ctx.org,
		ctx.memberRows,
		await rolesOfOrg(ctx.db, ctx.org.id)
	);
	const last = await lastDigestMs(ctx.db, ctx.org.id);
	const now = nowMs();
	for (const [member, items] of targets.groups) {
		if (!digestDue(last.get(member.id) ?? null, now)) continue;
		await insertRow(
			ctx.db,
			ctx.org.id,
			'digest',
			member.id,
			null,
			`Documentation digest — ${ctx.org.name}`,
			digestBody(ctx.org.name, ctx.org.slug, items),
			now,
			ctx.org.notification_revision
		);
	}
	return redirect(
		303,
		backPath(ctx.org.slug, 'Eligible weekly digests captured locally; no email was sent', ctx.section)
	);
}

// ------------------------------------------------- notification outbox port
// Read side of src/web/notify.rs: gated INSERT (digest capture), outbox view,
// and digest target grouping. SQL is carried over verbatim.

interface OwedRow {
	id: number;
	txn_date: string;
	responsible_membership_id: number | null;
	status: string;
	explanation: string;
	evidence_unavailable_reason: string;
	amount_minor: number;
	owner_membership_id: number | null;
	evidence_count: number;
}

interface SplitRespRow {
	transaction_id: number;
	responsible_membership_id: number;
}

export interface DigestItem {
	txnId: number;
	date: string;
}

export interface DigestTargets {
	groups: Array<[MemRow, DigestItem[]]>;
	totalItems: number;
	limited: boolean;
}

/** Insert one outbox row, re-checking every delivery gate inside the INSERT
 * (org enabled, active member, ViewTransactions or income routing, revision
 * guard, transaction suppression and cutoff). A row is written only when every
 * predicate holds; zero affected rows is a normal, silent outcome. */
export async function insertRow(
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
	await exec(
		db,
		"INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, subject, body, created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 FROM organizations o JOIN memberships m ON m.org_id=o.id JOIN roles r ON r.id=m.role_id AND r.org_id=o.id LEFT JOIN transactions t ON t.id=?4 AND t.org_id=o.id WHERE o.id=?1 AND o.notifications_enabled=1 AND m.id=?3 AND m.removed_at IS NULL AND (?8 IS NULL OR o.notification_revision=?8) AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (?4 IS NULL AND ?2='digest' AND (m.role_id=o.income_explanation_role_id OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND EXISTS(SELECT 1 FROM pockets p WHERE p.org_id=o.id AND p.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND ((m.role_id=o.income_explanation_role_id) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=o.id))))) AND (?4 IS NULL OR (t.id IS NOT NULL AND t.suppressed=0 AND (?2='mention' OR o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date)))",
		[orgId, kind, toMid, txnId, subject, body, now, expectedRevision]
	);
}

/** Outbox rows still deliverable-if-there-were-delivery: recipient membership
 * active, org notifications ON, and — for rows tied to a transaction — that
 * transaction not suppressed NOW. Digest rows (transaction_id NULL) pass the
 * transaction filter. */
export async function outboxView(db: D1Database, org: OrgRow) {
	if (org.notifications_enabled === 0) return [];
	return qAll<{ id: number; kind: string; subject: string; created_at: number; to_name: string }>(
		db,
		"SELECT n.id, n.kind, n.subject, n.created_at, u.name AS to_name FROM notification_outbox n JOIN memberships m ON m.id=n.to_membership_id AND m.org_id=n.org_id AND m.removed_at IS NULL JOIN roles r ON r.id=m.role_id AND r.org_id=m.org_id JOIN users u ON u.id=m.user_id LEFT JOIN transactions t ON t.id=n.transaction_id WHERE n.org_id=?1 AND n.cancelled_at IS NULL AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (n.kind='digest' AND EXISTS(SELECT 1 FROM transactions dt JOIN pockets dp ON dp.id=dt.pocket_id AND dp.org_id=dt.org_id JOIN organizations o ON o.id=dt.org_id WHERE dt.org_id=n.org_id AND dt.amount_minor>0 AND trim(dt.explanation)='' AND dt.suppressed=0 AND (o.notification_cutoff_date IS NULL OR dt.txn_date>=o.notification_cutoff_date) AND instr(n.body, '/org/' || o.slug || '/transactions/' || dt.id || char(10))>0 AND (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND dp.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=n.org_id))))) AND (t.id IS NULL OR (t.suppressed=0 AND (n.kind='mention' OR EXISTS(SELECT 1 FROM organizations o WHERE o.id=n.org_id AND (o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date))) AND (t.amount_minor<=0 OR n.kind='mention' OR trim(t.explanation)=''))) AND (t.amount_minor IS NULL OR t.amount_minor<=0 OR n.kind='mention' OR (m.role_id=?2 OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=n.org_id)))) AND (n.kind<>'digest' OR NOT EXISTS(SELECT 1 FROM transactions dt JOIN organizations o ON o.id=dt.org_id JOIN pockets dp ON dp.id=dt.pocket_id AND dp.org_id=dt.org_id WHERE dt.org_id=n.org_id AND instr(n.body, '/org/' || o.slug || '/transactions/' || dt.id || char(10))>0 AND (dt.suppressed<>0 OR (o.notification_cutoff_date IS NOT NULL AND dt.txn_date<o.notification_cutoff_date) OR (dt.amount_minor>0 AND (trim(dt.explanation)<>'' OR NOT (m.role_id=coalesce(?2,-1) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=n.org_id AND im.role_id=?2 AND im.removed_at IS NULL) AND coalesce(dp.owner_membership_id,-1)=m.id))))))) ORDER BY n.id DESC LIMIT 100",
		[org.id, org.income_explanation_role_id]
	);
}

/** Recipient groups for reminders/digest: active members with their
 * documentation-owed transactions (Draft or ChangesRequested only), unsuppressed,
 * at/after the org cutoff. `limited` marks the 500-row scan ceiling. */
export async function digestTargets(
	db: D1Database,
	org: OrgRow,
	mems: readonly MemRow[],
	roles: readonly RoleRow[]
): Promise<DigestTargets> {
	const rows = await qAll<OwedRow>(
		db,
		"SELECT t.id, t.txn_date, t.responsible_membership_id, t.status, t.explanation, t.evidence_unavailable_reason, t.amount_minor, p.owner_membership_id, (SELECT COUNT(*) FROM documents d WHERE d.transaction_id = t.id AND d.kind = 'evidence' AND d.superseded = 0) AS evidence_count FROM transactions t JOIN pockets p ON p.id=t.pocket_id AND p.org_id=t.org_id WHERE t.org_id = ?1 AND t.suppressed = 0 ORDER BY t.txn_date DESC, t.id DESC LIMIT 500",
		[org.id]
	);
	const limited = rows.length === 500;
	const cutoff =
		org.notification_cutoff_date !== null && org.notification_cutoff_date !== ''
			? org.notification_cutoff_date
			: null;
	const owed = rows.filter((r) => {
		const complete =
			r.explanation.trim() !== '' &&
			(r.evidence_count > 0 || r.evidence_unavailable_reason.trim() !== '');
		const chase =
			r.amount_minor > 0
				? !incomeComplete(r.explanation)
				: documentationOwed(r.status, complete);
		return chase && (cutoff === null || r.txn_date >= cutoff);
	});

	// Split-level responsibles chase their own purposes (txn-level inheriting
	// NULLs are covered by responsible_membership_id below).
	const owedIds = owed.map((r) => r.id);
	const splitResps = new Map<number, number[]>();
	if (owedIds.length > 0) {
		// Never expand one bind parameter per historical transaction.
		const srows = await qAll<SplitRespRow>(
			db,
			'SELECT s.transaction_id,s.responsible_membership_id FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.org_id=?1 AND t.suppressed=0 AND s.responsible_membership_id IS NOT NULL',
			[org.id]
		);
		for (const s of srows) {
			if (owedIds.includes(s.transaction_id)) {
				const list = splitResps.get(s.transaction_id);
				if (list) list.push(s.responsible_membership_id);
				else splitResps.set(s.transaction_id, [s.responsible_membership_id]);
			}
		}
	}

	// Expense rows chase only members holding ViewTransactions (income rows are
	// routed by role/owner regardless of permissions, as in Rust).
	const memberRefs = mems.map((m) => ({
		userId: m.user_id,
		roleId: m.role_id,
		active: memActive(m)
	}));
	const roleRefs = roles.map((r) => ({ id: r.id, permissions: r.permissions }));
	const hasView = new Map<number, boolean>();
	for (const m of mems) {
		hasView.set(m.id, permissionsFor(memberRefs, roleRefs, m.user_id).has('ViewTransactions'));
	}

	const eligible = (mid: number): MemRow | null => {
		const m = mems.find((candidate) => candidate.id === mid);
		return m && memActive(m) ? m : null;
	};

	const byMem = new Map<number, DigestItem[]>();
	for (const r of owed) {
		const members = mems.map((m) => ({ id: m.id, roleId: m.role_id, active: memActive(m) }));
		let resps: number[];
		if (r.amount_minor > 0) {
			resps = incomeRecipients(org.income_explanation_role_id, r.owner_membership_id, members);
		} else {
			resps = splitResps.get(r.id) ?? [];
			splitResps.delete(r.id);
			if (r.responsible_membership_id !== null && !resps.includes(r.responsible_membership_id)) {
				resps.push(r.responsible_membership_id);
			}
		}
		for (const mid of resps) {
			const m = eligible(mid);
			if (m === null) continue;
			if (r.amount_minor > 0 || hasView.get(m.id) === true) {
				const items = byMem.get(mid) ?? [];
				if (!items.some((i) => i.txnId === r.id)) {
					items.push({ txnId: r.id, date: r.txn_date });
					byMem.set(mid, items);
				}
			}
		}
	}

	const groups: Array<[MemRow, DigestItem[]]> = [];
	for (const [mid, items] of [...byMem.entries()].sort((a, b) => a[0] - b[0])) {
		const m = eligible(mid);
		if (m) groups.push([m, items]);
	}
	groups.sort((a, b) => {
		const an = a[0].name.toLowerCase();
		const bn = b[0].name.toLowerCase();
		return an < bn ? -1 : an > bn ? 1 : 0;
	});
	return { groups, totalItems: owed.length, limited };
}

/** Settings-page preview payload. `limited` marks a partial scan. */
export function previewJson(t: DigestTargets) {
	return {
		recipients: t.groups.map(([m, items]) => ({ name: m.name, pending: items.length })),
		totalItems: t.totalItems,
		limited: t.limited
	};
}

/** Last uncancelled digest timestamp per membership (cadence key). */
export async function lastDigestMs(db: D1Database, orgId: number): Promise<Map<number, number>> {
	const rows = await qAll<{ to_membership_id: number; last: number }>(
		db,
		"SELECT to_membership_id, MAX(created_at) AS last FROM notification_outbox WHERE org_id = ?1 AND kind = 'digest' AND cancelled_at IS NULL GROUP BY to_membership_id",
		[orgId]
	);
	return new Map(rows.map((r) => [r.to_membership_id, r.last]));
}
