import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDatabase } from './helpers/sqlite';
import { dismissMcpBanner, showMcpBanner } from '#lib/server/announcements.ts';


it('persists per-user dismissal across contexts and gates visibility by permission', async () => {
	const { db, sqlite } = testDatabase();
	sqlite.exec(readFileSync(new URL('./fixtures/seed.sql', import.meta.url), 'utf8'));
	for (const allowed of [false, true]) {
		expect(await showMcpBanner(db, 'alice', allowed)).toBe(allowed);
	}
	await dismissMcpBanner(db, 'alice');
	await dismissMcpBanner(db, 'alice');
	for (const allowed of [false, true]) {
		expect(await showMcpBanner(db, 'alice', allowed)).toBe(false);
	}
	expect(await showMcpBanner(db, 'bob', true)).toBe(true);
	expect(sqlite.prepare('SELECT count(*) AS n FROM user_dismissals').get()?.n).toBe(1);
	expect(sqlite.prepare('SELECT dismissed_at FROM user_dismissals').get()?.dismissed_at).toBeGreaterThan(0);
	sqlite.close();
});
