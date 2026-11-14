// Race journey: concurrent writers against the revision CAS and the import
// status-token CAS. Exactly one writer may win; losers must write no child or
// audit rows, and the batch must not double-insert.
import { Client } from '../harness.mjs';
import { csrfFrom, postMultipart, signIn, statement, syntheticPdf } from './_util.mjs';

function ledgerRows(html) {
	const body = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? '';
	return body.split('<tr').length - 1;
}

export async function checks(ctx) {
	const { extractCsrf } = ctx;
	let failures = 0;
	const check = (name, condition, detail = '') => {
		if (condition) process.stdout.write(`  ok   ${name}\n`);
		else {
			failures += 1;
			process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
		}
	};

	const aliceA = new Client();
	const aliceB = new Client();
	await signIn(aliceA, extractCsrf, 'alice');
	await signIn(aliceB, extractCsrf, 'alice');

	// ------------------------------------------- revision CAS, two writers
	const detailPath = '/org/demo-jakarta/transactions/3';
	const page = await aliceA.get(detailPath);
	const html = await page.text();
	const csrfA = csrfFrom(html) ?? '';
	const csvB = csrfFrom(await (await aliceB.get(detailPath)).text()) ?? '';
	const revision = html.match(/name="revision"\s+value="(\d+)"/)?.[1] ?? '';

	const save = (client, csrf, text) =>
		client.postForm(`${detailPath}?/details`, {
			csrf_token: csrf,
			revision,
			explanation: text,
			responsible_member_id: '1',
			evidence_unavailable_reason: 'DEMO: race',
			'split_label[]': 'DEMO: hosting',
			'split_amount[]': '120000',
			'split_member[]': '1'
		});
	const [first, second] = await Promise.all([
		save(aliceA, csrfA, 'DEMO: race writer A'),
		save(aliceB, csvB, 'DEMO: race writer B')
	]);
	const statuses = [first.status, second.status].sort();
	check(
		'exactly one concurrent revision write wins',
		statuses[0] === 303 && statuses[1] === 409,
		statuses.join(',')
	);
	const settled = await (await aliceA.get(detailPath)).text();
	const winnerA = settled.includes('DEMO: race writer A');
	const winnerB = settled.includes('DEMO: race writer B');
	check('the surviving write is one whole version', winnerA !== winnerB, `A=${winnerA} B=${winnerB}`);
	check(
		'the losing write left no duplicate child rows',
		/Saved purposes match the bank amount/.test(settled.replace(/\s+/g, ' ')),
		'purpose total does not reconcile'
	);

	// ---------------------------------------------- import confirmation race
	const importsPage = await (await aliceA.get('/org/demo-jakarta/imports')).text();
	const importCsrf = csrfFrom(importsPage) ?? '';
	const text = statement([
		{
			date: '05 Jun 2025',
			time: '08:00',
			source: 'Demo Race Vendor',
			details: 'Outgoing Transfer',
			notes: 'DEMO: race import',
			amount: '-15.000,00',
			balance: '8.415.000,00',
			id: 'JPXRACE5001'
		}
	]);
	const staged = await postMultipart(
		aliceA,
		'/org/demo-jakarta/imports',
		{ csrf_token: importCsrf, pocket_id: '1', statement_text: text },
		{ file: syntheticPdf('race') }
	);
	check('the race statement stages', staged.status === 303, String(staged.status));
	const batchPath = staged.headers.get('location') ?? '';
	const before = ledgerRows(await (await aliceA.get('/org/demo-jakarta/transactions')).text());
	await Promise.all([
		aliceA.postForm(`${batchPath}?/confirm`, { csrf_token: importCsrf }),
		aliceB.postForm(`${batchPath}?/confirm`, { csrf_token: csvB })
	]);
	const after = ledgerRows(await (await aliceA.get('/org/demo-jakarta/transactions')).text());
	check('a concurrent double confirm inserts one row', after === before + 1, `${before} -> ${after}`);
	const batchHtml = await (await aliceA.get(batchPath)).text();
	check('the confirmed batch records a single result set', /1 imported/.test(batchHtml.replace(/\s+/g, ' ')), 'result counts');

	return failures;
}
