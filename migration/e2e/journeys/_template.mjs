// Journey module template. Copy to <name>.mjs; keep the export signature.
import { mkdirSync, writeFileSync } from 'node:fs';

export async function checks(ctx) {
	const { Client, ORIGIN, extractCsrf } = ctx;
	let failures = 0;
	const check = (name, condition, detail = '') => {
		if (condition) process.stdout.write(`  ok   ${name}\n`);
		else {
			failures += 1;
			process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
		}
	};
	void Client;
	void ORIGIN;
	void extractCsrf;
	return failures;
}
