// Transaction journey under organization-scoped purposes: allocation drafts
// and overallocation, exact-allocation submission, per-purpose approval with
// self-approval denial, reopen-on-substantive-edit, evidence at the purpose,
// discussion messages, suppression, income notes, and cross-org isolation.
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
	const open = await alice.get(detailPath);
	const openHtml = await open.text();
	check('a member can open a transaction detail', open.status === 200, String(open.status));
	check('the detail renders the owed-documentation notice', /Needed before review/.test(openHtml));
	check('the purpose panel is present', /Purposes/.test(openHtml) && /Add/.test(openHtml));
	const csrf = csrfFrom(openHtml) ?? '';
	const bobCsrf = csrfFrom(await (await bob.get(detailPath)).text()) ?? '';
	const revisionOf = (html) => Number(html.match(/name="revision" value="(\d+)"/)?.[1] ?? 0);
	const purposeLinkOf = (html) => html.match(/href="(\/org\/demo-jakarta\/purposes\/\d+)"/)?.[1];

	// ------------------------------------------- allocation drafts and gates
	const over = await alice.postForm(`${detailPath}?/allocations`, {
		csrf_token: csrf,
		revision: String(revisionOf(openHtml)),
		responsible_member_id: '1',
		'alloc_purpose[]': 'DEMO: hosting',
		'alloc_amount[]': '130000',
		'alloc_member[]': '',
		justification: 'DEMO: initial allocation'
	});
	check('overallocation is rejected', over.status === 400, String(over.status));

	const noJustification = await alice.postForm(`${detailPath}?/allocations`, {
		csrf_token: csrf,
		revision: String(revisionOf(openHtml)),
		responsible_member_id: '1',
		'alloc_purpose[]': 'DEMO: hosting',
		'alloc_amount[]': '120000',
		'alloc_member[]': ''
	});
	check('a responsibility change without justification is refused', noJustification.status === 400, String(noJustification.status));

	const saved = await alice.postForm(`${detailPath}?/allocations`, {
		csrf_token: csrf,
		revision: String(revisionOf(openHtml)),
		responsible_member_id: '1',
		'alloc_purpose[]': 'DEMO: hosting',
		'alloc_amount[]': '120000',
		'alloc_member[]': '',
		justification: 'DEMO: initial allocation'
	});
	check('an exact allocation with justification saves', saved.status === 303, String(saved.status));
	const afterSave = await (await alice.get(detailPath)).text();
	check('the allocation row names its purpose', afterSave.includes('DEMO: hosting'), 'purpose name missing');
	// The allocating editor shows inputs, not links; a read-only viewer sees links.
	const readOnly = await (await bob.get(detailPath)).text();
	check('the purpose page is linked', Boolean(purposeLinkOf(readOnly)), 'no purpose link');
	check('the transaction shows its aggregate review state', /Needs details|Pending review/.test(afterSave));

	// ------------------------------------------------------------- revision CAS
	const stale = await alice.postForm(`${detailPath}?/allocations`, {
		csrf_token: csrf,
		revision: '0',
		responsible_member_id: '1',
		'alloc_purpose[]': 'DEMO: hosting',
		'alloc_amount[]': '120000',
		'alloc_member[]': '',
		justification: 'DEMO: stale write'
	});
	check('a stale revision is rejected', stale.status === 409, String(stale.status));
	const afterStale = await (await alice.get(detailPath)).text();
	check('a losing stale write changed nothing', !afterStale.includes('DEMO: stale write'));

	// ------------------------------------------- purpose documentation + review
	const purposePath = purposeLinkOf(readOnly) ?? '/org/demo-jakarta/purposes/1';
	const purposeOpen = await (await alice.get(purposePath)).text();
	check('the purpose page opens with discussion sidebar', /Discussion/.test(purposeOpen) && /id="discussion-heading"/.test(purposeOpen));
	const purposeCsrf = csrfFrom(purposeOpen) ?? csrf;

	const notesSaved = await alice.postForm(`${purposePath}?/notes`, {
		csrf_token: purposeCsrf,
		revision: String(revisionOf(purposeOpen)),
		notes: 'DEMO: hosting invoice for the June meetup; vendor issued no receipt'
	});
	check('purpose Notes save', notesSaved.status === 303, String(notesSaved.status));

	const submitted = await alice.postForm(`${detailPath}?/submit`, {
		csrf_token: csrf,
		revision: String(revisionOf(afterStale))
	});
	check('an exactly allocated, documented expense submits', submitted.status === 303, String(submitted.status));
	const afterSubmit = await (await alice.get(detailPath)).text();
	check('the purpose awaits review', afterSubmit.includes('Pending review'), 'pending review missing');

	const txnApprove = await bob.postForm(`${detailPath}?/approve`, {
		csrf_token: bobCsrf,
		revision: String(revisionOf(afterSubmit)),
		note: 'DEMO: whole-transaction approval attempt'
	});
	check('whole-transaction approval is refused for allocated expenses', txnApprove.status === 400, String(txnApprove.status));

	const selfApprove = await alice.postForm(`${purposePath}?/approve`, {
		csrf_token: purposeCsrf,
		revision: String(revisionOf(await (await alice.get(purposePath)).text())),
		note: 'DEMO: self approval attempt'
	});
	check('the responsible member cannot approve their purpose', selfApprove.status === 403, String(selfApprove.status));
	check(
		'the denial explains the responsibility rule',
		/responsible for this purpose/.test(await selfApprove.text())
	);

	const purposeSubmitted = await (await bob.get(purposePath)).text();
	const approved = await bob.postForm(`${purposePath}?/approve`, {
		csrf_token: csrfFrom(purposeSubmitted) ?? purposeCsrf,
		revision: String(revisionOf(purposeSubmitted)),
		note: 'DEMO: reviewed the hosting invoice'
	});
	check('an independent reviewer approves the purpose', approved.status === 303, String(approved.status));
	const txnApproved = await (await alice.get(detailPath)).text();
	check('the transaction aggregates to Approved', /badge--approved/.test(txnApproved), 'approved badge missing');

	// --------------------------------------- substantive edits reopen the review
	const reopened = await alice.postForm(`${detailPath}?/allocations`, {
		csrf_token: csrf,
		revision: String(revisionOf(txnApproved)),
		responsible_member_id: '1',
		'alloc_purpose[]': 'DEMO: hosting',
		'alloc_amount[]': '110000',
		'alloc_member[]': '',
		'alloc_purpose[]': 'DEMO: cleaning',
		'alloc_amount[]': '10000',
		'alloc_member[]': '',
		justification: 'DEMO: split adjustment'
	});
	check('a substantive allocation edit is accepted', reopened.status === 303, String(reopened.status));
	const afterReopen = await (await alice.get(detailPath)).text();
	check('an allocation change reopens purpose review', afterReopen.includes('Needs details') && !/badge--approved/.test(afterReopen));
	const purposeAfterReopen = await (await alice.get(purposePath)).text();
	check('the reopened purpose records its history', /History/.test(purposeAfterReopen) && /Reopened|responsibility|Notes updated/i.test(purposeAfterReopen));

	// ----------------------------------------------------------- HTML escaping
	const purposeNow = await (await alice.get(purposePath)).text();
	const escapeWrite = await alice.postForm(`${purposePath}?/notes`, {
		csrf_token: purposeCsrf,
		revision: String(revisionOf(purposeNow)),
		notes: '<script>alert(1)</script>'
	});
	check('a stored script payload is accepted as text', escapeWrite.status === 303, String(escapeWrite.status));
	const escaped = await (await alice.get(purposePath)).text();
	check(
		'stored Markdown is escaped on render',
		!escaped.includes('<script>alert(1)') && escaped.includes('&lt;script&gt;alert(1)'),
		'payload not escaped'
	);

	// ------------------------------------------------ purpose discussion + mail
	const bobPurpose = await (await bob.get(purposePath)).text();
	const message = await bob.postForm(`${purposePath}?/message`, {
		csrf_token: csrfFrom(bobPurpose) ?? bobCsrf,
		body: 'DEMO: invoice number 42, cc @alice'
	});
	check('a discussion message is accepted', message.status === 303, String(message.status));
	const withMessage = await (await alice.get(purposePath)).text();
	check('the message is rendered with its author', withMessage.includes('DEMO: invoice number 42') && withMessage.includes('Bob'));

	// --------------------------------------------------------- evidence upload
	const purposeForEvidence = await (await alice.get(purposePath)).text();
	const upload = await postMultipart(
		alice,
		`${purposePath}?/evidence`,
		{ csrf_token: purposeCsrf, revision: String(revisionOf(purposeForEvidence)), note: 'DEMO: synthetic evidence' },
		{ file: syntheticPdf('evidence') }
	);
	check('purpose evidence upload is accepted', upload.status === 303, String(upload.status));
	const withEvidence = await (await alice.get(purposePath)).text();
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
	const foreignPurpose = await alice.get('/org/demo-indonesia/purposes/1');
	check('a non-member is denied another organization\'s purposes', foreignPurpose.status === 403, String(foreignPurpose.status));

	// -------------------------------------------------------------- suppression
	const txnNow = await (await alice.get(detailPath)).text();
	const txnRevision = String(revisionOf(txnNow));
	const noReason = await alice.postForm(`${detailPath}?/suppress`, {
		csrf_token: csrf,
		revision: txnRevision,
		reason: ''
	});
	check('suppression without a reason is refused', noReason.status === 400, String(noReason.status));
	const suppressed = await alice.postForm(`${detailPath}?/suppress`, {
		csrf_token: csrf,
		revision: txnRevision,
		reason: 'DEMO: settlement in progress'
	});
	check('suppression with a reason is recorded', suppressed.status === 303, String(suppressed.status));
	const suppressedHtml = await (await alice.get(detailPath)).text();
	check('the suppressed state is visible', suppressedHtml.includes('Suppressed'));
	check('suppression does not imply completion', suppressedHtml.includes('Needs details'));
	const resumed = await alice.postForm(`${detailPath}?/unsuppress`, {
		csrf_token: csrf,
		revision: String(Number(txnRevision) + 1)
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
