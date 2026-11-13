// SQLite-level checks for audit-trail SQL semantics against the real migration
// schema, ported from tests/audit_sql.rs. D1 executes batched statements
// sequentially inside one transaction, so a plain SQLite connection reproduces
// the changes() chains, the append-only triggers, and the scope-isolation
// queries faithfully. Node's built-in sqlite keeps this dependency-free.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

const AUDIT_COMMITTED =
	"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) VALUES(?1,?2,?3,?4,'committed',?5)";
const AUDIT_COMMITTED_IF_CHANGED =
	"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,?3,?4,'committed',?5 WHERE changes()=1";

let db: InstanceType<typeof DatabaseSync>;

function count(sql: string): number {
	return (db.prepare(sql).get() as { n: number }).n;
}

function run(sql: string, ...params: unknown[]): void {
	db.prepare(sql).run(...(params as Parameters<StatementSync['run']>));
}

beforeEach(() => {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON;');
	for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
		db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	}
});

function seedOrg(slug: string, userId: string): { org: number; role: number; member: number } {
	run('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, 1)', userId, `${userId}@example.test`, 'Actor');
	run('INSERT INTO organizations (slug, name, created_at) VALUES (?, ?, 1)', slug, `Org ${slug}`);
	const orgId = (db.prepare('SELECT id FROM organizations WHERE slug=?').get(slug) as { id: number }).id;
	run("INSERT INTO roles (org_id, name, permissions) VALUES (?, 'Admin', '[]')", orgId);
	const roleId = (db.prepare('SELECT id FROM roles WHERE org_id=?').get(orgId) as { id: number }).id;
	run('INSERT INTO memberships (org_id, user_id, role_id, handle, created_at) VALUES (?, ?, ?, ?, 1)', orgId, userId, roleId, userId);
	const memberId = (db.prepare('SELECT id FROM memberships WHERE org_id=? AND user_id=?').get(orgId, userId) as { id: number }).id;
	return { org: orgId, role: roleId, member: memberId };
}

function seedPocket(orgId: number, memberId: number): number {
	run('INSERT INTO pockets (org_id, name, opening_balance_minor, owner_membership_id) VALUES (?, ?, 0, ?)', orgId, 'Main', memberId);
	return (db.prepare('SELECT id FROM pockets WHERE org_id=?').get(orgId) as { id: number }).id;
}

function seedMapping(orgId: number, memberId: number, pattern = 'label'): number {
	const pocket = seedPocket(orgId, memberId);
	run(
		'INSERT INTO actor_mappings (org_id, pocket_id, pattern, membership_id, created_by_membership_id, created_at) VALUES (?, ?, ?, ?, ?, 1)',
		orgId, pocket, pattern, memberId, memberId
	);
	return (db.prepare('SELECT id FROM actor_mappings WHERE org_id=?').get(orgId) as { id: number }).id;
}

function auditRow(actor: string, orgId: number | null, action: string, target: string): void {
	run(AUDIT_COMMITTED, actor, orgId, action, target, 1);
}

describe('append-only audit', () => {
	it('migrations apply and audit rejects updates and deletes', () => {
		const { org: orgId } = seedOrg('acme', 'u:a');
		auditRow('u:a', orgId, 'role.created', 'role:Admin');
		expect(() => run("UPDATE audit_events SET action='x' WHERE org_id=?", orgId)).toThrow(/append-only/);
		expect(() => run('DELETE FROM audit_events WHERE org_id=?', orgId)).toThrow(/append-only/);
	});
});

describe('gated audit', () => {
	it('skips zero-row updates and deletes, records real ones once', () => {
		const { org: orgId, role: roleId, member } = seedOrg('acme', 'u:actor');
		const mapping = seedMapping(orgId, member);

		run('UPDATE memberships SET role_id=? WHERE id=? AND org_id=?', roleId, -999, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'member.role_changed', 'membership:-999', 1);
		run('UPDATE roles SET name=?,permissions=? WHERE id=? AND org_id=?', 'Renamed', '[]', -999, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'role.updated', 'role:-999', 1);
		expect(count('SELECT COUNT(*) AS n FROM audit_events')).toBe(0);

		run('DELETE FROM actor_mappings WHERE id=? AND org_id=?', mapping, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'mapping.deleted', `mapping:${mapping}`, 1);
		expect(count('SELECT COUNT(*) AS n FROM audit_events')).toBe(1);
		run('DELETE FROM actor_mappings WHERE id=? AND org_id=?', mapping, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'mapping.deleted', `mapping:${mapping}`, 1);
		expect(count('SELECT COUNT(*) AS n FROM audit_events')).toBe(1);

		run('UPDATE memberships SET role_id=? WHERE id=? AND org_id=?', roleId, member, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'member.role_changed', `membership:${member}`, 1);
		run('UPDATE roles SET name=?,permissions=? WHERE id=? AND org_id=?', 'Renamed', '[]', roleId, orgId);
		run(AUDIT_COMMITTED_IF_CHANGED, 'u:actor', orgId, 'role.updated', `role:${roleId}`, 1);
		expect(count('SELECT COUNT(*) AS n FROM audit_events')).toBe(3);
	});

	it('org and platform lists are scope isolated', () => {
		const { org: org1 } = seedOrg('acme', 'u:acme-admin');
		const { org: org2 } = seedOrg('beta', 'u:beta-admin');
		run("INSERT INTO users (id, email, name, created_at) VALUES ('g:platform', 'platform@example.test', 'Platform Admin', 1)");
		auditRow('u:acme-admin', org1, 'role.created', 'role:Admin');
		auditRow('u:beta-admin', org2, 'pocket.created', 'pocket:Ops');
		auditRow('g:platform', null, 'auth.login', 'session');
		auditRow('g:platform', null, 'platform.admin', 'user:g:target');

		const orgRows = db.prepare('SELECT org_id, action FROM audit_events WHERE org_id=? ORDER BY id DESC LIMIT ? OFFSET ?').all(org1, 50, 0) as Array<{ org_id: number; action: string }>;
		expect(orgRows).toEqual([{ org_id: org1, action: 'role.created' }]);

		const platformRows = db.prepare('SELECT action FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ? OFFSET ?').all(50, 0) as Array<{ action: string }>;
		expect(platformRows.map((r) => r.action)).toEqual(['platform.admin', 'auth.login']);

		const page1 = db.prepare('SELECT action FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ? OFFSET ?').all(1, 0) as Array<{ action: string }>;
		expect(page1.map((r) => r.action)).toEqual(['platform.admin']);
		const page2 = db.prepare('SELECT action FROM audit_events WHERE org_id IS NULL ORDER BY id DESC LIMIT ? OFFSET ?').all(1, 1) as Array<{ action: string }>;
		expect(page2.map((r) => r.action)).toEqual(['auth.login']);
	});

	it('mapping audit targets never carry bank labels', () => {
		const { org: orgId, member } = seedOrg('acme', 'u:actor');
		const pattern = 'PT SUMBER REZEKI SURABAYA';
		seedMapping(orgId, member, pattern);
		run(AUDIT_COMMITTED, 'u:actor', orgId, 'mapping.created', `mapping:member-${member}`, 1);
		const leaked = (db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE '%mapping%' AND (target LIKE '%' || ? || '%' OR outcome LIKE '%' || ? || '%')").get(pattern, pattern) as { n: number }).n;
		expect(leaked).toBe(0);
	});
});

describe('import confirm chain', () => {
	it('losing confirmer writes nothing; CAS flip ordering is preserved', () => {
		const { org: orgId, member } = seedOrg('acme', 'u:actor');
		run('INSERT INTO pockets (org_id, name, opening_balance_minor, owner_membership_id) VALUES (?, ?, 0, ?)', orgId, 'Main', member);
		const pocket = (db.prepare('SELECT id FROM pockets WHERE org_id=?').get(orgId) as { id: number }).id;
		run('INSERT INTO import_batches (org_id, pocket_id, filename, created_by_membership_id, created_at) VALUES (?, ?, ?, ?, 1)', orgId, pocket, 'statement.pdf', member);
		const batch = (db.prepare('SELECT id FROM import_batches WHERE org_id=?').get(orgId) as { id: number }).id;
		run("UPDATE import_batches SET status='ready' WHERE id=?", batch);

		// Winner: CAS flip, guarded audit, guarded item, finalize consuming guard.
		const guard = 'confirming:w1';
		run("UPDATE import_batches SET status=? WHERE id=? AND org_id=? AND status='ready'", guard, batch, orgId);
		run(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?,?,'import.committed',?,'committed',? WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=? AND org_id=? AND status=?)",
			'u:actor', orgId, `import_batch:${batch}`, 1, batch, orgId, guard
		);
		run(
			"INSERT INTO import_items (batch_id, transaction_id, bank_id, status, counterparty, amount_minor, message) SELECT ?, NULL, 'B-1', 'imported', 'Coffee Shop', 15000, '' WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=? AND org_id=? AND status=?)",
			batch, batch, orgId, guard
		);
		run(
			"UPDATE import_batches SET totals=(SELECT json_object('imported',COALESCE(SUM(status='imported'),0),'duplicate_unchanged',COALESCE(SUM(status='duplicate_unchanged'),0),'conflict',COALESCE(SUM(status='conflict'),0),'needs_review',COALESCE(SUM(status='needs_review'),0)) FROM import_items WHERE batch_id=?),status='committed' WHERE id=? AND org_id=? AND status=?",
			batch, batch, orgId, guard
		);

		// Loser: starts after finalize; CAS matches zero rows and nothing lands.
		const lostGuard = 'confirming:w2';
		run("UPDATE import_batches SET status=? WHERE id=? AND org_id=? AND status='ready'", lostGuard, batch, orgId);
		run(
			"INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?,?,'import.committed',?,'committed',? WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=? AND org_id=? AND status=?)",
			'u:loser', orgId, `import_batch:${batch}`, 1, batch, orgId, lostGuard
		);
		run(
			"INSERT INTO import_items (batch_id, transaction_id, bank_id, status, counterparty, amount_minor, message) SELECT ?, NULL, 'B-2', 'imported', 'Other', 100, '' WHERE EXISTS(SELECT 1 FROM import_batches WHERE id=? AND org_id=? AND status=?)",
			batch, batch, orgId, lostGuard
		);
		expect(count('SELECT COUNT(*) AS n FROM audit_events')).toBe(1);
		expect(count("SELECT COUNT(*) AS n FROM import_items WHERE bank_id='B-2'")).toBe(0);
		expect((db.prepare('SELECT status FROM import_batches WHERE id=?').get(batch) as { status: string }).status).toBe('committed');
	});
});

describe('stock chain', () => {
	it('level update gates movement and audit on changes()', () => {
		const { org: orgId, member } = seedOrg('acme', 'u:actor');
		run('INSERT INTO inventory_items (org_id, name, variant) VALUES (?, ?, ?)', orgId, 'Shirt', 'M');
		const item = (db.prepare('SELECT id FROM inventory_items WHERE org_id=?').get(orgId) as { id: number }).id;
		run('INSERT INTO inventory_locations (org_id, name) VALUES (?, ?)', orgId, 'Box');
		const location = (db.prepare('SELECT id FROM inventory_locations WHERE org_id=?').get(orgId) as { id: number }).id;
		run('INSERT OR IGNORE INTO inventory_levels (item_id, location_id, qty) VALUES (?, ?, 0)', item, location);
		run('UPDATE inventory_levels SET qty = qty + ? WHERE item_id = ? AND location_id = ? AND qty + ? >= 0 AND qty + ? <= 9000000000000000', -5, item, location, -5, -5);
		expect(count('SELECT COUNT(*) AS n FROM stock_movements')).toBe(0);
		run('UPDATE inventory_levels SET qty = qty + ? WHERE item_id = ? AND location_id = ? AND qty + ? >= 0 AND qty + ? <= 9000000000000000', 12, item, location, 12, 12);
		run(
			'INSERT INTO stock_movements (org_id, item_id, location_id, delta, from_qty, to_qty, reason, by_membership_id, created_at) SELECT ?, ?, ?, ?, qty - ?, qty, ?, ?, ? FROM inventory_levels WHERE item_id = ? AND location_id = ? AND changes() = 1',
			orgId, item, location, 12, 12, 'initial', member, 1, item, location
		);
		const movement = db.prepare('SELECT from_qty, to_qty FROM stock_movements').get() as { from_qty: number; to_qty: number };
		expect(movement).toEqual({ from_qty: 0, to_qty: 12 });
	});
});
