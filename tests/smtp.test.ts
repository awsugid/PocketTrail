import { describe, expect, it } from 'vitest';
import { composeMessage, sendSmtp, smtpConfig, type SmtpConnect, type SmtpSocket } from '$lib/server/smtp';

const env = {
	SMTP_HOST: 'mail.example.test', SMTP_PORT: '587',
	SMTP_USERNAME: 'sender@example.test', SMTP_PASSWORD: 'synthetic-password',
	SMTP_FROM: 'sender@example.test'
};
const message = { to: 'guest@example.test', subject: 'Join Synthetic — 東京', body: 'Hello\n.\n.private link\n' };

/** Scripted stream sockets: no network, same interface as cloudflare:sockets. */
function sockets(replies: string[][], options: { hang?: boolean; closeFails?: boolean; writeFails?: boolean } = {}) {
	const writes: string[] = [];
	const connects: unknown[] = [];
	let upgrades = 0;
	let closed = 0;
	function socket(index: number): SmtpSocket {
		let pos = 0;
		return {
			opened: Promise.resolve(),
			closed: Promise.resolve(),
			readable: new ReadableStream({
				pull(controller) {
					const next = replies[index]?.[pos++];
					if (next !== undefined) controller.enqueue(new TextEncoder().encode(next));
					else if (!options.hang) controller.close();
				}
			}),
			writable: new WritableStream({
				write(chunk) {
					if (options.writeFails) throw new Error('socket echoed synthetic-password');
					writes.push(new TextDecoder().decode(chunk));
				}
			}),
			startTls() { upgrades++; return socket(index + 1); },
			async close() { closed++; if (options.closeFails) throw new Error('cleanup'); }
		};
	}
	const connect: SmtpConnect = (address, tls) => {
		connects.push({ address, tls });
		return socket(0);
	};
	return { connect, writes, connects, get upgrades() { return upgrades; }, get closed() { return closed; } };
}

const greeting = '220 mx.example.test ready\r\n';
const plainAuth = '250-mx.example.test\r\n250 AUTH PLAIN LOGIN\r\n';
const accepted = ['235 authenticated\r\n', '250 sender ok\r\n', '250 recipient ok\r\n', '354 send data\r\n', '250 queued\r\n'];

describe('SMTP transport', () => {
	it('requires STARTTLS before authentication and reissues EHLO after upgrading', async () => {
		const io = sockets([
			[greeting, '250-mx\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n', '220 ready for TLS\r\n'],
			[plainAuth, ...accepted]
		]);
		await sendSmtp(smtpConfig(env), message, io.connect);
		expect(io.upgrades).toBe(1);
		expect(io.connects).toEqual([{ address: { hostname: env.SMTP_HOST, port: 587 }, tls: { secureTransport: 'starttls' } }]);
		expect(io.writes.slice(0, 3)).toEqual(['EHLO example.test\r\n', 'STARTTLS\r\n', 'EHLO example.test\r\n']);
		expect(io.writes[3]).toMatch(/^AUTH PLAIN /);
		expect(io.writes[4]).toBe('MAIL FROM:<sender@example.test>\r\n');
		expect(io.writes[5]).toBe('RCPT TO:<guest@example.test>\r\n');
		expect(io.writes[7]).toContain('Content-Transfer-Encoding: base64');
		expect(io.writes[7]).toMatch(/\r\n\.\r\n$/);
		expect(io.closed).toBe(1);
	});

	it('uses implicit TLS on 465 and supports AUTH LOGIN', async () => {
		const io = sockets([[greeting, '250 AUTH LOGIN\r\n', '334 username\r\n', '334 password\r\n', ...accepted]]);
		await sendSmtp(smtpConfig({ ...env, SMTP_PORT: '465' }), message, io.connect);
		expect(io.upgrades).toBe(0);
		expect(io.connects).toEqual([{ address: { hostname: env.SMTP_HOST, port: 465 }, tls: { secureTransport: 'on' } }]);
		expect(io.writes[1]).toBe('AUTH LOGIN\r\n');
		expect(io.writes[2]).toBe(Buffer.from(env.SMTP_USERNAME).toString('base64') + '\r\n');
		expect(io.writes[3]).toBe(Buffer.from(env.SMTP_PASSWORD).toString('base64') + '\r\n');
	});

	it('does not expose credentials to a server without STARTTLS', async () => {
		const io = sockets([[greeting, plainAuth]]);
		await expect(sendSmtp(smtpConfig(env), message, io.connect)).rejects.toThrow('refusing plaintext');
		expect(io.writes).toEqual(['EHLO example.test\r\n']);
		expect(io.closed).toBe(1);
	});

	it('redacts hostile server replies and aborts after rejected authentication', async () => {
		const io = sockets([[greeting, plainAuth, '535 synthetic-password echoed by hostile server\r\n']]);
		await expect(sendSmtp(smtpConfig({ ...env, SMTP_PORT: '465' }), message, io.connect))
			.rejects.toThrow('Authentication: unexpected SMTP reply 535.');
		expect(io.writes.some((write) => write.startsWith('MAIL FROM'))).toBe(false);
		expect(io.closed).toBe(1);
	});

	it('redacts arbitrary socket errors', async () => {
		const io = sockets([[greeting]], { writeFails: true });
		await expect(sendSmtp(smtpConfig(env), message, io.connect)).rejects.toThrow('SMTP connection or TLS operation failed.');
		expect(io.closed).toBe(1);
	});

	it('times out stalled sessions and closes the socket', async () => {
		const io = sockets([[]], { hang: true });
		await expect(sendSmtp(smtpConfig(env), message, io.connect, 10)).rejects.toThrow('timed out');
		expect(io.closed).toBe(1);
	});

	it('bounds oversized and malformed replies', async () => {
		for (const response of ['x'.repeat(65537), '250 broken greeting\r\n', 'not SMTP\r\n']) {
			const io = sockets([[response]]);
			await expect(sendSmtp(smtpConfig(env), message, io.connect)).rejects.toThrow();
			expect(io.closed).toBe(1);
		}
	});

	it('accepts fragmented multiline replies', async () => {
		const io = sockets([['220 mx', '\r\n', '250-mx\r\n250 AU', 'TH PLAIN\r\n', ...accepted]]);
		await sendSmtp(smtpConfig({ ...env, SMTP_PORT: '465' }), message, io.connect);
		expect(io.closed).toBe(1);
	});

	it('does not turn final acceptance into failure if cleanup fails', async () => {
		const io = sockets([[greeting, plainAuth, ...accepted]], { closeFails: true });
		await expect(sendSmtp(smtpConfig({ ...env, SMTP_PORT: '465' }), message, io.connect)).resolves.toBeUndefined();
	});
});

describe('SMTP configuration and MIME', () => {
	it('validates settings without including their values in errors', () => {
		for (const invalid of [
			{ SMTP_HOST: '' }, { SMTP_HOST: 'host\r\ninjected' }, { SMTP_PORT: '0' }, { SMTP_PORT: '25' },
			{ SMTP_PORT: '65536' }, { SMTP_USERNAME: '' }, { SMTP_PASSWORD: '' }, { SMTP_FROM: 'bad\r\naddress' }
		]) expect(() => smtpConfig({ ...env, ...invalid })).toThrow();
	});

	it('encodes Unicode headers and bodies, preventing header and DATA injection', () => {
		const composed = composeMessage(env.SMTP_FROM, message);
		const [headers, body] = composed.split('\r\n\r\n');
		expect(headers).toContain('Subject: =?UTF-8?B?');
		expect(Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString()).toBe('Hello\r\n.\r\n.private link\r\n');
		for (const field of ['to', 'subject'] as const) {
			expect(() => composeMessage(env.SMTP_FROM, { ...message, [field]: 'bad\r\nBcc: victim@example.test' })).toThrow();
		}
	});

	it('packages HTML after plain text as a base64 multipart alternative', () => {
		const html = '<html><body><a href="https://example.test/?token=synthetic">Accept invitation</a></body></html>';
		const composed = composeMessage(env.SMTP_FROM, { ...message, html });
		const boundary = composed.match(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)?.[1];
		expect(boundary).toMatch(/^pockettrail-/);
		const parts = composed.split(`--${boundary}`).slice(1, -1);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toContain('Content-Type: text/plain; charset=UTF-8');
		expect(parts[1]).toContain('Content-Type: text/html; charset=UTF-8');
		for (const [index, content] of [message.body, html].entries()) {
			const [headers, encoded] = parts[index]!.split('\r\n\r\n');
			expect(headers).toContain('Content-Transfer-Encoding: base64');
			expect(Buffer.from(encoded!.trim(), 'base64').toString()).toBe(content.replace(/\r\n|\r|\n/g, '\r\n'));
			expect(encoded!.trim().split('\r\n').every((line) => line.length <= 76)).toBe(true);
		}
		expect(composed).toMatch(new RegExp(`--${boundary}--\\r\\n$`));
	});
});
