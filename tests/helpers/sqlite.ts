import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { D1Database, D1PreparedStatement, D1Result } from '$lib/d1';

/** Run real server statements against SQLite with D1's numbered bindings and
 * transactional batch semantics, without any Cloudflare or network dependency. */
export function testDatabase() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('PRAGMA foreign_keys=ON');
	const migrations = new URL('../../migrations/', import.meta.url);
	for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
	}
	function prepare(query: string, values: unknown[] = []): D1PreparedStatement {
		const args: SQLInputValue[] = [];
		const sql = query.replace(/\?(\d+)/g, (_, index: string) => {
			args.push(values[Number(index) - 1] as SQLInputValue);
			return '?';
		});
		return {
			bind: (...next) => prepare(query, next),
			async first<T>() { return (sqlite.prepare(sql).get(...args) ?? null) as T | null; },
			async all<T>() { return { results: sqlite.prepare(sql).all(...args) as T[] }; },
			async run<T>() {
				const result = sqlite.prepare(sql).run(...args);
				return { results: [] as T[], meta: { changes: Number(result.changes) } };
			}
		};
	}
	const db: D1Database = {
		prepare,
		async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
			sqlite.exec('BEGIN');
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run<T>());
				sqlite.exec('COMMIT');
				return results;
			} catch (cause) {
				sqlite.exec('ROLLBACK');
				throw cause;
			}
		}
	};
	return { db, sqlite };
}
