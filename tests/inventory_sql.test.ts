import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from './helpers/sqlite';
import { inventoryItems, inventoryLocations, itemMovements, stockUpdateStatements } from '#lib/server/inventory.ts';

let database: ReturnType<typeof testDatabase>;
beforeEach(() => {
	database = testDatabase();
	database.sqlite.exec(`
		INSERT INTO users(id,email,name,created_at) VALUES('actor','actor@example.test','Actor',0);
		INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0);
		INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Inventory Maintainer','["UpdateStock"]');
		INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'actor',1,'actor',0);
		INSERT INTO inventory_items(id,org_id,name,variant) VALUES(1,1,'Item',''),(2,2,'Foreign','');
		INSERT INTO inventory_locations(id,org_id,name) VALUES(1,1,'Storage'),(2,2,'Foreign storage');
	`);
});
afterEach(() => database.sqlite.close());
const update = (itemId = 1, locationId = 1, delta = 1) => database.db.batch(stockUpdateStatements(database.db, {
	item_id: itemId, location_id: locationId, delta, reason: 'Synthetic stock change',
	actor_membership_id: 1, actor_user_id: 'actor', org_id: 1
}));

describe('inventory SQL guards', () => {
	it('rejects stock writes to archived items or locations even after a stale pre-check', async () => {
		database.sqlite.exec("UPDATE inventory_items SET archived_at=1 WHERE id=1");
		expect((await update())[1]?.meta?.changes).toBe(0);
		database.sqlite.exec("UPDATE inventory_items SET archived_at=NULL WHERE id=1; UPDATE inventory_locations SET archived_at=1 WHERE id=1");
		expect((await update())[1]?.meta?.changes).toBe(0);
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM stock_movements').get()).toEqual({ n: 0 });
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM inventory_levels').get()).toEqual({ n: 0 });
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get()).toEqual({ n: 0 });
	});

	it('does not create foreign-org levels, movements or audit events', async () => {
		expect((await update(2, 1))[1]?.meta?.changes).toBe(0);
		expect((await update(1, 2))[1]?.meta?.changes).toBe(0);
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM inventory_levels').get()).toEqual({ n: 0 });
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM stock_movements').get()).toEqual({ n: 0 });
		expect(database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get()).toEqual({ n: 0 });
	});

	it('preserves independent history identities after archiving zero stock', async () => {
		expect((await update(1, 1, 1))[1]?.meta?.changes).toBe(1);
		expect((await update(1, 1, -1))[1]?.meta?.changes).toBe(1);
		database.sqlite.exec('UPDATE inventory_items SET archived_at=1 WHERE id=1; UPDATE inventory_locations SET archived_at=1 WHERE id=1');
		const history = await itemMovements(database.db, 1, 1);
		expect(history).toHaveLength(2);
		expect(new Set(history.map((movement) => movement.id)).size).toBe(2);
		expect(history.map((movement) => movement.delta)).toEqual([-1, 1]);
		expect(await inventoryItems(database.db, 1)).toEqual([]);
		expect(await inventoryLocations(database.db, 1)).toEqual([]);
		expect(await inventoryItems(database.db, 1, true)).toHaveLength(1);
		expect(await inventoryLocations(database.db, 1, true)).toHaveLength(1);
	});
});
