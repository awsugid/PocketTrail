// Import journey: staging, preview classification, confirmation, cumulative
// idempotence, quarantined duplicates/conflicts, blocked warnings, and org
// scoping. Statement text is synthetic and fixed-width, as browser extraction
// produces it; only the PDF magic bytes are needed server-side.
import { Client } from '../harness.mjs';
import { csrfFrom, postMultipart, signIn, statement, syntheticPdf } from './_util.mjs';

/** Rows rendered in the ledger table's body. */
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

	const alice = new Client();
	const dana = new Client();
	await signIn(alice, extractCsrf, 'alice');
	await signIn(dana, extractCsrf, 'dana');

	const importsIndex = await alice.get('/org/demo-jakarta/imports');
	const indexHtml = await importsIndex.text();
	const csrf = csrfFrom(indexHtml) ?? '';
	check('the import page renders for an importer', importsIndex.status === 200, String(importsIndex.status));
	check('the staging form is present', /Stage statement/.test(indexHtml));

	// ---------------------------------------------------- a clean staged batch
	const cleanText = statement([
		{
			date: '01 Jun 2025',
			time: '10:23',
			source: 'Demo New Vendor',
			details: 'Outgoing Transfer',
			notes: 'DEMO: import row one',
			amount: '-50.000,00',
			balance: '8.450.000,00',
			id: 'JPXIMP2001'
		},
		{
			date: '02 Jun 2025',
			time: '11:10',
			source: 'Demo Sponsor',
			details: 'Incoming Transfer',
			notes: 'DEMO: import row two',
			amount: '+75.000,00',
			balance: '8.525.000,00',
			id: 'JPXIMP2002'
		}
	]);
	const staged = await postMultipart(
		alice,
		'/org/demo-jakarta/imports',
		{ csrf_token: csrf, pocket_id: '1', statement_text: cleanText },
		{ file: syntheticPdf('statement-a') }
	);
	check('a statement stages', staged.status === 303, String(staged.status));
	const batchPath = staged.headers.get('location') ?? '';
	check('staging opens the batch preview', /\/org\/demo-jakarta\/imports\/\d+$/.test(batchPath), batchPath);

	if (batchPath) {
		const preview = await alice.get(batchPath);
		const previewHtml = await preview.text();
		check('the batch preview renders', preview.status === 200, String(preview.status));
		check('the batch is shown as a preview, not a result', /<title>Import preview/.test(previewHtml) && /Will import/.test(previewHtml));
		check('new rows are planned for import', (previewHtml.split('Will import').length - 1) === 2, 'plan badges');
		check('the confirm control is offered', /Confirm import/.test(previewHtml));

		const confirm = await alice.postForm(`${batchPath}?/confirm`, { csrf_token: csrf });
		check('confirmation is accepted', confirm.status === 303, String(confirm.status));
		const afterCommit = await (await alice.get(batchPath)).text();
		check(
			'the batch reports two imported rows',
			/2 imported/.test(afterCommit.replace(/\s+/g, ' ')),
			afterCommit.slice(0, 0)
		);

		const ledger = await (await alice.get('/org/demo-jakarta/transactions')).text();
		check('the new movements reach the ledger', ledger.includes('Demo New Vendor') && ledger.includes('Demo Sponsor'));
		const rowsBeforeRestage = ledgerRows(ledger);
		check('two rows were added to the ledger', rowsBeforeRestage === 5, String(rowsBeforeRestage));

		// ---------------------------------------------- cumulative idempotence
		const restage = await postMultipart(
			alice,
			'/org/demo-jakarta/imports',
			{ csrf_token: csrf, pocket_id: '1', statement_text: cleanText },
			{ file: syntheticPdf('statement-a') }
		);
		const restagePath = restage.headers.get('location') ?? '';
		const restageHtml = await (await alice.get(restagePath)).text();
		check(
			'a repeated import is fully skipped',
			!restageHtml.includes('Will import') && (restageHtml.split('Skip (unchanged)').length - 1) === 2,
			'skip badges'
		);
		await alice.postForm(`${restagePath}?/confirm`, { csrf_token: csrf });
		const ledgerAfter = await (await alice.get('/org/demo-jakarta/transactions')).text();
		check(
			'a repeated import creates no duplicate movement',
			ledgerRows(ledgerAfter) === rowsBeforeRestage,
			`${rowsBeforeRestage} -> ${ledgerRows(ledgerAfter)}`
		);
	}

	// ------------------------------------------------------ bank conflict path
	const conflictText = statement([
		{
			date: '01 Jun 2025',
			time: '10:23',
			source: 'Demo New Vendor',
			details: 'Outgoing Transfer',
			notes: 'DEMO: import row one',
			amount: '-60.000,00',
			balance: '8.440.000,00',
			id: 'JPXIMP2001'
		}
	]);
	const conflictStage = await postMultipart(
		alice,
		'/org/demo-jakarta/imports',
		{ csrf_token: csrf, pocket_id: '1', statement_text: conflictText },
		{ file: syntheticPdf('statement-b') }
	);
	const conflictPath = conflictStage.headers.get('location') ?? '';
	const conflictHtml = await (await alice.get(conflictPath)).text();
	check('a changed bank field is a conflict', conflictHtml.includes('Conflict'), 'no conflict badge');
	check('the conflict explains the retained record', /Bank fields differ/.test(conflictHtml));
	await alice.postForm(`${conflictPath}?/confirm`, { csrf_token: csrf });
	const retainedLedger = await (await alice.get('/org/demo-jakarta/transactions')).text();
	check(
		'a conflicting import never overwrites the bank facts',
		retainedLedger.includes('-Rp 50.000') && !retainedLedger.includes('-Rp 60.000'),
		'amount changed'
	);

	// --------------------------------------------------- missing ID is blocked
	const missingText = statement([
		{
			date: '03 Jun 2025',
			time: '09:30',
			source: 'Demo Unidentified',
			details: 'Outgoing Transfer',
			notes: 'DEMO: no id',
			amount: '-10.000,00',
			balance: '8.400.000,00',
			id: ''
		}
	]);
	const missingStage = await postMultipart(
		alice,
		'/org/demo-jakarta/imports',
		{ csrf_token: csrf, pocket_id: '1', statement_text: missingText },
		{ file: syntheticPdf('statement-c') }
	);
	const missingPath = missingStage.headers.get('location') ?? '';
	const missingHtml = await (await alice.get(missingPath)).text();
	check('a missing bank ID is flagged for review', missingHtml.includes('Needs review'));
	check(
		'the missing ID blocks confirmation',
		/Resolve before confirming/.test(missingHtml) && !/Confirm import/.test(missingHtml),
		'confirm still offered'
	);
	const blocked = await alice.postForm(`${missingPath}?/confirm`, { csrf_token: csrf });
	check('confirming a blocked batch is refused', blocked.status === 409, String(blocked.status));
	const missingAfter = await (await alice.get(missingPath)).text();
	check('a blocked batch commits nothing', !missingAfter.includes('badge--approved'), 'batch committed');

	// ------------------------------------------------ duplicate IDs quarantined
	const repeatedText = statement([
		{
			date: '04 Jun 2025',
			time: '12:00',
			source: 'Demo Repeat Vendor',
			details: 'Outgoing Transfer',
			notes: 'DEMO: repeated id first',
			amount: '-20.000,00',
			balance: '8.380.000,00',
			id: 'JPXIMP4001'
		},
		{
			date: '04 Jun 2025',
			time: '12:05',
			source: 'Demo Repeat Vendor',
			details: 'Outgoing Transfer',
			notes: 'DEMO: repeated id second',
			amount: '-30.000,00',
			balance: '8.350.000,00',
			id: 'JPXIMP4001'
		}
	]);
	const repeatedStage = await postMultipart(
		alice,
		'/org/demo-jakarta/imports',
		{ csrf_token: csrf, pocket_id: '1', statement_text: repeatedText },
		{ file: syntheticPdf('statement-d') }
	);
	const repeatedPath = repeatedStage.headers.get('location') ?? '';
	check(
		'every occurrence of a repeated bank ID is quarantined',
		(repeatedPath ? await (await alice.get(repeatedPath)).text() : '').split('Repeated bank ID').length - 1 >= 2,
		'repeated rows not all quarantined'
	);

	// --------------------------------------------------- organization scoping
	const foreign = await alice.get('/org/demo-indonesia/imports');
	check('a non-member cannot open another organization\'s imports', foreign.status === 403, String(foreign.status));
	const noPermission = await dana.postForm('/org/demo-jakarta/imports', { csrf_token: csrf });
	check('a member without import permission is denied staging', noPermission.status === 403, String(noPermission.status));
	const foreignBatch = await alice.get('/org/demo-indonesia/imports/1');
	check('another organization\'s batch is not readable', foreignBatch.status === 403, String(foreignBatch.status));

	return failures;
}
