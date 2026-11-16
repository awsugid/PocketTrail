// Minimal structural surface consumed by the SMTP transport, matching
// https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
declare module 'cloudflare:sockets' {
	export const connect: import('./lib/server/smtp').SmtpConnect;
}
