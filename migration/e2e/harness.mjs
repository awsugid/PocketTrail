// Shared runtime harness for the migration slice's checks.
//
// It does the real thing rather than approximating it: it applies the project's
// own migrations to a local D1 database, seeds the synthetic fixtures, builds
// the Worker with the Cloudflare adapter, runs it under `wrangler dev`, and
// serves it over HTTP on loopback. Nothing here touches a remote binding.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const PORT = Number(process.env.E2E_PORT ?? 5299);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Signing key for this run only; written to the git-ignored .dev.vars. */
export const SECRET = 'e2e-session-key-with-at-least-32-chars';
export const OTHER_SECRET = 'a-different-session-key-of-32-characters';

export function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options });
	if (result.status !== 0) {
		process.stderr.write(result.stdout ?? '');
		process.stderr.write(result.stderr ?? '');
		throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
	}
	return result.stdout ?? '';
}

/** Minimal cookie jar: one per simulated browser session. */
export class Client {
	#jar = new Map();

	cookieHeader() {
		return [...this.#jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	absorb(response) {
		for (const raw of response.headers.getSetCookie()) {
			const [pair] = raw.split(';');
			const index = pair.indexOf('=');
			if (index < 0) continue;
			const name = pair.slice(0, index).trim();
			const value = pair.slice(index + 1).trim();
			if (value === '' || /max-age=0/i.test(raw)) this.#jar.delete(name);
			else this.#jar.set(name, value);
		}
		return response;
	}

	async request(path, init = {}) {
		const headers = new Headers(init.headers ?? {});
		const cookie = this.cookieHeader();
		if (cookie) headers.set('cookie', cookie);
		const response = await fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' });
		return this.absorb(response);
	}

	async get(path) {
		return this.request(path);
	}

	/** Browser form posts always carry an Origin header, and accept HTML, which
	 * is what makes SvelteKit answer with a 303 redirect rather than its JSON
	 * action result. */
	async postForm(path, fields, extraHeaders = {}) {
		const body = new URLSearchParams(fields);
		return this.request(path, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'text/html',
				origin: ORIGIN,
				...extraHeaders
			},
			body
		});
	}
}

/** A request whose Host header is chosen explicitly, so the loopback gate is
 * exercised the way an attacker would try to bypass it. */
export function rawRequest(hostHeader, { method = 'GET', path = '/healthz', headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const allHeaders = { host: hostHeader, ...headers };
		if (body !== undefined) allHeaders['content-length'] = Buffer.byteLength(body);
		const request = httpRequest(
			{ host: '127.0.0.1', port: PORT, method, path, headers: allHeaders },
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () =>
					resolve({ status: response.statusCode, headers: response.headers, body: text })
				);
			}
		);
		request.on('error', reject);
		if (body !== undefined) request.write(body);
		request.end();
	});
}

export function extractCsrf(html) {
	return html.match(/name="csrf_token"\s+value="([0-9a-f]{32})"/)?.[1] ?? null;
}

export function setCookies(response) {
	return response.headers.getSetCookie?.() ?? [];
}

async function waitForServer(logPath, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${ORIGIN}/healthz`);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`wrangler dev did not become ready; see ${logPath}`);
}

/** Restarts local state from scratch: fresh local D1, synthetic fixtures, and a
 * production-shaped adapter build. */
export function prepareWorker() {
	process.stdout.write('Preparing local database and build…\n');
	rmSync(`${ROOT}/.wrangler/state`, { recursive: true, force: true });
	mkdirSync(`${ROOT}/.wrangler`, { recursive: true });
	writeFileSync(
		`${ROOT}/.dev.vars`,
		`LOCAL_DEV=true\nSECRET_SESSION_KEY=${SECRET}\nGOOGLE_CLIENT_ID=\n`
	);

	run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);
	run('npx', [
		'wrangler',
		'd1',
		'execute',
		'DB',
		'--local',
		'--file',
		'../tests/fixtures/seed.sql'
	]);
	run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', 'e2e/fixtures/extra.sql']);
	run('npm', ['run', 'build']);
	return `${ROOT}/.wrangler/dev.log`;
}

/** Runs `fn` against a freshly prepared Worker, and always stops it. */
export async function withWorker(fn) {
	const logPath = prepareWorker();
	const logFd = openSync(logPath, 'a');
	const server = spawn(
		process.platform === 'win32' ? 'npx.cmd' : 'npx',
		['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT)],
		{
			cwd: ROOT,
			detached: true,
			stdio: ['ignore', logFd, logFd],
			env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }
		}
	);
	try {
		await waitForServer(logPath);
		return await fn();
	} finally {
		try {
			process.kill(-server.pid, 'SIGTERM');
		} catch {
			// already gone
		}
		closeSync(logFd);
	}
}
