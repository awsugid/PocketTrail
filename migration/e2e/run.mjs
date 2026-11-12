// Runtime security and authorization checks for the migration slice.
//
// Boots the real Worker through e2e/harness.mjs and drives it over HTTP, so
// these are checks against the deployed shape of the application rather than
// against mocks.

import { createHmac } from 'node:crypto';

import {
	Client,
	ORIGIN,
	OTHER_SECRET,
	SECRET,
	extractCsrf,
	rawRequest,
	setCookies,
	withWorker
} from './harness.mjs';

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
	if (condition) {
		results.push(`  ok   ${name}`);
		return true;
	}
	failures += 1;
	results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	return false;
}

await withWorker(async () => {
	await runChecks();
});

process.stdout.write(`${results.join('\n')}\n`);
if (failures > 0) {
	process.stdout.write(`\n${failures} check(s) failed. Worker log: .wrangler/dev.log\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(`\nAll ${results.length} runtime checks passed.\n`);
}

async function runChecks() {
	// ---------------------------------------------------------------- bindings
	const anon = new Client();
	const health = await anon.get('/healthz');
	const healthBody = await health.text();
	check('healthz reports liveness', health.status === 200 && healthBody.startsWith('ok'), healthBody);
	check(
		'healthz proves local D1 and R2 bindings are wired',
		healthBody.includes('bindings=db,documents,session-key'),
		healthBody
	);

	// ------------------------------------------------------- unauthenticated access
	const noSession = await anon.get('/orgs');
	check(
		'unauthenticated /orgs redirects to /login',
		noSession.status === 303 && noSession.headers.get('location') === '/login',
		`${noSession.status} ${noSession.headers.get('location')}`
	);

	const noSessionLedger = await anon.get('/org/demo-jakarta/ledger');
	check(
		'unauthenticated ledger redirects to /login',
		noSessionLedger.status === 303 &&
			noSessionLedger.headers.get('location') === '/login',
		`${noSessionLedger.status} ${noSessionLedger.headers.get('location')}`
	);

	// ------------------------------------------------------------- fixture sign-in
	const alice = new Client();
	const loginPage = await alice.get('/login');
	const loginHtml = await loginPage.text();
	check('login page renders', loginPage.status === 200, String(loginPage.status));
	check(
		'login sets a pre-authentication challenge cookie',
		setCookies(loginPage).some((cookie) => cookie.startsWith('pt_session=')),
		setCookies(loginPage).join(' | ')
	);
	const loginCsrf = extractCsrf(loginHtml);
	check('login page carries a CSRF token', loginCsrf !== null);
	check(
		'local fixture identities are listed on loopback',
		loginHtml.includes('Alice (fixture)') && loginHtml.includes('Bob (fixture)'),
		'fixture list missing'
	);

	// Sign-in must be rejected without the challenge cookie.
	const noChallenge = new Client();
	const bare = await noChallenge.postForm('/login?/dev', {
		csrf_token: loginCsrf ?? '',
		user_id: 'alice'
	});
	check(
		'fixture sign-in without a challenge cookie is rejected',
		bare.status === 403,
		String(bare.status)
	);

	// Sign-in must be rejected with a wrong CSRF token.
	const wrongCsrf = await alice.postForm('/login?/dev', {
		csrf_token: '0'.repeat(32),
		user_id: 'alice'
	});
	check(
		'fixture sign-in with a wrong CSRF token is rejected',
		wrongCsrf.status === 403,
		String(wrongCsrf.status)
	);

	// A cross-site Origin is rejected even with the correct token.
	const crossOrigin = await alice.postForm(
		'/login?/dev',
		{ csrf_token: loginCsrf ?? '', user_id: 'alice' },
		{ origin: 'https://evil.example' }
	);
	check(
		'cross-origin sign-in is rejected',
		crossOrigin.status === 403,
		String(crossOrigin.status)
	);

	// An unknown identity is rejected with the real token.
	const unknownIdentity = await alice.postForm('/login?/dev', {
		csrf_token: loginCsrf ?? '',
		user_id: 'nobody'
	});
	check(
		'unknown fixture identity is rejected',
		unknownIdentity.status === 403,
		String(unknownIdentity.status)
	);

	const signedIn = await alice.postForm('/login?/dev', {
		csrf_token: loginCsrf ?? '',
		user_id: 'alice'
	});
	check(
		'valid fixture sign-in redirects to organization selection',
		signedIn.status === 303 && signedIn.headers.get('location') === '/orgs',
		`${signedIn.status} ${signedIn.headers.get('location')}`
	);
	check(
		'session cookie is HttpOnly, Lax and scoped to the whole app',
		setCookies(signedIn).some(
			(cookie) =>
				cookie.startsWith('pt_session=') &&
				/HttpOnly/i.test(cookie) &&
				/SameSite=Lax/i.test(cookie) &&
				/Path=\//.test(cookie)
		),
		setCookies(signedIn).join(' | ')
	);

	// -------------------------------------------------------- organization choice
	const orgsPage = await alice.get('/orgs');
	const orgsHtml = await orgsPage.text();
	check('organization selection renders', orgsPage.status === 200, String(orgsPage.status));
	check(
		'only organizations with an active membership are listed',
		orgsHtml.includes('Jakarta — synthetic demo') &&
			!orgsHtml.includes('Indonesia — synthetic demo'),
		'org list is wrong'
	);

	// -------------------------------------------------------------- ledger read
	const ledger = await alice.get('/org/demo-jakarta/ledger');
	const ledgerHtml = await ledger.text();
	check('ledger renders for a member', ledger.status === 200, String(ledger.status));
	check(
		'exact money semantics survive rendering',
		ledgerHtml.includes('-Rp 1.500.000') && ledgerHtml.includes('Rp 8.500.000'),
		'amounts missing'
	);
	check(
		'ledger shows verification and responsibility facts',
		ledgerHtml.includes('Needs details') &&
			ledgerHtml.includes('Approved') &&
			ledgerHtml.includes('Demo Coffee Supplier'),
		'row facts missing'
	);
	check(
		'responses are private and not frameable',
		(ledger.headers.get('cache-control') ?? '').includes('no-store') &&
			ledger.headers.get('x-frame-options') === 'DENY' &&
			(ledger.headers.get('x-content-type-options') ?? '') === 'nosniff',
		`${ledger.headers.get('cache-control')} ${ledger.headers.get('x-frame-options')}`
	);

	const filtered = await alice.get('/org/demo-jakarta/ledger?status=needs_details');
	const filteredHtml = await filtered.text();
	check(
		'needs-details filter keeps only documentation shortfalls',
		filtered.status === 200 &&
			filteredHtml.includes('Demo Coffee Supplier') &&
			!filteredHtml.includes('Demo Venue'),
		`${filtered.status}`
	);

	// ------------------------------------------------------------- cross-org reads
	const foreignOrg = await alice.get('/org/demo-indonesia/ledger');
	check(
		'a non-member cannot read another organization\'s ledger',
		foreignOrg.status === 403,
		String(foreignOrg.status)
	);

	const ownEntry = await alice.get('/org/demo-jakarta/ledger/1');
	check('a member can open one of their organization\'s entries', ownEntry.status === 200, String(ownEntry.status));

	const missingEntry = await alice.get('/org/demo-jakarta/ledger/999999');
	check('a missing entry is not found', missingEntry.status === 404, String(missingEntry.status));

	const crossOrgEntry = await alice.get('/org/demo-jakarta/ledger/900');
	check(
		'another organization\'s entry is indistinguishable from a missing one',
		crossOrgEntry.status === 404,
		String(crossOrgEntry.status)
	);

	const crossOrgPath = await alice.get('/org/demo-indonesia/ledger/900');
	check(
		'another organization\'s path is forbidden before the entry is looked up',
		crossOrgPath.status === 403,
		String(crossOrgPath.status)
	);

	const bogusId = await alice.get('/org/demo-jakarta/ledger/not-a-number');
	check('a non-numeric entry id is not found', bogusId.status === 404, String(bogusId.status));

	// ------------------------------------------------------ cross-org data leakage
	const bob = new Client();
	const bobLogin = await bob.get('/login');
	const bobCsrf = extractCsrf(await bobLogin.text());
	await bob.postForm('/login?/dev', { csrf_token: bobCsrf ?? '', user_id: 'bob' });
	const bobOrgs = await (await bob.get('/orgs')).text();
	check(
		'a multi-organization member sees every organization they belong to',
		bobOrgs.includes('Jakarta — synthetic demo') && bobOrgs.includes('Indonesia — synthetic demo'),
		'org list is wrong for bob'
	);
	const bobForeign = await bob.get('/org/demo-jakarta/ledger/900');
	check(
		'isolation follows the organization, not the user',
		bobForeign.status === 404,
		String(bobForeign.status)
	);

	// --------------------------------------------------- membership permission gate
	const dana = new Client();
	const danaLogin = await dana.get('/login');
	const danaCsrf = extractCsrf(await danaLogin.text());
	const danaSignedIn = await dana.postForm('/login?/dev', {
		csrf_token: danaCsrf ?? '',
		user_id: 'dana'
	});
	check('a member without the ledger permission can sign in', danaSignedIn.status === 303);
	const danaLedger = await dana.get('/org/demo-jakarta/ledger');
	const danaBody = await danaLedger.text();
	check(
		'an active member whose role lacks the permission is denied',
		danaLedger.status === 403,
		String(danaLedger.status)
	);
	check(
		'the denial names the missing permission',
		danaBody.includes('View transactions'),
		'denial wording missing'
	);
	const danaOrgs = await dana.get('/orgs');
	check(
		'a denied member still sees the organization they belong to',
		danaOrgs.status === 200,
		String(danaOrgs.status)
	);

	// --------------------------------------------------------- session integrity
	const aliceCookie = alice.cookieHeader();
	check('session cookie is carried between requests', aliceCookie.includes('pt_session='));
	const value = aliceCookie.replace(/^pt_session=/, '');
	const [payload, signature] = value.split('.');

	const damaged = `${payload}.${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;
	const tampered = await fetch(`${ORIGIN}/orgs`, {
		headers: { cookie: `pt_session=${damaged}` },
		redirect: 'manual'
	});
	check(
		'a tampered session signature is rejected as unauthenticated',
		tampered.status === 303 && tampered.headers.get('location') === '/login',
		`${tampered.status} ${tampered.headers.get('location')}`
	);

	// A payload signed with a different key must not authenticate.
	const wrongKeySignature = createHmac('sha256', OTHER_SECRET).update(payload).digest('hex');
	const wrongKey = await fetch(`${ORIGIN}/orgs`, {
		headers: { cookie: `pt_session=${payload}.${wrongKeySignature}` },
		redirect: 'manual'
	});
	check(
		'a session signed with another key is rejected',
		wrongKey.status === 303 && wrongKey.headers.get('location') === '/login',
		`${wrongKey.status} ${wrongKey.headers.get('location')}`
	);

	// A correctly signed but expired session must not authenticate.
	const expiredAt = Math.floor(Date.now() / 1000) - 60;
	const expiredCsrf = createHmac('sha256', SECRET)
		.update(`csrf:alice:${expiredAt}`)
		.digest('hex')
		.slice(0, 32);
	const expiredPayload = Buffer.from(
		JSON.stringify({ uid: 'alice', csrf: expiredCsrf, exp: expiredAt }),
		'utf8'
	).toString('base64url');
	const expiredSignature = createHmac('sha256', SECRET).update(expiredPayload).digest('hex');
	const expired = await fetch(`${ORIGIN}/orgs`, {
		headers: { cookie: `pt_session=${expiredPayload}.${expiredSignature}` },
		redirect: 'manual'
	});
	check(
		'a correctly signed but expired session is rejected',
		expired.status === 303 && expired.headers.get('location') === '/login',
		`${expired.status} ${expired.headers.get('location')}`
	);

	// A correctly signed payload whose CSRF token was substituted is rejected.
	const forgedCsrfPayload = Buffer.from(
		JSON.stringify({ uid: 'alice', csrf: 'f'.repeat(32), exp: expiredAt + 3600 }),
		'utf8'
	).toString('base64url');
	const forgedCsrfSignature = createHmac('sha256', SECRET)
		.update(forgedCsrfPayload)
		.digest('hex');
	const forgedCsrf = await fetch(`${ORIGIN}/orgs`, {
		headers: { cookie: `pt_session=${forgedCsrfPayload}.${forgedCsrfSignature}` },
		redirect: 'manual'
	});
	check(
		'a signed payload with a substituted CSRF token is rejected',
		forgedCsrf.status === 303 && forgedCsrf.headers.get('location') === '/login',
		`${forgedCsrf.status} ${forgedCsrf.headers.get('location')}`
	);

	// ------------------------------------------------------------ loopback gate
	const loopbackPostBody = new URLSearchParams({
		csrf_token: loginCsrf ?? '',
		user_id: 'alice'
	}).toString();
	const loopbackGate = await rawRequest('pockettrail.example', {
		method: 'POST',
		path: '/login?/dev',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			// The attacker controls Host and Origin consistently; the loopback
			// gate must still refuse.
			origin: 'http://pockettrail.example',
			'sec-fetch-site': 'same-origin'
		},
		body: loopbackPostBody
	});
	check(
		'a public Host header cannot reach fixture sign-in',
		loopbackGate.status === 403 && loopbackGate.body.includes('loopback'),
		`${loopbackGate.status} ${loopbackGate.body.slice(0, 160)}`
	);
	const publicLoginPage = await rawRequest('pockettrail.example', { path: '/login' });
	check(
		'a public Host header does not list fixture identities',
		publicLoginPage.status === 200 && !publicLoginPage.body.includes('Alice (fixture)'),
		String(publicLoginPage.status)
	);
	const publicHealth = await rawRequest('pockettrail.example', { path: '/healthz' });
	check(
		'a public Host header learns nothing beyond liveness',
		publicHealth.body.trim() === 'ok',
		publicHealth.body.trim()
	);

	// -------------------------------------------------------------------- logout
	const orgsForCsrf = await (await alice.get('/orgs')).text();
	const sessionCsrf = extractCsrf(orgsForCsrf);
	check('authenticated pages carry the session CSRF token', sessionCsrf !== null);
	const staleLogout = await alice.postForm('/logout', { csrf_token: loginCsrf ?? 'x' });
	check(
		'logout with a stale challenge token is rejected',
		staleLogout.status === 403,
		String(staleLogout.status)
	);
	const logout = await alice.postForm('/logout', { csrf_token: sessionCsrf ?? '' });
	check(
		'logout with the session token redirects to sign-in',
		logout.status === 303 && logout.headers.get('location') === '/login',
		`${logout.status} ${logout.headers.get('location')}`
	);
	check(
		'logout clears the session cookie',
		setCookies(logout).some(
			(cookie) => cookie.startsWith('pt_session=;') || /max-age=0/i.test(cookie)
		),
		setCookies(logout).join(' | ')
	);
	const afterLogout = await alice.get('/orgs');
	check(
		'the cleared session no longer authenticates',
		afterLogout.status === 303 && afterLogout.headers.get('location') === '/login',
		`${afterLogout.status} ${afterLogout.headers.get('location')}`
	);
}
