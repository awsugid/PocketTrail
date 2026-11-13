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

/** Execute a statement without reading results. */
export async function exec(
	db: D1Database,
	sql: string,
	params: readonly unknown[] = []
): Promise<void> {
	const statement = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
	await statement.run();
}

/** Epoch milliseconds, from the runtime clock. */
export function nowMs(): number {
	return Date.now();
}

/** Epoch seconds, from the runtime clock. */
export function nowSecs(): number {
	return Math.floor(Date.now() / 1000);
}
