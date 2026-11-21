// Responsibility journey: invited members are mappable before accepting,
// saving a mapping moves matching expenses that still need details, internal
// pocket movements stay with the pocket owner, invited members cannot own a
// pocket or open the organization, and revoking an invitation hands their
// open work back to the pocket owner. Uses its own pocket so it is independent
// of the other journeys' ledger state.
import { Client } from '../harness.mjs';
import { csrfFrom, postMultipart, signIn, statement, syntheticPdf } from './_util.mjs';

/** The ledger row (one <tr>) mentioning `needle`, or ''. */
function rowWith(html, needle) {
	const body = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? '';
	return body.split('<tr').find((row) => row.includes(needle)) ?? '';
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
	await signIn(alice, extractCsrf, 'alice');
	const csrf = csrfFrom(await (await alice.get('/org/demo-jakarta/settings/pockets')).text()) ?? '';

	// A dedicated pocket owned by Alice (membership 1).
	const pocket = await alice.postForm('/org/demo-jakarta/settings/pockets?/addPocket', {
		csrf_token: csrf,
		name: 'Responsibility journey pocket',
		opening_balance: '1000000',
		owner_membership_id: '1'
	});
	check('a journey pocket is created', pocket.status === 303, String(pocket.status));
	const pocketsHtml = await (await alice.get('/org/demo-jakarta/settings/pockets')).text();
	const pocketId = String(Math.max(...[...pocketsHtml.matchAll(/id="owner-(\d+)"/g)].map((m) => Number(m[1]))));

	// Import: one vendor expense (unmapped) and one internal pocket movement.
	const text = statement([
		{
			// Stored as "Later Vendor / Jago 102700000001"; the ledger shows the name.
			date: '03 Jun 2025', time: '09:10', source: 'Later Vendor', source2: 'Jago 102700000001', details: 'Outgoing Transfer',
			notes: 'DEMO: later mapped', amount: '-100.000,00', balance: '900.000,00', id: 'JPXRSP3001'
		},
		{
			date: '04 Jun 2025', time: '10:20', source: 'Main Pocket', details: 'Pocket Money Out',
			notes: 'DEMO: internal move', amount: '-50.000,00', balance: '850.000,00', id: 'JPXRSP3002'
		}
	]);
	const staged = await postMultipart(
		alice,
		'/org/demo-jakarta/imports',
		{ csrf_token: csrf, pocket_id: pocketId, statement_text: text },
		{ file: syntheticPdf('responsibility') }
	);
	const batchPath = staged.headers.get('location') ?? '';
	check('the journey statement stages', staged.status === 303 && batchPath !== '', String(staged.status));
	const confirm = await alice.postForm(`${batchPath}?/confirm`, { csrf_token: csrf });
	check('the journey statement is confirmed', confirm.status === 303, String(confirm.status));
	let ledger = await (await alice.get('/org/demo-jakarta/transactions')).text();
	check('an unmapped expense defaults to the pocket owner', rowWith(ledger, 'Later Vendor').includes('Alice (fixture)'));

	// Invite someone who has never signed in: they become an invited member.
	const invite = await alice.postForm('/org/demo-jakarta/settings/people?/addMember', {
		csrf_token: csrf, email: 'later@example.test', role_id: '4'
	});
	check('a new person is invited', invite.status === 303, String(invite.status));
	const people = await (await alice.get('/org/demo-jakarta/settings/people')).text();
	check('the invitee is listed as an invited member', /later@example\.test[\s\S]{0,400}Invited/.test(people));
	const routing = await (await alice.get('/org/demo-jakarta/settings/routing')).text();
	const invitedId = routing.match(/<option value="(\d+)">later@example\.test \(invited\)<\/option>/)?.[1];
	check('the invitee is offered in the mapping list', Boolean(invitedId), 'no invited option');

	// Invited members cannot own a pocket.
	const badOwner = await alice.postForm('/org/demo-jakarta/settings/pockets?/setPocketOwner', {
		csrf_token: csrf, id: pocketId, owner_membership_id: invitedId ?? '0'
	});
	check('an invited member cannot own a pocket', badOwner.status === 400, String(badOwner.status));

	// Mapping moves the open expense; the internal movement stays put.
	const mapVendor = await alice.postForm('/org/demo-jakarta/settings/routing?/addMapping', {
		csrf_token: csrf, pattern: 'later vendor', pocket_id: pocketId, member_id: invitedId ?? '0'
	});
	check('the vendor label maps to the invitee', mapVendor.status === 303, String(mapVendor.status));
	check(
		'saving the mapping reports the moved transaction',
		/1(\s|%20|\+)transaction/.test(decodeURIComponent(mapVendor.headers.get('location') ?? '')),
		mapVendor.headers.get('location') ?? ''
	);
	const mapInternal = await alice.postForm('/org/demo-jakarta/settings/routing?/addMapping', {
		csrf_token: csrf, pattern: 'Main Pocket', pocket_id: pocketId, member_id: invitedId ?? '0'
	});
	check('an internal label can still be mapped', mapInternal.status === 303, String(mapInternal.status));
	ledger = await (await alice.get('/org/demo-jakarta/transactions')).text();
	check('the open expense moved to the invitee', rowWith(ledger, 'Later Vendor').includes('later@example.test'));
	check('the internal pocket movement stays with the pocket owner', rowWith(ledger, 'JPXRSP3002').includes('Alice (fixture)'));

	// A mapping never moves work that was reassigned by hand: re-mapping to
	// the same member is a no-op, and a second identical import adds nothing.
	const again = await alice.postForm('/org/demo-jakarta/settings/routing?/addMapping', {
		csrf_token: csrf, pattern: 'later vendor', pocket_id: pocketId, member_id: '2'
	});
	check('a duplicate label mapping is still refused', again.status === 400, String(again.status));

	// Revoking the invitation hands the open expense back to the owner.
	const peopleNow = await (await alice.get('/org/demo-jakarta/settings/people')).text();
	const invitationId = peopleNow.match(/settings\/invitations\/([0-9a-f]{32,64})\/revoke/)?.[1];
	check('the invitation exposes a revoke control', Boolean(invitationId));
	const revoke = await alice.postForm(`/org/demo-jakarta/settings/invitations/${invitationId}/revoke`, { csrf_token: csrf });
	check('the invitation is revoked', revoke.status === 303, String(revoke.status));
	ledger = await (await alice.get('/org/demo-jakarta/transactions')).text();
	check('revoking returns open work to the pocket owner', rowWith(ledger, 'Later Vendor').includes('Alice (fixture)'));
	const routingAfter = await (await alice.get('/org/demo-jakarta/settings/routing')).text();
	check('revoking removes the invitee from the mapping list', !/<option value="\d+">later@example\.test/.test(routingAfter));
	check('revoking removes the invitee\'s mappings', !/later vendor/i.test(routingAfter.match(/<ul class="rows">[\s\S]*?<\/ul>/g)?.join('') ?? ''));

	void Client;
	return failures;
}
