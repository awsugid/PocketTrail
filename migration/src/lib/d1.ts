// Structural types for the Cloudflare bindings declared in
// migration/wrangler.toml. Deliberately minimal: only the surface this slice
// calls, so a binding change shows up as a type error rather than as silent
// `unknown` access. Runtime validation still happens in db.ts.

export interface D1Result<T> {
	results: T[];
	success?: boolean;
	meta?: unknown;
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

/** Only `get` is declared: this slice proves the binding is wired, and private
 * evidence retrieval is ported in a later slice. */
export interface R2Bucket {
	get(key: string): Promise<unknown>;
}

export interface ExecutionContextLike {
	waitUntil(promise: Promise<unknown>): void;
}

/** The `env` contract of migration/wrangler.toml plus .dev.vars. */
export interface Bindings {
	DB: D1Database;
	DOCUMENTS: R2Bucket;
	SECRET_SESSION_KEY?: string;
	LOCAL_DEV?: string;
	GOOGLE_CLIENT_ID?: string;
}
