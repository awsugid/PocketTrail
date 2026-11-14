// Transaction journey: documentation edits, revision CAS, self-approval denial,
// approval by an independent reviewer, comment stability, evidence upload and
// download authorization, suppression, income notes, and cross-org isolation.
import { Client } from '../harness.mjs';
import { csrfFrom, postMultipart, signIn, syntheticPdf } from './_util.mjs';

export async function checks(ctx) {
	const { ORIGIN, extractCsrf } = ctx;
	let failures = 0;
	const check = (name, condition, detail = '') => {
		if (condition) process.stdout.write(`  ok   ${name}\n`);
		else {
			failures += 1;
			process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
		}
	};

	const alice = new Client();
	const bob = new Client();
	const dana = new Client();
	await signIn(alice, extractCsrf, 'alice');
	await signIn(bob, extractCsrf, 'bob');
	await signIn(dana, extractCsrf, 'dana');

	const detailPath = '/org/demo-jakarta/transactions/3';
	const bobCsrf = csrfFrom(await (await bob.get(detailPath)).text()) ?? '';
	const open = await alice.get(detailPath);
	const openHtml = await open.text();
	check('a member can open a transaction detail', open.status === 200, String(open.status));
	check('detail carries the session CSRF token', csrfFrom(openHtml) !== null);
	check('detail renders the owed-documentation notice', /Needed before review/.test(openHtml));
	const csrf = csrfFrom(openHtml) ?? '';

	// ------------------------------------------------------- documentation save
	const saved = await alice.postForm(`${detailPath}?/details`, {
		csrf_token: csrf,
		revision: '0',
		explanation: 'DEMO: hosting invoice for the June meetup',
		responsible_member_id: '1',
		evidence_unavailable_reason: 'DEMO: vendor issued no receipt',
		'split_label[]': 'DEMO: hosting',
		'split_amount[]': '120000',
		'split_member[]': '1'
	});
	check('a documented expense saves details', saved.status === 303, String(saved.status));

	const afterSave = await alice.get(detailPath);
	const afterSaveHtml = await afterSave.text();
	check('saved details are persisted', afterSaveHtml.includes('DEMO: hosting invoice for the June meetup'));
	check('a complete expense is pending review', afterSaveHtml.includes('Pending review'));

	// ------------------------------------------------------------- revision CAS
	const stale = await alice.postForm(`${detailPath}?/details`, {
		csrf_token: csrf,
		revision: '0',
		explanation: 'DEMO: stale write',
		responsible_member_id: '1',
		evidence_unavailable_reason: '',
		'split_label[]': 'DEMO: hosting',
		'split_amount[]': '120000',
		'split_member[]': '1'
	});
	check('a stale revision is rejected', stale.status === 409, String(stale.status));
	const afterStale = await alice.get(detailPath);
	check(
		'a losing stale write changed nothing',
		!(await afterStale.text()).includes('DEMO: stale write')
	);

	// -------------------------------------------------- self-approval is denied
	const selfApprove = await alice.postForm(`${detailPath}?/approve`, {
		csrf_token: csrf,
		revision: '1',
		note: 'DEMO: self approval attempt'
	});
	check('a historically responsible member cannot approve', selfApprove.status === 403, String(selfApprove.status));
	check(
		'the denial explains the responsibility rule',
		/responsible for any part/.test(await selfApprove.text())
	);

	// ------------------------------------------- independent reviewer approves
	const approve = await bob.postForm(`${detailPath}?/approve`, {
		csrf_token: bobCsrf,
		revision: '1',
		note: 'DEMO: reviewed the hosting invoice'
	});
	check('an independent reviewer can approve', approve.status === 303, String(approve.status));
	const approved = await (await alice.get(detailPath)).text();
	check('the approval is visible', approved.includes('Approved') && approved.includes('DEMO: reviewed the hosting invoice'));

	// ------------------------------------------------ comments keep the approval
	const comment = await bob.postForm(`${detailPath}?/comment`, {
		csrf_token: bobCsrf,
		body: 'DEMO: noting the invoice number for the record'
	});
	check('a comment is accepted', comment.status === 303, String(comment.status));
	const afterComment = await (await alice.get(detailPath)).text();
	check('a comment leaves the approval intact', afterComment.includes('Approved'));
	check('the comment is listed', afterComment.includes('DEMO: noting the invoice number'));

	// --------------------------------------- substantive edits reopen the review
	const reopened = await alice.postForm(`${detailPath}?/details`, {
		csrf_token: csrf,
		revision: '2',
		explanation: 'DEMO: hosting invoice for June and July',
		responsible_member_id: '1',
		evidence_unavailable_reason: 'DEMO: vendor issued no receipt',
		'split_label[]': 'DEMO: hosting',
		'split_amount[]': '120000',
		'split_member[]': '1'
	});
	check('a substantive edit is accepted', reopened.status === 303, String(reopened.status));
	const afterReopen = await (await alice.get(detailPath)).text();
	check('a substantive edit reopens review', afterReopen.includes('Pending review') && !afterReopen.includes('badge--approved'));

	// ------------------------------------------------------------- exact money
	check('the detail renders the exact bank amount', afterReopen.includes('-Rp 120.000'), 'amount missing');

	// ----------------------------------------------------------- HTML escaping
	const escapeWrite = await alice.postForm(`${detailPath}?/details`, {
		csrf_token: csrf,
		revision: '3',
		explanation: '<script>alert(1)</script>',
		responsible_member_id: '1',
		evidence_unavailable_reason: 'DEMO: no receipt',
		'split_label[]': 'DEMO: hosting',
		'split_amount[]': '120000',
		'split_member[]': '1'
	});
	check('a stored script payload is accepted as text', escapeWrite.status === 303, String(escapeWrite.status));
	const escaped = await (await alice.get(detailPath)).text();
	check(
		'stored HTML is escaped on render',
		!escaped.includes('<script>alert(1)') && escaped.includes('&lt;script>alert(1)'),
		'payload not escaped'
	);

	// --------------------------------------------------------- evidence upload
	const upload = await postMultipart(
		alice,
		`${detailPath}?/document`,
		{ csrf_token: csrf, revision: '4', note: 'DEMO: synthetic evidence' },
		{ file: syntheticPdf('evidence') }
	);
	check('evidence upload is accepted for a documenting member', upload.status === 303, String(upload.status));
	const withEvidence = await (await alice.get(detailPath)).text();
	const documentPath = withEvidence.match(/href="(\/org\/demo-jakarta\/documents\/\d+)"/)?.[1];
	check('the evidence link is rendered', Boolean(documentPath), 'no document link');

	if (documentPath) {
		const downloaded = await alice.get(documentPath);
		check('the uploading organization can download evidence', downloaded.status === 200, String(downloaded.status));
		check(
			'evidence downloads as an attachment',
			/attachment/.test(downloaded.headers.get('content-disposition') ?? ''),
			downloaded.headers.get('content-disposition') ?? 'missing'
		);
		check('evidence is never publicly cacheable', /private/.test(downloaded.headers.get('cache-control') ?? ''));
		const otherViewer = await bob.get(documentPath);
		check('another ledger viewer can read retained evidence', otherViewer.status === 200, String(otherViewer.status));
	}
	const noLedger = await dana.get(documentPath ?? '/org/demo-jakarta/documents/1');
	check('a member without the ledger permission cannot download evidence', noLedger.status === 403, String(noLedger.status));
	const foreignDoc = await dana.get('/org/demo-indonesia/documents/1');
	check('a non-member cannot probe another organization\'s evidence', foreignDoc.status === 403, String(foreignDoc.status));

	// ----------------------------------------------------- unsigned-by-mapping
	const foreignDetail = await bob.get('/org/demo-indonesia/transactions/1');
	check(
		'an entry from another organization looks missing through a foreign path',
		foreignDetail.status === 404,
		String(foreignDetail.status)
	);
	const foreignOrg = await alice.get('/org/demo-indonesia/transactions');
	check('a non-member is denied another organization', foreignOrg.status === 403, String(foreignOrg.status));

	// -------------------------------------------------------------- suppression
	const noReason = await alice.postForm(`${detailPath}?/suppress`, {
		csrf_token: csrf,
		revision: '5',
		reason: ''
	});
	check('suppression without a reason is refused', noReason.status === 400, String(noReason.status));
	const suppressed = await alice.postForm(`${detailPath}?/suppress`, {
		csrf_token: csrf,
		revision: '5',
		reason: 'DEMO: settlement in progress'
	});
	check('suppression with a reason is recorded', suppressed.status === 303, String(suppressed.status));
	const suppressedHtml = await (await alice.get(detailPath)).text();
	check('the suppressed state is visible', suppressedHtml.includes('Suppressed'));
	check('suppression does not imply completion', suppressedHtml.includes('Pending review'));
	const resumed = await alice.postForm(`${detailPath}?/unsuppress`, {
		csrf_token: csrf,
		revision: '6'
	});
	check('notifications can be resumed', resumed.status === 303, String(resumed.status));

	// -------------------------------------------------------------- income path
	const income = await alice.get('/org/demo-jakarta/transactions/2');
	const incomeHtml = await income.text();
	check('an income movement opens for its recipient', income.status === 200, String(income.status));
	check('income offers notes but no approval step', /Income notes/.test(incomeHtml) && !/id="review-heading"/.test(incomeHtml));
	const incomeCsrf = csrfFrom(incomeHtml) ?? csrf;
	const incomeSave = await alice.postForm('/org/demo-jakarta/transactions/2?/details', {
		csrf_token: incomeCsrf,
		revision: '0',
		explanation: 'DEMO: venue refund credited to the pocket'
	});
	check('income notes save without approval', incomeSave.status === 303, String(incomeSave.status));
	const incomeAfter = await (await alice.get('/org/demo-jakarta/transactions/2')).text();
	check('income keeps its historical approval', incomeAfter.includes('Approved'));
	check('the income note is persisted', incomeAfter.includes('DEMO: venue refund credited to the pocket'));
	const incomeApprove = await alice.postForm('/org/demo-jakarta/transactions/2?/approve', {
		csrf_token: incomeCsrf,
		revision: '1',
		note: 'should be refused'
	});
	check('income has no approval step', incomeApprove.status === 400, String(incomeApprove.status));

	// ------------------------------------------- permission-denied documentation
	const danaDetail = await dana.get(detailPath);
	check('a member without ledger access is denied the detail', danaDetail.status === 403, String(danaDetail.status));

	return failures;
}
