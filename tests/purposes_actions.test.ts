// saveAllocations and purpose-creation failure semantics against the real
// migrations via the SQLite D1 shim: no orphan purposes on any rejection
// path, atomic guarded name uniqueness, and the success write shape.
import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { testDatabase } from './helpers/sqlite';
import { saveAllocations } from '../src/lib/server/txns';
import { createPurposeRow, INSERT_PURPOSE_NOTICE_SQL } from '../src/lib/server/purposes';
import type { TxnCtx } from '../src/lib/server/txns';

type Db = ReturnType<typeof testDatabase>['db'];
const one = async <T>(db: Db, sql: string): Promise<T | undefined> => ((await db.prepare(sql).first<T>()) ?? undefined);

function world() {
	const { db } = testDatabase();
	const run = (sql: string, ...params: unknown[]) => {
		db.prepare(sql).bind(...(params as never[])).run();
	};
	run("INSERT INTO users (id, email, name, created_at) VALUES ('u1','one@example.test','One',0), ('u2','two@example.test','Two',0)");
	run("INSERT INTO organizations (id, slug, name, notifications_enabled, created_at) VALUES (1,'demo','Demo',1,0)");
	run(`INSERT INTO roles (id, org_id, name, permissions) VALUES
		(10,1,'Admin','["ViewTransactions","CommentTransactions","DocumentTransactions","ApproveTransactions"]')`);
	run("INSERT INTO memberships (id, org_id, user_id, role_id, handle, created_at) VALUES (1,1,'u1',10,'one',0), (2,1,'u2',10,'two',0)");
	run("INSERT INTO pockets (id, org_id, name, opening_balance_minor, owner_membership_id) VALUES (1,1,'Main',0,1)");
	run(`INSERT INTO transactions (id, org_id, pocket_id, bank_id, txn_date, amount_minor, responsible_membership_id, status, created_at, updated_at)
	     VALUES (7, 1, 1, 'B7', '2026-01-01', -12000000, 1, 'pending', 0, 0)`);
	const ctx = {
		config: {},
		session: {},
		user: { id: 'u1' },
		db,
		env: {},
		org: { id: 1, slug: 'demo', name: 'Demo', notifications_enabled: 1, notification_cutoff_date: null, income_explanation_role_id: null },
		memberRows: [
			{ id: 1, org_id: 1, user_id: 'u1', role_id: 10, handle: 'one', created_at: 0, removed_at: null, invited: 0, name: 'One', email: 'one@example.test' },
			{ id: 2, org_id: 1, user_id: 'u2', role_id: 10, handle: 'two', created_at: 0, removed_at: null, invited: 0, name: 'Two', email: 'two@example.test' }
		],
		roleRows: [{ id: 10, org_id: 1, name: 'Admin', permissions: '["ViewTransactions"]' }],
		can: () => true,
		deliverMail: async () => false
	} as unknown as TxnCtx;
	return { db, ctx };
}

const allocationsForm = (overrides: Record<string, string> = {}) => {
	const form = new FormData();
	form.set('csrf_token', 'x');
	form.set('revision', '0');
	form.set('responsible_member_id', '1');
	form.set('alloc_purpose[]', 'DEMO: hosting');
	form.set('alloc_amount[]', '120000');
	form.set('alloc_member[]', '');
	for (const [key, value] of Object.entries(overrides)) form.set(key, value);
	return form;
};

describe('saveAllocations failure paths leave no orphan purposes', () => {
	it('a missing justification rejects before any purpose is created', async () => {
		const { db, ctx } = world();
		const thrown = await saveAllocations(ctx, 7, allocationsForm()).catch((cause: unknown) => cause);
		expect(isHttpError(thrown) && thrown.status === 400).toBe(true);
		expect((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM purposes WHERE name = 'DEMO: hosting'"))!.n).toBe(0);
		expect((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM allocations'))!.n).toBe(0);
	});

	it('a concurrent name race rejects and keeps exactly one purpose', async () => {
		const { db, ctx } = world();
		const first = await createPurposeRow(db, 1, 'DEMO: hosting', 'expense', 1);
		expect(first).not.toBeNull();
		// The guarded INSERT rejects the same name regardless of case.
		expect(await createPurposeRow(db, 1, 'demo: HOSTING', 'expense', 1)).toBeNull();
		const thrown = await saveAllocations(ctx, 7, allocationsForm()).catch((cause: unknown) => cause);
		expect(isHttpError(thrown) && thrown.status === 400).toBe(true);
		expect((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM purposes WHERE lower(name) = 'demo: hosting'"))!.n).toBe(1);
		expect((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM allocations'))!.n).toBe(0);
	});

	it('a successful save creates, allocates, and audits atomically', async () => {
		const { db, ctx } = world();
		const thrown = await saveAllocations(ctx, 7, allocationsForm({ justification: 'DEMO: initial allocation' })).catch(
			(cause: unknown) => cause
		);
		expect(isRedirect(thrown) && thrown.status === 303).toBe(true);
		expect((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM purposes WHERE name = 'DEMO: hosting'"))!.n).toBe(1);
		const allocation = (await one<{ amount_minor: number; purpose_name: string }>(
			db,
			'SELECT a.amount_minor, p.name AS purpose_name FROM allocations a JOIN purposes p ON p.id = a.purpose_id'
		))!;
		expect(allocation.amount_minor).toBe(12_000_000);
		expect(allocation.purpose_name).toBe('DEMO: hosting');
		expect((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM transaction_audit WHERE action = 'allocations_updated'"))!.n).toBe(1);
	});
});

describe('quick purpose documentation', () => {
	it('creates a full allocation and notes in one save', async () => {
		const { db, ctx } = world();
		const form = allocationsForm({ justification: 'Initial allocation', quick_purpose: 'Hosting', quick_notes: 'June meetup', quick_invoice: 'https://example.test/invoice' });
		form.delete('alloc_purpose[]'); form.delete('alloc_amount[]'); form.delete('alloc_member[]');
		const result = await saveAllocations(ctx, 7, form).catch((cause: unknown) => cause);
		expect(isRedirect(result)).toBe(true);
		const row = await one<{ notes: string; amount_minor: number }>(db, 'SELECT p.notes, a.amount_minor FROM purposes p JOIN allocations a ON a.purpose_id=p.id');
		expect(row).toEqual({ notes: 'June meetup\n\nInvoice URL: https://example.test/invoice', amount_minor: 12000000 });
		expect((await one<{ n: number }>(db, "SELECT count(*) AS n FROM purpose_audit WHERE action='notes_updated'"))!.n).toBe(1);
	});

	it('rejects notes without a name or an unsafe URL before writing', async () => {
		const { db, ctx } = world();
		const invalidFields: Record<string, string>[] = [{ quick_notes: 'Description' }, { quick_purpose: 'Hosting', quick_invoice: 'javascript:alert(1)' }];
				for (const fields of invalidFields) {
			const form = allocationsForm({ justification: 'Initial allocation', ...fields });
			form.delete('alloc_purpose[]'); form.delete('alloc_amount[]'); form.delete('alloc_member[]');
			const result = await saveAllocations(ctx, 7, form).catch((cause: unknown) => cause);
			expect(isHttpError(result) && result.status === 400).toBe(true);
		}
		expect((await one<{ n: number }>(db, 'SELECT count(*) AS n FROM purposes'))!.n).toBe(0);
	});
});

describe('purpose name uniqueness', () => {
	it('keeps legacy duplicate labels from the migration while guarding creation', async () => {
		const { db } = world();
		db.prepare('INSERT INTO purposes (org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES (1,?1,?2,1,0,0)').bind('Food', 'expense').run();
		db.prepare('INSERT INTO purposes (org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES (1,?1,?2,1,0,0)').bind('Food', 'expense').run();
		// Migrated duplicates survive; new creation through the app is unique
		// per kind, case-insensitively, even concurrently (guarded INSERT).
		expect(await createPurposeRow(db, 1, 'FOOD', 'expense', 1)).toBeNull();
		expect(await createPurposeRow(db, 1, 'Food', 'income', 1)).not.toBeNull();
	});
});

describe('purpose notice SQL binds every column correctly', () => {
	it('inserts the recipient, kind, and purpose link with transaction NULL', async () => {
		const { db } = world();
		db.prepare('INSERT INTO purposes (org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES (1,?1,?2,1,0,0)').bind('Food', 'expense').run();
		const purposeId = (await one<{ id: number }>(db, "SELECT id FROM purposes WHERE name = 'Food'"))!.id;
		// The production statement, executed with the production bind order.
		db.prepare(INSERT_PURPOSE_NOTICE_SQL)
			.bind(1, 'mention', 2, purposeId, 'New discussion message — Demo', 'A purpose discussion…\n/org/demo/purposes/1', 123)
			.run();
		const row = (await one<{
			org_id: number;
			kind: string;
			to_membership_id: number;
			transaction_id: number | null;
			purpose_id: number;
			subject: string;
		}>(db, 'SELECT org_id, kind, to_membership_id, transaction_id, purpose_id, subject FROM notification_outbox'))!;
		expect(row).toMatchObject({
			org_id: 1,
			kind: 'mention',
			to_membership_id: 2,
			transaction_id: null,
			purpose_id: purposeId,
			subject: 'New discussion message — Demo'
		});
		// Gates: purpose suppression blocks the insert entirely.
		db.prepare('UPDATE purposes SET suppressed = 1 WHERE id = ?1').bind(purposeId).run();
		db.prepare(INSERT_PURPOSE_NOTICE_SQL).bind(1, 'purpose', 2, purposeId, 's', 'b', 124).run();
		expect((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM notification_outbox'))!.n).toBe(1);
	});
});
