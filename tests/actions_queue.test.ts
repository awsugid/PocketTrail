import { describe, expect, it, vi } from 'vitest';
import { testDatabase } from './helpers/sqlite';

const state = vi.hoisted(() => ({ ctx: null as any }));
vi.mock('#lib/server/auth.ts', () => ({ requireMember: async () => state.ctx, shellContext: async () => ({}) }));
import { load } from '../src/routes/org/[slug]/actions/+page.server';

describe('actions queue', () => {
	it('shows only income without member notes', async () => {
		const { db } = testDatabase();
		for (const sql of [
			"INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',0)",
			"INSERT INTO organizations (id,slug,name,created_at) VALUES (1,'demo','Demo',0)",
			"INSERT INTO roles (id,org_id,name,permissions) VALUES (1,1,'Role','[]')",
			"INSERT INTO memberships (id,org_id,user_id,role_id,handle,created_at) VALUES (1,1,'u',1,'u',0)",
			"INSERT INTO pockets (id,org_id,name,opening_balance_minor,owner_membership_id) VALUES (1,1,'Main',0,1)",
			"INSERT INTO transactions (id,org_id,pocket_id,bank_id,txn_date,amount_minor,explanation,status,created_at,updated_at) VALUES (1,1,1,'A','2026-01-01',100,'Explained','pending',0,0),(2,1,1,'B','2026-01-02',100,'   ','pending',0,0)"
		]) await db.prepare(sql).run();
		state.ctx = { db, org: { id: 1, income_explanation_role_id: null }, user: { id: 'u' }, memberRows: [{ id: 1, user_id: 'u', role_id: 1, removed_at: null }], can: () => false };
		const result = await load({ params: { slug: 'demo' } } as any);
		if (!result || !('explain' in result)) throw new Error('Actions load returned no tasks');
				expect(result.explain.map((task: { id: number }) => task.id)).toEqual([2]);
	});
});
