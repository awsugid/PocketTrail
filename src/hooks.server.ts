import { sequence } from '@sveltejs/kit/hooks';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

import { auditBegin, auditFinish, type Attempt } from '$lib/server/audit';
import { classify, isRealActor } from '$lib/server/audit_rules';
import { appConfig, sessionOf } from '$lib/server/auth';
import { bindings } from '$lib/server/auth';

// Response hygiene applied to every response, mirroring `html()` in
// src/web/mod.rs: authenticated workspace pages are never cached by a shared
// cache, and must not be framed or MIME-sniffed.
//
// This hook deliberately does NOT authenticate or authorize. Each protected
// load and action calls the guards in $lib/server/auth itself.
const hygiene: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'private, no-store');
	}
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'same-origin');
	response.headers.set('x-frame-options', 'DENY');
	return response;
};

// The request-level audit trail mirrors src/web/audit.rs: mutations and
// private downloads write an attempt row up front; watched private page views
// record explicit denials only; successes on instrumented mutations are
// recorded by their own transactional batch, never twice. Audit failures are
// fail-open for page serving: the trail must never take the app down.
const auditTrail: Handle = async ({ event, resolve }) => {
	const post = event.request.method === 'POST';
	let attempt: Attempt | null = null;
	let db: import('$lib/d1').D1Database | null = null;
	try {
		const config = appConfig(event.platform);
		if (config.secret) {
			db = bindings(event.platform).DB;
			const session = await sessionOf(event, config);
			const actor = session && isRealActor(session.uid) ? session.uid : null;
			attempt = await auditBegin(db, event.url.pathname, post, actor);
		}
	} catch {
		// Audit unavailability must never take the application down with it.
	}
	const response = await resolve(event);
	if (attempt && db) {
		const outcome = classify(attempt.target, attempt.action, attempt.intent, attempt.actor !== null, response.status);
		if (outcome) {
			try {
				await auditFinish(db, attempt, outcome);
			} catch {
				// Same fail-open posture as begin.
			}
		}
	}
	return response;
};

const oauthTransport: Handle = async ({event,resolve}) => {
 const formType=/^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)(;|$)/i.test(event.request.headers.get('content-type') ?? '');
 if(event.url.pathname!=='/oauth/token' && ['POST','PUT','PATCH','DELETE'].includes(event.request.method) && formType && event.request.headers.get('origin')!==event.url.origin)throw error(403,'Cross-site form submissions are forbidden.');
 // OAuth token exchange is a non-cookie public-client endpoint. SvelteKit's
 // browser-form CSRF gate does not apply; exact PKCE/client/resource validation does.
 if(event.url.pathname==='/oauth/token' && event.request.method==='POST') {
  const {POST}=await import('./routes/oauth/token/+server');
  return POST(event);
 }
 return resolve(event);
};
export const handle = sequence(auditTrail, hygiene, oauthTransport);
