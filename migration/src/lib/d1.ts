// Structural types for the Cloudflare bindings declared in
// migration/wrangler.toml. Deliberately minimal: only the surface this slice
// calls, so a binding change shows up as a type error rather than as silent
// `unknown` access. Runtime validation still happens in db.ts.

export interface D1Meta {
	changes?: number;
	[key: string]: unknown;
}

export interface D1Result<T> {
	results: T[];
	success?: boolean;
	meta?: D1Meta;
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
	/** D1 batch: statements run sequentially in one implicit transaction; any
	 * failure aborts the whole batch. */
	batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface R2Body {
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Object {
	/** Workers' R2ObjectBody exposes arrayBuffer()/text()/json() on the object
	 * itself; `.body` is a stream. */
	arrayBuffer?(): Promise<ArrayBuffer>;
	text?(): Promise<string>;
	body?: R2Body;
	[key: string]: unknown;
}

/** Reads a stored object as bytes, whichever of the two shapes the runtime
 * provides (Workers' R2ObjectBody, or a stubbed `body` stream). */
export async function r2Bytes(object: R2Object): Promise<ArrayBuffer> {
	if (typeof object.arrayBuffer === 'function') return object.arrayBuffer();
	if (object.body) return object.body.arrayBuffer();
	throw new Error('R2 object body is unavailable');
}

/** Private-document bucket. Only put/get of whole small objects is used, so
 * the type stays minimal; a binding change must surface as a type error. */
export interface R2Bucket {
	put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>;
	get(key: string): Promise<R2Object | null>;
}

export interface ExecutionContextLike {
	waitUntil(promise: Promise<unknown>): void;
}

/** The `env` contract of wrangler.toml plus .dev.vars. */
export interface Bindings {
	DB: D1Database;
	DOCUMENTS: R2Bucket;
	SECRET_SESSION_KEY?: string;
	LOCAL_DEV?: string;
	GOOGLE_CLIENT_ID?: string;
	EMAIL_DELIVERY_ENABLED?: string;
}
