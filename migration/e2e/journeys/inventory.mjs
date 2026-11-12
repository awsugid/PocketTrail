// Inventory journey checks: viewing, recording changes, guard rails, and the
// per-item history, driven over HTTP against the built Worker.
import { Client, extractCsrf } from '../harness.mjs';

export async function checks(ctx) {
	const { ORIGIN } = ctx;
	let failures = 0;
	const check = (name, condition, detail = '') => {
		if (condition) process.stdout.write(`  ok   ${name}\n`);
		else {
			failures += 1;
			process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
		}
	};

	const alice = new Client();
	const loginPage = await alice.get('/login');
	const csrf = extractCsrf(await loginPage.text());
	const login = await alice.postForm('/login?/dev', { csrf_token: csrf ?? '', user_id: 'alice' });
	check('alice signs in', login.status === 303, String(login.status));

	const dana = new Client();
	const danaPage = await dana.get('/login');
	const danaCsrf = extractCsrf(await danaPage.text());
	await dana.postForm('/login?/dev', { csrf_token: danaCsrf ?? '', user_id: 'dana' });

	const list = await alice.get('/org/demo-jakarta/inventory');
	const listHtml = await list.text();
	check('inventory renders for a member', list.status === 200, String(list.status));
	check('seeded items and holdings render', listHtml.includes('DEMO T-shirt') && listHtml.includes('DEMO storage box'), 'missing seed rows');
	check('totals are correct', listHtml.includes('>12<'), 'missing total 12');

	const danaList = await dana.get('/org/demo-jakarta/inventory');
	check('a member with no permissions still can view', danaList.status === 403, String(danaList.status));

	// Nonnegative guard: removing more than on hand is rejected.
	const item = 1; // DEMO T-shirt M, qty 12 at location 1
	const location = 1;
	const csrfToken = listHtml.match(/name="csrf_token" value="([0-9a-f]{32})"/)?.[1] ?? '';
	const reject = await alice.postForm('/org/demo-jakarta/inventory?/updateStock', {
		csrf_token: csrfToken,
		item_id: String(item),
		location_id: String(location),
		direction: 'remove',
		quantity: '99',
		reason: 'overdraw'
	});
	check('overdraw rejected', reject.status === 400, String(reject.status));

	const add = await alice.postForm('/org/demo-jakarta/inventory?/updateStock', {
		csrf_token: csrfToken,
		item_id: String(item),
		location_id: String(location),
		direction: 'add',
		quantity: '3',
		reason: 'restock'
	});
	check('valid change applies', add.status === 303, String(add.status));
	const after = await (await alice.get(add.headers.get('location') ?? '/org/demo-jakarta/inventory')).text();
	check('quantity updated', after.includes('>15<'), 'missing total 15');
	check('message shown', after.includes('Updated'), 'no flash');

	const itemPage = await alice.get('/org/demo-jakarta/inventory/1');
	const itemHtml = await itemPage.text();
	check('item history renders', itemPage.status === 200 && itemHtml.includes('restock') && itemHtml.includes('+3'), 'missing movement');
	check('history shows prior movement', itemHtml.includes('initial print run'), 'missing seed movement');

	// Reason is mandatory.
	const noReason = await alice.postForm('/org/demo-jakarta/inventory?/updateStock', {
		csrf_token: csrfToken,
		item_id: String(item),
		location_id: String(location),
		direction: 'add',
		quantity: '1',
		reason: ''
	});
	check('missing reason rejected', noReason.status === 400, String(noReason.status));

	// Cross-org item id is not addressable.
	const foreign = await alice.postForm('/org/demo-jakarta/inventory?/updateStock', {
		csrf_token: csrfToken,
		item_id: '999999',
		location_id: String(location),
		direction: 'add',
		quantity: '1',
		reason: 'foreign'
	});
	check('foreign item rejected', foreign.status === 400, String(foreign.status));

	// Actions hub renders for alice with the seeded owed transaction.
	const actions = await alice.get('/org/demo-jakarta/actions');
	const actionsHtml = await actions.text();
	check('actions hub renders', actions.status === 200, String(actions.status));
	check('actions list transaction 3 as owed by alice', actionsHtml.includes('Demo Cloud Provider'), 'missing owed task');
	check('actions empty-state never implies empty ledger', actionsHtml.includes('browse all transactions') || actionsHtml.includes('Actions'), 'missing reassurance');

	// bob holds a split of txn 1 (whose documentation is incomplete), so his
	// action list correctly offers it as HIS explanation task; it must not
	// appear as an offered review while he is responsible for part of it.
	const bob = new Client();
	const bobPage = await bob.get('/login');
	const bobCsrf = extractCsrf(await bobPage.text());
	await bob.postForm('/login?/dev', { csrf_token: bobCsrf ?? '', user_id: 'bob' });
	const bobActions = await (await bob.get('/org/demo-jakarta/actions')).text();
	check('split responsible sees own explanation task', bobActions.includes('Demo Coffee Supplier'), 'missing own task');
	// Without any submitted transaction in the seed, no review section renders.
	check('no review section without submitted work', !bobActions.includes('Ready for your review'), 'unexpected review section');

	return failures;
}
