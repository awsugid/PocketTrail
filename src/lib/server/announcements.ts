import type { D1Database } from '#lib/d1.ts';
import { nowMs, qOne } from './db';

export async function showMcpBanner(db: D1Database, userId: string, canDocument: boolean) {
	return canDocument && !(await qOne(db,
		"SELECT 1 FROM user_dismissals WHERE user_id=?1 AND key='mcp_announcement'", [userId]));
}

export async function dismissMcpBanner(db: D1Database, userId: string) {
	await db.prepare("INSERT OR IGNORE INTO user_dismissals (user_id,key,dismissed_at) VALUES (?1,'mcp_announcement',?2)")
		.bind(userId, nowMs()).run();
}
