// SMTP grammar over a small socket seam. The production adapter is
// cloudflare:sockets; scripted sockets exercise the same session in tests.
import { Buffer } from 'node:buffer';
import { validEmail } from './profile';

export interface SmtpEnv {
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USERNAME?: string;
	SMTP_PASSWORD?: string;
	SMTP_FROM?: string;
}

export interface SmtpConfig {
	host: string;
	port: number;
	username: string;
	password: string;
	from: string;
}

/** Only these fixed messages may reach D1/UI. Never expose socket errors or
 * server text: either can echo credentials or the single-use link. */
export class SmtpError extends Error {}

export function smtpConfig(env: SmtpEnv): SmtpConfig {
	const host = (env.SMTP_HOST ?? '').trim();
	if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new SmtpError('SMTP_HOST is missing or invalid.');
	const portText = (env.SMTP_PORT ?? '').trim();
	const port = Number(portText);
	if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
		throw new SmtpError('SMTP_PORT must be between 1 and 65535.');
	}
	if (port === 25) throw new SmtpError('Cloudflare Workers blocks SMTP port 25; use port 465 or 587.');
	const username = env.SMTP_USERNAME ?? '';
	const password = env.SMTP_PASSWORD ?? '';
	const from = (env.SMTP_FROM ?? '').trim();
	if (!username || username.length > 1024 || /[\x00-\x1f\x7f]/.test(username)) {
		throw new SmtpError('SMTP_USERNAME is missing or invalid.');
	}
	if (!password || password.length > 4096 || password.includes('\0')) {
		throw new SmtpError('SMTP_PASSWORD is missing or invalid.');
	}
	if (!validEmail(from)) throw new SmtpError('SMTP_FROM is missing or invalid.');
	return { host, port, username, password, from };
}

export interface SmtpSocket {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	opened: Promise<unknown>;
	closed: Promise<void>;
	startTls(): SmtpSocket;
	close(): Promise<void>;
}

export type SmtpConnect = (
	address: { hostname: string; port: number },
	options: { secureTransport: 'on' | 'starttls' }
) => SmtpSocket;

export interface SmtpMessage {
	to: string;
	subject: string;
	body: string;
}

/** Base64 MIME avoids 8BITMIME/SMTPUTF8 requirements and SMTP dot injection.
 * Encoded words are split on Unicode code points, under RFC 2047's 75 chars. */
export function composeMessage(from: string, message: SmtpMessage): string {
	if (!validEmail(from) || !validEmail(message.to)) throw new SmtpError('Invalid email address.');
	if (!message.subject.trim() || /[\x00-\x1f\x7f]/.test(message.subject)) {
		throw new SmtpError('Invalid email subject.');
	}
	const words: string[] = [];
	let chunk = '';
	for (const ch of message.subject) {
		if (Buffer.byteLength(chunk + ch) > 30) {
			words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
			chunk = '';
		}
		chunk += ch;
	}
	if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
	const body = Buffer.from(message.body.replace(/\r\n|\r|\n/g, '\r\n')).toString('base64');
	return [
		`From: ${from}`,
		`To: ${message.to}`,
		`Subject: ${words.join('\r\n ')}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: base64',
		'',
		body.match(/.{1,76}/g)?.join('\r\n') ?? ''
	].join('\r\n') + '\r\n';
}

/** Whole-session deadline, bounded replies, validated platform TLS, no downgrade.
 * A final DATA 250 means accepted by SMTP, not guaranteed inbox delivery. */
export async function sendSmtp(
	config: SmtpConfig,
	message: SmtpMessage,
	connect: SmtpConnect,
	timeoutMs = 30_000
): Promise<void> {
	const payload = composeMessage(config.from, message);
	const deadline = Date.now() + timeoutMs;
	let socket: SmtpSocket | undefined;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
	let buffer = '';
	const decoder = new TextDecoder();
	async function bounded<T>(operation: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				operation,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new SmtpError('SMTP operation timed out.')), Math.max(0, deadline - Date.now()));
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	function attach(next: SmtpSocket) {
		socket = next;
		// Workers reports failures on both opened and closed; handle both.
		void socket.closed.catch(() => {});
		reader = socket.readable.getReader();
		writer = socket.writable.getWriter();
	}
	async function write(text: string) {
		await bounded(writer!.write(new TextEncoder().encode(text)));
	}
	async function reply(expected: number, stage: string): Promise<string[]> {
		const lines: string[] = [];
		let size = 0;
		for (;;) {
			const end = buffer.indexOf('\r\n');
			if (end < 0) {
				const part = await bounded(reader!.read());
				if (part.done) throw new SmtpError('SMTP connection closed unexpectedly.');
				size += part.value.byteLength;
				if (size > 65536) throw new SmtpError('SMTP reply too large.');
				buffer += decoder.decode(part.value, { stream: true });
				continue;
			}
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const match = /^(\d{3})([ -])(.*)$/.exec(line);
			if (!match || lines.length >= 1000) throw new SmtpError('Invalid SMTP reply.');
			const code = Number(match[1]);
			if (code !== expected) throw new SmtpError(`${stage}: unexpected SMTP reply ${code}.`);
			lines.push(match[3]!);
			if (match[2] === ' ') return lines;
		}
	}
	async function command(text: string, code: number, stage: string) {
		await write(`${text}\r\n`);
		return reply(code, stage);
	}
	try {
		attach(connect({ hostname: config.host, port: config.port }, { secureTransport: config.port === 465 ? 'on' : 'starttls' }));
		await bounded(socket!.opened);
		await reply(220, 'Greeting');
		const domain = config.from.split('@')[1]!;
		let caps = await command(`EHLO ${domain}`, 250, 'EHLO');
		if (config.port !== 465) {
			if (!caps.some((line) => /^STARTTLS(?:\s|$)/i.test(line))) {
				throw new SmtpError('SMTP server does not advertise STARTTLS; refusing plaintext delivery.');
			}
			await command('STARTTLS', 220, 'STARTTLS');
			if (buffer !== '') throw new SmtpError('Unexpected data before SMTP TLS upgrade.');
			reader!.releaseLock();
			writer!.releaseLock();
			attach(socket!.startTls());
			await bounded(socket!.opened);
			caps = await command(`EHLO ${domain}`, 250, 'EHLO');
		}
		const mechanisms = caps.filter((line) => /^AUTH[ =]/i.test(line))
			.flatMap((line) => line.slice(5).toUpperCase().split(/\s+/));
		if (mechanisms.includes('PLAIN')) {
			const auth = Buffer.from(`\0${config.username}\0${config.password}`).toString('base64');
			await command(`AUTH PLAIN ${auth}`, 235, 'Authentication');
		} else if (mechanisms.includes('LOGIN')) {
			await command('AUTH LOGIN', 334, 'Authentication');
			await command(Buffer.from(config.username).toString('base64'), 334, 'Authentication');
			await command(Buffer.from(config.password).toString('base64'), 235, 'Authentication');
		} else {
			throw new SmtpError('SMTP server offers no supported authentication mechanism.');
		}
		await command(`MAIL FROM:<${config.from}>`, 250, 'Sender');
		await command(`RCPT TO:<${message.to}>`, 250, 'Recipient');
		await command('DATA', 354, 'Message');
		await write(`${payload}.\r\n`);
		await reply(250, 'Message acceptance');
		// Do not let a failed QUIT or close turn an accepted email into failure.
	} catch (cause) {
		throw cause instanceof SmtpError ? cause : new SmtpError('SMTP connection or TLS operation failed.');
	} finally {
		// Close even after a timed-out read/write. Never wait on an unbounded QUIT.
		try {
			if (socket) void socket.close().catch(() => {});
		} catch {
			// Synchronous cleanup failures are best-effort too.
		}
	}
}
