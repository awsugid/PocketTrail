// Keep Worker runtime types scoped: global Worker Element conflicts with DOM Element.
declare module 'cloudflare:workers' {
	export const env: import('./lib/d1').Bindings;
	export function waitUntil(promise: Promise<unknown>): void;
}

// Minimal structural surface consumed by the SMTP transport, matching
// https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
declare module 'cloudflare:sockets' {
	export const connect: import('./lib/server/smtp').SmtpConnect;
}
