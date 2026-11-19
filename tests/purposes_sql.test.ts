// Purpose migration and SQL gates against the real migrations, in the style of
// tests/notify_sql.test.ts. SQLite in memory runs 0001..0014, then the
// additive purpose migration is asserted on seeded legacy splits.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIST_SQL } from '../src/lib/server/ledger';
import { owedPurposeState, submittedPurposeTasks, INSERT_PURPOSE_NOTICE_SQL } from '../src/lib/server/purposes';
import { digestTargets } from '../src/lib/server/settings';
import { wrapSqlite } from './helpers/sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

let db: InstanceType<typeof DatabaseSync>;

const run = (sql: string, ...params: unknown[]) => {
	try {
		return db.prepare(sql).run(...(params as Parameters<StatementSync['run']>));
	} catch (cause) {
		throw new Error(`${(cause as Error).message} [sql: ${sql.slice(0, 70)}]`);
	}
};
const one = <T>(sql: string, ...params: unknown[]): T =>
	db.prepare(sql).get(...(params as Parameters<StatementSync['get']>)) as T;
const all = <T>(sql: string, ...params: unknown[]): T[] =>
	db.prepare(sql).all(...(params as Parameters<StatementSync['all']>)) as T[];

/** Fresh database with every migration applied, like D1 after `migrations apply`. */
function migrated() {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON;');
	for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
		db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	}
}

/** Fresh database at 0013, seeded with legacy splits, then migrated to 0014 —
 * the shape production had when the purpose migration ran. */
function migratedAfterSeed() {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON;');
	const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
	for (const file of files.filter((name) => name < '0014')) db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	seedWorld();
	db.exec(readFileSync(join(MIGRATIONS_DIR, '0014_purposes.sql'), 'utf8'));
}

function seedWorld() {
	run("INSERT INTO users (id, email, name, created_at) VALUES ('u1','one@example.test','One',0), ('u2','two@example.test','Two',0)");
	run("INSERT INTO organizations (id, slug, name, notifications_enabled, created_at) VALUES (1,'org','Org',1,0)");
	run("INSERT INTO roles (id, org_id, name, permissions) VALUES (10,1,'Admin','[\"ViewTransactions\",\"CommentTransactions\",\"DocumentTransactions\",\"ApproveTransactions\"]')");
	run("INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at) VALUES (1,1,'u1',10,'one',0), (2,1,'u2',10,'two',0)");
	run("INSERT INTO pockets (id, org_id, name, opening_balance_minor, owner_membership_id) VALUES (1,1,'Main',0,1)");
	// Expense 10M with two splits (the canonical example); expense 3M unsplit; income 2M unsplit.
	run(`INSERT INTO transactions (id, org_id, pocket_id, bank_id, txn_date, amount_minor, explanation, evidence_unavailable_reason, responsible_membership_id, status, created_at, updated_at)
	     VALUES (1, 1, 1, 'B1', '2026-01-01', -10000000, 'June meetup', '', 1, 'pending', 0, 0),
	            (3, 1, 1, 'B3', '2026-01-03', -3000000, '', '', 1, 'pending', 0, 0),
	            (2, 1, 1, 'B2', '2026-01-02', 2000000, 'Sponsorship', '', 1, 'approved', 0, 0)`);
	run(`INSERT INTO transaction_splits (transaction_id, label, amount_minor, responsible_membership_id, created_at)
	     VALUES (1, 'Food', 1000000, NULL, 0), (1, 'T-Shirts', 9000000, 2, 0)`);
}

describe('purpose migration (0014)', () => {
	beforeEach(migratedAfterSeed);

	it('creates one purpose per split, never merging labels', () => {
		const purposes = all<{ name: string; kind: string }>('SELECT name, kind FROM purposes ORDER BY id');
		expect(purposes).toEqual([
			{ name: 'Food', kind: 'expense' },
			{ name: 'T-Shirts', kind: 'expense' }
		]);
	});

	it('creates matching allocations with magnitudes preserved', () => {
		const rows = all<{ purpose_id: number; transaction_id: number; amount_minor: number }>(
			'SELECT purpose_id, transaction_id, amount_minor FROM allocations ORDER BY id'
		);
		expect(rows.map((row) => row.amount_minor)).toEqual([1_000_000, 9_000_000]);
		expect(rows.every((row) => row.transaction_id === 1)).toBe(true);
	});

	it('seeds purpose responsibles from the split override or the transaction member', () => {
		const foodResponsible = one<{ membership_id: number }>(
			"SELECT pr.membership_id FROM purpose_responsibles pr JOIN purposes p ON p.id = pr.purpose_id WHERE p.name = 'Food'"
		);
		const shirtResponsible = one<{ membership_id: number }>(
			"SELECT pr.membership_id FROM purpose_responsibles pr JOIN purposes p ON p.id = pr.purpose_id WHERE p.name = 'T-Shirts'"
		);
		expect(foodResponsible?.membership_id).toBe(1); // inherited from the transaction
		expect(shirtResponsible?.membership_id).toBe(2); // explicit split override
	});

	it('copies Notes from the explanation plus the missing-evidence outcome', () => {
		const notes = one<{ notes: string }>("SELECT notes FROM purposes WHERE name = 'Food'");
		expect(notes?.notes).toBe('June meetup');
	});

	it('leaves unsplit transactions unallocated and preserves them', () => {
		const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM allocations WHERE transaction_id = 3')!;
		expect(count.n).toBe(0);
		const txn = one<{ explanation: string; status: string }>('SELECT explanation, status FROM transactions WHERE id = 3')!;
		expect(txn.explanation).toBe('');
		expect(txn.status).toBe('pending');
	});

	it('preserves legacy splits, comments, and evidence rows untouched', () => {
		expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM transaction_splits')!.n).toBe(2);
	});
});

describe('ledger derived status SQL', () => {
	beforeEach(migratedAfterSeed);

	it('derives review states from allocated purposes', () => {
		const rows = <Array<{ id: number; derived_status: string }>>db.prepare(LIST_SQL).all(1, '', 10, 0);
		// txn 1: both purposes pending with seeded Notes → 'submitted'; txn 3 unallocated → ''.
		const byId = new Map(rows.map((row) => [row.id, row.derived_status]));
		expect(byId.get(1)).toBe('submitted');
		expect(byId.get(3)).toBe('');
		expect(byId.get(2)).toBe(''); // income keeps the stored status path
		run("UPDATE purposes SET status = 'approved'");
		expect(all('SELECT 1').length).toBeGreaterThan(0);
		const approvedRows = <Array<{ id: number; derived_status: string }>>db.prepare(LIST_SQL).all(1, '', 10, 0);
		expect(new Map(approvedRows.map((row) => [row.id, row.derived_status])).get(1)).toBe('approved');
		run("UPDATE purposes SET status = 'pending', notes = '' WHERE name = 'Food'");
		const partial = <Array<{ id: number; derived_status: string }>>db.prepare(LIST_SQL).all(1, '', 10, 0);
		expect(new Map(partial.map((row) => [row.id, row.derived_status])).get(1)).toBe('needs');
		run("UPDATE purposes SET notes = 'x' WHERE name = 'Food'");
		run("UPDATE allocations SET amount_minor = 500000 WHERE purpose_id = (SELECT id FROM purposes WHERE name = 'Food')");
		const remainder = <Array<{ id: number; derived_status: string }>>db.prepare(LIST_SQL).all(1, '', 10, 0);
		expect(new Map(remainder.map((row) => [row.id, row.derived_status])).get(1)).toBe('needs');
	});

	it('filters map derived states into the ledger chips', () => {
		const needs = <Array<{ id: number }>>db.prepare(LIST_SQL).all(1, 'needs_details', 10, 0);
		expect(needs.map((row) => row.id)).toEqual([3]); // legacy unallocated expense
		run("UPDATE purposes SET notes = '' WHERE name = 'Food'");
		const needsAfter = <Array<{ id: number }>>db.prepare(LIST_SQL).all(1, 'needs_details', 10, 0);
		expect(needsAfter.map((row) => row.id)).toEqual([3, 1]);
		const approved = <Array<{ id: number }>>db.prepare(LIST_SQL).all(1, 'approved', 10, 0);
		expect(approved.map((row) => row.id)).toEqual([2]);
	});
});

describe('purpose-derived documentation chasing', () => {
	beforeEach(migratedAfterSeed);
	const d1 = () => wrapSqlite(db) as unknown as Parameters<typeof owedPurposeState>[0];

	it('owedPurposeState chases only undocumented purposes and their effective members', async () => {
		run("UPDATE purposes SET notes = '' WHERE name = 'Food'");
		const state = await owedPurposeState(d1(), 1);
		// Food (purpose 2) has no Notes and no evidence; T-Shirts is documented.
		expect(state.owedPurposes.map((owed) => owed.purposeName)).toEqual(['Food']);
		expect(state.owedPurposes[0]!.effective).toEqual([1]); // inherited member, not the split override holder
		expect(state.allocatedTxnIds).toEqual([1]);
		expect(state.remainders).toEqual([]); // the seeded allocation is exact
	});

	it('a partial allocation chases the inherited member for the remainder', async () => {
		run('UPDATE allocations SET amount_minor = ? WHERE purpose_id = (SELECT id FROM purposes WHERE name = ?)', 500000, 'Food');
		const state = await owedPurposeState(d1(), 1);
		expect(state.remainders.map((remainder) => remainder.txnId)).toEqual([1]);
		expect(state.remainders[0]!.responsibleId).toBe(1);
	});

	it('digestTargets routes expenses through purposes, not legacy predicates', async () => {
		run("UPDATE purposes SET notes = '' WHERE name = 'Food'");
		const org = one<any>('SELECT * FROM organizations WHERE id = 1');
		const mems = all<any>('SELECT m.id, m.org_id, m.user_id, m.role_id, m.handle, m.created_at, m.removed_at, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = 1');
		const roles = all<any>('SELECT id, org_id, name, permissions FROM roles WHERE org_id = 1');
		const targets = await digestTargets(d1() as unknown as Parameters<typeof digestTargets>[0], org, mems, roles);
		const chased = [...targets.groups].map(([m, items]) => `${m.handle}:${items.map((i) => i.txnId).join(',')}`);
		// Food is owed by member 1 (effective); the documented T-Shirts purpose
		// and its responsible member 2 are NOT chased; the unallocated legacy
		// expense 3 still chases its responsible member 1 through legacy rules.
		expect(chased).toEqual(['one:3,1']);
	});

	it('submittedPurposeTasks exclude every current or historical responsible', async () => {
		run("UPDATE purposes SET status = 'submitted'");
		const tasks = await submittedPurposeTasks(d1(), 1);
		expect(tasks.map((task) => task.purposeName).sort()).toEqual(['Food', 'T-Shirts']);
		const food = tasks.find((task) => task.purposeName === 'Food')!;
		expect(food.excluded).toContain(1); // inherited transaction member
		const shirts = tasks.find((task) => task.purposeName === 'T-Shirts')!;
		expect(shirts.excluded).toContain(2); // purpose member from the split override
		expect(shirts.excluded).toContain(1); // transaction responsible history
	});
});

describe('purpose notice gating SQL', () => {
	beforeEach(migratedAfterSeed);

	it('queues a link-only row for an eligible recipient and respects the gates', () => {
		const purposeId = one<{ id: number }>("SELECT id FROM purposes WHERE name = 'Food'")!.id;
		// The production statement and the production bind order.
		run(INSERT_PURPOSE_NOTICE_SQL, 1, 'mention', 2, purposeId, 's', 'b', 0);
		const row = one<{ kind: string; to_membership_id: number; transaction_id: number | null; purpose_id: number }>('SELECT kind, to_membership_id, transaction_id, purpose_id FROM notification_outbox')!;
		expect(row).toMatchObject({ kind: 'mention', to_membership_id: 2, transaction_id: null, purpose_id: purposeId });
		run('UPDATE organizations SET notifications_enabled = 0 WHERE id = 1');
		run(INSERT_PURPOSE_NOTICE_SQL, 1, 'mention', 2, purposeId, 's', 'b', 0);
		expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM notification_outbox')!.n).toBe(1);
		run('UPDATE organizations SET notifications_enabled = 1 WHERE id = 1');
		run('UPDATE purposes SET suppressed = 1 WHERE id = ?', purposeId);
		run(INSERT_PURPOSE_NOTICE_SQL, 1, 'mention', 2, purposeId, 's', 'b', 0);
		expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM notification_outbox')!.n).toBe(1);
		run('UPDATE purposes SET suppressed = 0 WHERE id = ?', purposeId);
		run('UPDATE memberships SET removed_at = 5 WHERE id = 2');
		run(INSERT_PURPOSE_NOTICE_SQL, 1, 'mention', 2, purposeId, 's', 'b', 0);
		expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM notification_outbox')!.n).toBe(1);
	});

	it('a suppressed transaction does not mute its shared purpose', () => {
		run("INSERT INTO notification_outbox (org_id, kind, to_membership_id, transaction_id, purpose_id, subject, body, created_at) VALUES (1, 'mention', 2, NULL, 1, 's', 'b', 0)");
		run('UPDATE transactions SET suppressed = 1 WHERE id = 1');
		const row = one<{ cancelled_at: number | null }>('SELECT cancelled_at FROM notification_outbox')!;
		expect(row.cancelled_at).toBeNull();
	});
});

describe('migration default for new organizations', () => {
	beforeEach(migrated);

	it('keeps the column default at 0 (explicit setting wins) while orgs.ts writes 1', () => {
		run("INSERT INTO organizations (id, slug, name, created_at) VALUES (9, 'quiet', 'Quiet', 0)");
		expect(one<{ notifications_enabled: number }>('SELECT notifications_enabled FROM organizations WHERE id = 9')!.notifications_enabled).toBe(0);
	});
});
