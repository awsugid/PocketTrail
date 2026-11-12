import type { Handle } from '@sveltejs/kit';

// Response hygiene applied to every response, mirroring `html()` in
// src/web/mod.rs: authenticated workspace pages are never cached by a shared
// cache, and must not be framed or MIME-sniffed.
//
// This hook deliberately does NOT authenticate or authorize. Each protected
// load and action calls the guards in $lib/server/auth itself.
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'private, no-store');
	}
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'same-origin');
	response.headers.set('x-frame-options', 'DENY');
	return response;
};
