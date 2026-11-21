import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { testDatabase } from './helpers/sqlite';
import { moveEvidence, downloadDocument, type TxnCtx } from '../src/lib/server/txns';

function world() {
	const { db } = testDatabase();
	const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...(args as never[])).run();
	run("INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','Uploader',0)");
	run("INSERT INTO organizations (id,slug,name,notifications_enabled,created_at) VALUES (1,'demo','Demo',1,0),(2,'other','Other',1,0)");
	run("INSERT INTO roles (id,org_id,name,permissions) VALUES (1,1,'Admin','[\"ViewTransactions\",\"DocumentTransactions\"]')");
	run("INSERT INTO memberships (id,org_id,user_id,role_id,handle,created_at) VALUES (1,1,'u',1,'u',0)");
	run("INSERT INTO pockets (id,org_id,name,opening_balance_minor,owner_membership_id) VALUES (1,1,'Main',0,1)");
	run("INSERT INTO transactions (id,org_id,pocket_id,txn_date,amount_minor,status,created_at,updated_at) VALUES (1,1,1,'2026-01-01',-100,'pending',0,0),(2,1,1,'2026-01-01',-100,'pending',0,0)");
	run("INSERT INTO purposes (id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES (1,1,'Food','expense',1,0,0)");
	run('INSERT INTO allocations (org_id,purpose_id,transaction_id,amount_minor,created_at) VALUES (1,1,1,100,0)');
	run("INSERT INTO documents (id,org_id,transaction_id,kind,r2_key,filename,content_type,size_bytes,uploaded_by_membership_id,created_at) VALUES (1,1,1,'evidence','key','receipt.pdf','application/pdf',4,1,0),(2,1,2,'evidence','key2','other.pdf','application/pdf',4,1,0)");
	const ctx = { db, org: { id: 1, slug: 'demo' }, user: { id: 'u' }, memberRows: [{ id: 1, user_id: 'u', name: 'Uploader', removed_at: null, invited: 0 }], can: () => true,
		env: { DOCUMENTS: { get: async () => ({ arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer }) } } } as unknown as TxnCtx;
	return { db, ctx };
}

describe('evidence', () => {
	it('moves only evidence owned by transaction to allocated purpose', async () => {
		const { db, ctx } = world();
		const form = new FormData(); form.set('revision', '0'); form.set('documentId', '1'); form.set('purposeId', '1');
		await expect(moveEvidence(ctx, 1, form)).rejects.toSatisfy(isRedirect);
		expect(await db.prepare('SELECT purpose_id,transaction_id FROM documents WHERE id=1').first()).toEqual({ purpose_id: 1, transaction_id: null });
		expect(await db.prepare('SELECT action FROM transaction_audit WHERE transaction_id=1').first()).toMatchObject({ action: 'evidence_attached' });
		form.set('documentId', '2'); form.set('revision', '1');
		await expect(moveEvidence(ctx, 1, form)).rejects.toSatisfy(isHttpError);
		expect(await db.prepare('SELECT purpose_id FROM documents WHERE id=2').first()).toEqual({ purpose_id: null });
	});
	it('serves allowlisted types inline and download on request', async () => {
		const { ctx } = world();
		const inline = await downloadDocument(ctx, 1);
		expect(inline.headers.get('content-type')).toBe('application/pdf');
		expect(inline.headers.get('content-disposition')).toContain('inline;');
		expect(inline.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
		expect((await downloadDocument(ctx, 1, true)).headers.get('content-disposition')).toContain('attachment;');
	});
});
