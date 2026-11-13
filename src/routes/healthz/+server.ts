import { appConfig, bindings } from '$lib/server/auth';
import { hostIsLoopback } from '$lib/server/session';
import type { RequestHandler } from './$types';

/** Liveness. Binding names are reported only to a loopback host in local dev,
 * so a deployed instance exposes nothing but `ok` — the same restriction the
 * Rust healthz applies to its delivery flag. */
export const GET: RequestHandler = async ({ platform, url }) => {
	const config = appConfig(platform);
	let body = 'ok';
	if (config.localDev && hostIsLoopback(url.host)) {
		const env = bindings(platform);
		const present = [
			env.DB ? 'db' : null,
			env.DOCUMENTS ? 'documents' : null,
			config.secret ? 'session-key' : null
		].filter((name): name is string => name !== null);
		body += `; bindings=${present.join(',') || 'none'}`;
		body += `; dev_login=${config.localDev && config.secret !== null}`;
	}
	return new Response(body, {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' }
	});
};
