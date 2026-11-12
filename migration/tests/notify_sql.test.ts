// Notification trigger semantics against the real migrations, ported from
// tests/income_notifications.rs and tests/pocket_responsibility.rs. A plain
// SQLite connection executes the same trigger and outbox SQL the Worker uses.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

let db: InstanceType<typeof DatabaseSync>;

const run = (sql: string, ...params: unknown[]) => { try { return db.prepare(sql).run(...(params as Parameters<StatementSync['run']>)); } catch (e) { throw new Error(`${(e as Error).message} [sql: ${sql.slice(0, 60)}]`); } };
const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...(params as Parameters<StatementSync['get']>)) as T;
const all = <T>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...(params as Parameters<StatementSync['all']>)) as T[];

beforeEach(() => {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON;');
	for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
		db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	}
});

function seedWorld() {
	run("INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'one@example.test', 'One', 0), ('u2', 'two@example.test', 'Two', 0), ('owner', 'own@example.test', 'Owner', 0)");
	run("INSERT INTO organizations (id, slug, name, notifications_enabled, notification_cutoff_date, created_at) VALUES (1, 'org', 'Org', 1, '2025-01-01', 0)");
	run("INSERT INTO roles (id, org_id, name, permissions) VALUES (10, 1, 'Income', '[]'), (20, 1, 'Plain', '[]')");
	run("UPDATE organizations SET income_explanation_role_id=10 WHERE id=1");
	run("INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at) VALUES (1, 1, 'u1', 10, 'one', 0), (2, 1, 'u2', 10, 'two', 0), (3, 1, 'owner', 20, 'own', 0)");
	run("INSERT INTO pockets (id, org_id, name, opening_balance_minor, owner_membership_id) VALUES (1, 1, 'Main', 0, 3)");
}

/** The exact insert_row statement from src/web/notify.rs. */
const INSERT_ROW = `INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, subject, body, created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 FROM organizations o JOIN memberships m ON m.org_id=o.id JOIN roles r ON r.id=m.role_id AND r.org_id=o.id LEFT JOIN transactions t ON t.id=?4 AND t.org_id=o.id WHERE o.id=?1 AND o.notifications_enabled=1 AND m.id=?3 AND m.removed_at IS NULL AND (?8 IS NULL OR o.notification_revision=?8) AND (EXISTS(SELECT 1 FROM json_each(r.permissions) WHERE value='ViewTransactions') OR (?4 IS NULL AND ?2='digest' AND (m.role_id=o.income_explanation_role_id OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND EXISTS(SELECT 1 FROM pockets p WHERE p.org_id=o.id AND p.owner_membership_id=m.id)))) OR (t.amount_minor>0 AND ((m.role_id=o.income_explanation_role_id) OR (NOT EXISTS(SELECT 1 FROM memberships im WHERE im.org_id=o.id AND im.role_id=o.income_explanation_role_id AND im.removed_at IS NULL) AND m.id=(SELECT p.owner_membership_id FROM pockets p WHERE p.id=t.pocket_id AND p.org_id=o.id))))) AND (?4 IS NULL OR (t.id IS NOT NULL AND t.suppressed=0 AND (?2='mention' OR o.notification_cutoff_date IS NULL OR t.txn_date>=o.notification_cutoff_date)))`;

function enqueue(memberId: number, kind: string, txnId: number | null, revision: number | null = null): void {
	run(INSERT_ROW, 1, kind, memberId, txnId, 'Subject', 'Documentation task — /org/org/transactions/7\n', 1, revision);
}

const visible = () => all<{ id: number }>('SELECT id FROM notification_outbox WHERE cancelled_at IS NULL ORDER BY id').map((r) => r.id);

describe('income notification routing (production SQL)', () => {
	beforeEach(() => {
		seedWorld();
		run("INSERT INTO transactions (id, org_id, pocket_id, bank_id, txn_date, amount_minor, explanation, suppressed, created_at, updated_at) VALUES (7, 1, 1, 'B1', '2026-01-01', 100, '', 0, 0, 0)");
	});

	/** Enqueue-side gate check: a fresh insert for `memberId` either lands
	 * (returns an id) or writes nothing (insert_row's SELECT filters it). */
	function freshEnqueueWrites(memberId: number, kind: string, txnId: number | null): boolean {
		const before = one<{ n: number }>('SELECT COUNT(*) AS n FROM notification_outbox').n;
		enqueue(memberId, kind, txnId);
		return one<{ n: number }>('SELECT COUNT(*) AS n FROM notification_outbox').n > before;
	}

	it('mention requires an active member; removed members are gated at enqueue', () => {
		expect(freshEnqueueWrites(1, 'mention', 7)).toBe(true);
		run('UPDATE memberships SET removed_at=1 WHERE id=1');
		// The queued row stays (read-side outbox_view hides it), but new
		// enqueues for the removed member write nothing.
		expect(freshEnqueueWrites(1, 'mention', 7)).toBe(false);
		expect(freshEnqueueWrites(2, 'mention', 7)).toBe(true);
	});

	it('assignment and digest follow current income routing with owner fallback', () => {
		expect(freshEnqueueWrites(1, 'assignment', 7)).toBe(true);
		expect(freshEnqueueWrites(2, 'assignment', 7)).toBe(true);
		expect(freshEnqueueWrites(1, 'digest', null)).toBe(true);
		// Role change reroutes: role 10 emptied, owner (membership 3, role 20) takes over.
		run('UPDATE memberships SET role_id=20 WHERE id IN (1,2)');
		expect(freshEnqueueWrites(1, 'assignment', 7)).toBe(false);
		expect(freshEnqueueWrites(3, 'assignment', 7)).toBe(true);
		expect(freshEnqueueWrites(3, 'digest', null)).toBe(true);
		// Completed notes stop the chase on the READ side (outbox_view filters
		// trim(explanation='') for income), while enqueue-side inserts still
		// carry the assignment — the same split the Rust implementation has.
		run("UPDATE transactions SET explanation='Member notes'");
		expect(freshEnqueueWrites(3, 'assignment', 7)).toBe(true);
		expect(freshEnqueueWrites(1, 'assignment', 7)).toBe(false);
	});

	it('suppression, cutoff, and org gate block enqueue-side rows', () => {
		run('UPDATE transactions SET suppressed=1');
		enqueue(3, 'assignment', 7);
		expect(visible()).toHaveLength(0);
		run('UPDATE transactions SET suppressed=0, txn_date=\'2024-01-01\'');
		enqueue(3, 'assignment', 7);
		expect(visible()).toHaveLength(0);
		run("UPDATE organizations SET notifications_enabled=0");
		enqueue(3, 'mention', 7);
		expect(visible()).toHaveLength(0);
	});
});

describe('expense upload preserves income review history', () => {
	it('income rows keep their approval; expenses reopen', () => {
		seedWorld();
		run("INSERT INTO transactions (id, org_id, pocket_id, bank_id, txn_date, amount_minor, status, approved_at, approved_by_membership_id, approval_note, created_at, updated_at) VALUES (1, 1, 1, 'A', '2026-01-01', 100, 'approved', 123, 1, 'Legacy approval', 0, 0), (2, 1, 1, 'B', '2026-01-02', -100, 'approved', 123, 1, 'Legacy approval', 0, 0)");
		const update = "UPDATE transactions SET status=CASE WHEN amount_minor>0 THEN status ELSE 'pending' END,approved_at=CASE WHEN amount_minor>0 THEN approved_at ELSE NULL END,approved_by_membership_id=CASE WHEN amount_minor>0 THEN approved_by_membership_id ELSE NULL END,approval_note=CASE WHEN amount_minor>0 THEN approval_note ELSE '' END,updated_at=?1,revision=revision+1,mutation_token=?2 WHERE id=?3 AND org_id=?4 AND revision=?5";
		for (const id of [1, 2]) run(update, 2, 'token', id, 1, 0);
		const income = one<{ status: string; approved_at: number; approval_note: string }>('SELECT status, approved_at, approval_note FROM transactions WHERE id=1');
		expect(income).toEqual({ status: 'approved', approved_at: 123, approval_note: 'Legacy approval' });
		const expense = one<{ status: string; approved_at: number | null; approval_note: string }>('SELECT status, approved_at, approval_note FROM transactions WHERE id=2');
		expect(expense).toEqual({ status: 'pending', approved_at: null, approval_note: '' });
	});
});

describe('notification revision triggers', () => {
	beforeEach(seedWorld);

	it('transaction revision cancels digest and matching assignment rows; mentions survive', () => {
		run("INSERT INTO transactions (id, org_id, pocket_id, bank_id, txn_date, amount_minor, explanation, suppressed, created_at, updated_at) VALUES (7, 1, 1, 'B1', '2026-01-01', 100, '', 0, 0, 0)");
		enqueue(1, 'digest', null);
		enqueue(1, 'assignment', 7);
		enqueue(1, 'mention', 7);
		run("INSERT INTO transactions (id, org_id, pocket_id, txn_date, amount_minor, explanation, suppressed, created_at, updated_at) VALUES (8, 1, 1, '2026-01-02', 100, '', 0, 0, 0)");
		// The insert trigger bumps the org revision but cancels nothing.
		expect(visible()).toHaveLength(3);
		run("UPDATE transactions SET explanation='now complete', revision=revision+1 WHERE id=7");
		// Revision bump cancels digests and assignment rows for that txn; the mention survives.
		expect(visible()).toHaveLength(1);
		const kinds = all<{ kind: string }>("SELECT kind FROM notification_outbox WHERE cancelled_at IS NULL").map((r) => r.kind);
		expect(kinds).toEqual(['mention']);
	});

	it('membership change cancels queued digests so the next digest re-reads routing', () => {
		enqueue(1, 'digest', null);
		expect(visible()).toHaveLength(1);
		run('UPDATE memberships SET removed_at=1 WHERE id=2');
		const cancelled = one<{ cancelled_at: number | null }>('SELECT cancelled_at FROM notification_outbox WHERE kind=\'digest\'');
		expect(cancelled.cancelled_at).toBe(0);
		expect(visible()).toHaveLength(0);
	});

	it('configuration change re-enables digests; enabling never releases a flood', () => {
		run('UPDATE organizations SET notifications_enabled=0');
		enqueue(1, 'digest', null);
		expect(visible()).toHaveLength(0);
		run("UPDATE organizations SET notifications_enabled=1, notification_cutoff_date='2025-06-01'");
		// Disabled-time rows stay cancelled: enabling must not release them.
		expect(visible()).toHaveLength(0);
	});
});

describe('pocket responsibility constraints (migration 0010)', () => {
	it('all migrations accept the synthetic seed and keep owners active', () => {
		db.exec(readFileSync(join(ROOT, 'tests', 'fixtures', 'seed.sql'), 'utf8'));
		const owners = one<{ n: number }>('SELECT COUNT(*) AS n FROM pockets p JOIN memberships m ON m.id=p.owner_membership_id AND m.org_id=p.org_id AND m.removed_at IS NULL');
		expect(owners.n).toBe(2);
		const mappings = one<{ n: number }>('SELECT COUNT(*) AS n FROM actor_mappings WHERE pocket_id=1 AND org_id=1');
		expect(mappings.n).toBe(2);
	});

	it('deactivating a pocket owner is blocked until ownership transfers', () => {
		db.exec(readFileSync(join(ROOT, 'tests', 'fixtures', 'seed.sql'), 'utf8'));
		expect(() => run('UPDATE memberships SET removed_at=1 WHERE id=1')).toThrow(/Transfer pocket ownership/);
		run('UPDATE pockets SET owner_membership_id=2 WHERE id=1');
		expect(() => run('UPDATE memberships SET removed_at=1 WHERE id=1')).not.toThrow();
	});

	it('mapping member must stay current, pocket owner must stay active', () => {
		db.exec(readFileSync(join(ROOT, 'tests', 'fixtures', 'seed.sql'), 'utf8'));
		expect(() => run('UPDATE actor_mappings SET membership_id=999 WHERE pocket_id=1')).toThrow(/Mapping requires current pocket/);
		expect(() => run('UPDATE pockets SET owner_membership_id=999 WHERE id=1')).toThrow(/Pocket requires an active owner/);
	});
});
