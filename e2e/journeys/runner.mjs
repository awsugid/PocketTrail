// Journey runner: boots the real Worker once, then runs each requested
// journey module against it. A journey module exports
//   export async function checks(ctx) { ... return failureCount; }
// where ctx carries the same harness primitives run.mjs uses. Usage:
//   node e2e/journeys/runner.mjs txns imports
import { mkdirSync, writeFileSync } from 'node:fs';
import {
	Client,
	ORIGIN,
	OTHER_SECRET,
	SECRET,
	extractCsrf,
	rawRequest,
	setCookies,
	withWorker
} from '../harness.mjs';

const names = process.argv.slice(2);
if (names.length === 0) {
	process.stderr.write('usage: node e2e/journeys/runner.mjs <module> [more…]\n');
	process.exit(2);
}

const ctx = {
	Client,
	ORIGIN,
	OTHER_SECRET,
	SECRET,
	extractCsrf,
	rawRequest,
	setCookies
};

let totalFailures = 0;
await withWorker(async () => {
	for (const name of names) {
		const module = await import(`./${name}.mjs`);
		process.stdout.write(`\n— journey: ${name} —\n`);
		const failures = await module.checks(ctx);
		totalFailures += failures;
	}
});

process.stdout.write(`\nJourney failures: ${totalFailures}\n`);
if (totalFailures > 0) process.exit(1);
