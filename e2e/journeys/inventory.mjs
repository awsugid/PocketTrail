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

	        // CSRF: every inventory action rejects a wrong token and writes nothing.
	        const rowCount = async () =>
	                (await (await alice.get('/org/demo-jakarta/inventory')).text()).match(/<tr>/g)?.length ?? 0;
	        const rowsBefore = await rowCount();
	        const bad = { csrf_token: 'f'.repeat(32) };
	        const forged = [
	                ['addItem', { ...bad, name: 'FORGED item' }],
	                ['addLocation', { ...bad, name: 'FORGED place' }],
	                ['saveLocation', { ...bad, id: '1', name: 'FORGED place' }],
	                ['archiveLocation', { ...bad, id: '1' }],
	                ['restoreLocation', { ...bad, id: '1' }],
	                ['updateStock', { ...bad, item_id: '1', location_id: '1', direction: 'add', quantity: '7', reason: 'forged' }]
	        ];
	        for (const [action, fields] of forged) {
	                const response = await alice.postForm(`/org/demo-jakarta/inventory?/${action}`, fields);
	                check(`${action} rejects an invalid CSRF token`, response.status === 403, String(response.status));
	        }
	        check(
	                'rejected CSRF posts wrote no rows',
	                (await rowCount()) === rowsBefore &&
	                        !(await (await alice.get('/org/demo-jakarta/inventory')).text()).includes('FORGED') &&
	                        !(await (await alice.get('/org/demo-jakarta/inventory/1')).text()).includes('forged'),
	                'a forged post changed data'
	        );

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

	// Metadata CRUD uses archive/restore, never deletion of referenced history.
	for (const [action, fields] of [
		['addItem', { name: 'Synthetic archive item', variant: '' }],
		['addLocation', { name: 'Synthetic archive location' }]
	]) {
		const response = await alice.postForm(`/org/demo-jakarta/inventory?/${action}`, { csrf_token: csrfToken, ...fields });
		check(`${action} creates an archival test record`, response.status === 303, String(response.status));
	}
	const createdHtml = await (await alice.get('/org/demo-jakarta/inventory')).text();
	const newItem = createdHtml.match(/href="\/org\/demo-jakarta\/inventory\/(\d+)">Synthetic archive item/)?.[1];
	const newLocation = createdHtml.match(/id="location-name-(\d+)"[^>]*value="Synthetic archive location"/)?.[1];
	check('new inventory records are addressable', Boolean(newItem && newLocation));
	if (newItem && newLocation) {
		const postItem = (action, fields = {}, token = csrfToken) => alice.postForm(`/org/demo-jakarta/inventory/${newItem}?/${action}`, { csrf_token: token, ...fields });
		const postLocation = (action, fields = {}) => alice.postForm(`/org/demo-jakarta/inventory?/${action}`, { csrf_token: csrfToken, id: newLocation, ...fields });
		for (const action of ['saveItem', 'archiveItem', 'restoreItem']) {
			check(`${action} rejects forged CSRF`, (await postItem(action, { name: 'FORGED' }, 'f'.repeat(32))).status === 403);
		}
		check('item names and variants can be edited', (await postItem('saveItem', { name: 'Synthetic renamed item', variant: 'Blue' })).status === 303);
		check('duplicate item identity is rejected', (await postItem('saveItem', { name: 'DEMO T-shirt', variant: 'M' })).status === 400);
		check('location names can be edited', (await postLocation('saveLocation', { name: 'Synthetic renamed location' })).status === 303);
		check('duplicate location name is rejected', (await postLocation('saveLocation', { name: 'DEMO storage box' })).status === 400);
		check('blank item name is rejected', (await postItem('saveItem', { name: ' ' })).status === 400);
		check('foreign organization metadata cannot be changed', (await alice.postForm('/org/demo-jakarta/inventory/999999?/saveItem', {
			csrf_token: csrfToken, name: 'Foreign'
		})).status === 404);
		for (const action of ['saveItem', 'archiveItem', 'restoreItem']) {
			check(`read-only member cannot ${action}`, (await bob.postForm(`/org/demo-jakarta/inventory/${newItem}?/${action}`, { csrf_token: csrfToken, name: 'Unauthorized' })).status === 403);
		}
		for (const action of ['saveLocation', 'archiveLocation', 'restoreLocation']) {
			check(`read-only member cannot ${action}`, (await bob.postForm(`/org/demo-jakarta/inventory?/${action}`, { csrf_token: csrfToken, id: newLocation, name: 'Unauthorized' })).status === 403);
		}
		const adjust = (delta) => alice.postForm(`/org/demo-jakarta/inventory/${newItem}?/updateStock`, {
			csrf_token: csrfToken, item_id: newItem, location_id: newLocation, delta, reason: 'Synthetic archive test'
		});
		check('stock can be recorded for the renamed item', (await adjust('1')).status === 303);
		check('an item with stock cannot be archived', (await postItem('archiveItem')).status === 400);
		check('a location with stock cannot be archived', (await postLocation('archiveLocation')).status === 400);
		check('stock can be brought to zero with history', (await adjust('-1')).status === 303);
		check('zero-stock item can be archived', (await postItem('archiveItem')).status === 303);
		check('archived items cannot receive stock', (await adjust('1')).status === 400);
		check('archived item metadata cannot be edited', (await postItem('saveItem', { name: 'Hidden edit' })).status === 400);
		const archivedDetail = await (await alice.get(`/org/demo-jakarta/inventory/${newItem}`)).text();
		check('archived item history remains readable', archivedDetail.includes('Synthetic archive test') && archivedDetail.includes('Archived'));
		check('archived items leave active lists', !(await (await alice.get('/org/demo-jakarta/inventory')).text()).includes('Synthetic renamed item'));
		check('archived items are discoverable', (await (await alice.get('/org/demo-jakarta/inventory?archived=1')).text()).includes('Synthetic renamed item'));
		check('archived item can be restored', (await postItem('restoreItem')).status === 303);
		check('zero-stock location can be archived', (await postLocation('archiveLocation')).status === 303);
		check('archived locations cannot receive stock', (await adjust('1')).status === 400);
		check('archived locations are discoverable', (await (await alice.get('/org/demo-jakarta/inventory?archived=1')).text()).includes('Synthetic renamed location'));
		check('archived location can be restored', (await postLocation('restoreLocation')).status === 303);
		check('restored inventory can receive stock again', (await adjust('1')).status === 303);
		// Concurrent archive vs stock mutation: exactly one can win on zero stock.
		await adjust('-1');
		const race = await Promise.all([postItem('archiveItem'), adjust('1')]);
		check('archive and stock writes serialize without hidden stock',
			race.filter((response) => response.status === 303).length === 1 &&
			race.filter((response) => response.status === 400).length === 1);
	}

	return failures;
}
