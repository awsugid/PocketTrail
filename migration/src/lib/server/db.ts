// D1 access helpers. Every statement is prepared with bound parameters: no
// value is ever interpolated into SQL.

import type { D1Database } from '$lib/d1';

export async function qAll<T>(
	db: D1Database,
	sql: string,
	params: readonly unknown[] = []
): Promise<T[]> {
	const statement = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
	const { results } = await statement.all<T>();
	return results;
}

export async function qOne<T>(
	db: D1Database,
	sql: string,
	params: readonly unknown[] = []
): Promise<T | null> {
	const statement = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
	return (await statement.first<T>()) ?? null;
}

/** Epoch seconds, from the runtime clock. */
export function nowSecs(): number {
	return Math.floor(Date.now() / 1000);
}
