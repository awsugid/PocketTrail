import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { testDatabase } from './helpers/sqlite';
import { saveTag, type TxnCtx } from '../src/lib/server/txns';
import { ledgerPage } from '../src/lib/server/ledger';

function world() {
	const { db, sqlite } = testDatabase();
	sqlite.exec(`INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',0);
		INSERT INTO organizations (id,slug,name,created_at) VALUES (1,'one','One',0),(2,'two','Two',0);
		INSERT INTO roles (id,org_id,name,permissions) VALUES (1,1,'Admin','[]');
		INSERT INTO memberships (id,org_id,user_id,role_id,handle,created_at) VALUES (1,1,'u',1,'user',0);
		INSERT INTO pockets (id,org_id,name,opening_balance_minor,owner_membership_id) VALUES (1,1,'Main',0,1);
		INSERT INTO transactions (id,org_id,pocket_id,bank_id,txn_date,amount_minor,status,created_at,updated_at) VALUES (1,1,1,'a','2026-01-01',-100,'pending',0,0),(2,1,1,'b','2026-01-02',-200,'pending',0,0);
		INSERT INTO tags (org_id,name) VALUES (2,'Other');`);
	const ctx = { db, org: { id: 1, slug: 'one' }, user: { id: 'u' }, memberRows: [{ id: 1, org_id: 1, user_id: 'u', removed_at: null }], can: () => true } as unknown as TxnCtx;
	return { db, sqlite, ctx };
}
function form(revision: number, key: string, value: string) {
	const result = new FormData(); result.set('revision', String(revision)); result.set(key, value); return result;
}

describe('transaction tags', () => {
	it('creates reusable tags, filters, removes and records audit without changing approval', async () => {
		const { db, sqlite, ctx } = world();
		expect(isRedirect(await saveTag(ctx, 1, form(0, 'tag', ' Monthly meeting ')).catch((e: unknown) => e))).toBe(true);
		expect(isRedirect(await saveTag(ctx, 2, form(0, 'tag', 'monthly MEETING')).catch((e: unknown) => e))).toBe(true);
		expect(sqlite.prepare('SELECT count(*) n FROM tags WHERE org_id=1').get()?.n).toBe(1);
		const tag = sqlite.prepare('SELECT id FROM tags WHERE org_id=1').get()!.id as number;
		expect((await ledgerPage(db, 1, null, 1, tag)).entries).toHaveLength(2);
		expect(isRedirect(await saveTag(ctx, 1, form(1, 'remove_tag', String(tag))).catch((e: unknown) => e))).toBe(true);
		expect((await ledgerPage(db, 1, null, 1, tag)).entries.map((entry) => entry.id)).toEqual([2]);
		expect(sqlite.prepare("SELECT count(*) n FROM transaction_audit WHERE action='tags_updated'").get()?.n).toBe(3);
		expect(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get()?.status).toBe('pending');
	});
	it('rejects unauthorized, stale, invalid, and cross-organization changes', async () => {
		const { sqlite, ctx } = world();
		const denied = { ...ctx, can: () => false };
		for (const [actor, data, status] of [[denied, form(0, 'tag', 'Test'), 403], [ctx, form(2, 'tag', 'Test'), 409], [ctx, form(0, 'tag', ' '.repeat(3)), 400], [ctx, form(0, 'remove_tag', '1'), 400]] as const) {
			const result = await saveTag(actor, 1, data).catch((e: unknown) => e);
			expect(isHttpError(result) && result.status).toBe(status);
		}
		expect(sqlite.prepare('SELECT count(*) n FROM transaction_tags').get()?.n).toBe(0);
		expect(sqlite.prepare('SELECT count(*) n FROM transaction_audit').get()?.n).toBe(0);
	});
});
