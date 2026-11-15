import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { permissionBundle } from '../src/lib/server/settings';

describe('inventory-only roles', () => {
	it('accepts UpdateStock alone but still requires ledger access for finance permissions', () => {
		const form = new FormData();
		form.append('perm', 'UpdateStock');
		expect(permissionBundle(form)).toBe('["UpdateStock"]');
		form.append('perm', 'ManageMembers');
		expect(() => permissionBundle(form)).toThrow();
		form.append('perm', 'ViewTransactions');
		expect(JSON.parse(permissionBundle(form))).toEqual(['ManageMembers', 'UpdateStock', 'ViewTransactions']);
	});

	it('adds the role to existing organizations without modifying a customized namesake', () => {
		const db = new DatabaseSync(':memory:');
		try {
			const dir = new URL('../migrations/', import.meta.url);
			for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql') && name < '0011').sort()) {
				db.exec(readFileSync(new URL(file, dir), 'utf8'));
			}
			db.exec(`
				INSERT INTO organizations(id,slug,name,created_at) VALUES
					(1,'first','First',0),(2,'second','Second',0);
				INSERT INTO roles(org_id,name,permissions)
					VALUES(2,'Inventory Maintainer','["ViewTransactions"]');
			`);
			const migration = readFileSync(join(dir.pathname, '0011_inventory_maintainer.sql'), 'utf8');
			db.exec(migration);
			db.exec(migration);
			const roles = db.prepare('SELECT org_id,permissions FROM roles ORDER BY org_id').all();
			expect(roles).toEqual([
				{ org_id: 1, permissions: '["UpdateStock"]' },
				{ org_id: 2, permissions: '["ViewTransactions"]' }
			]);
		} finally {
			db.close();
		}
	});
});
