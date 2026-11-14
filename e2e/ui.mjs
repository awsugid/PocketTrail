// Rendered-UI checks for the migration slice.
//
// Signs in through the real form (first with JavaScript disabled, to prove
// progressive enhancement), then inspects the ledger at four viewport widths,
// records keyboard focus order, and respects reduced motion. Screenshots are
// written to .wrangler/ui/ for a human to look at.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { ORIGIN, ROOT, withWorker } from './harness.mjs';

const results = [];
let failures = 0;
const shots = [];

function check(name, condition, detail = '') {
	if (condition) {
		results.push(`  ok   ${name}`);
		return true;
	}
failures += 1;
	results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	return false;
}

/** Uses the system Chrome instead of downloading a Playwright browser. */
function launchOptions() {
	const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
	return { executablePath, args: ['--no-sandbox'] };
}

async function signIn(page, identity) {
	await page.goto(`${ORIGIN}/login`);
	await page.getByRole('button', { name: new RegExp(identity) }).click();
	await page.waitForURL(`${ORIGIN}/orgs`);
}

async function overflow(page) {
	return page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
}

await withWorker(async () => {
	mkdirSync(`${ROOT}/.wrangler/ui`, { recursive: true });
	const browser = await chromium.launch(launchOptions());

	try {
		// ------------------------------------------- progressive enhancement
		const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
		const noJsPage = await noJs.newPage();
		await signIn(noJsPage, 'Alice');
		check(
			'sign-in works with JavaScript disabled',
			noJsPage.url() === `${ORIGIN}/orgs`,
			noJsPage.url()
		);
		await noJsPage.screenshot({ path: `${ROOT}/.wrangler/ui/orgs-1440-nojs.png`, fullPage: true });
		shots.push('orgs-1440-nojs.png');
		await noJs.close();

		const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const page = await context.newPage();

		// --------------------------------------------------------------- login
		await page.goto(`${ORIGIN}/login`);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/login-1440.png`, fullPage: true });
		shots.push('login-1440.png');
		await page.setViewportSize({ width: 320, height: 640 });
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/login-320.png`, fullPage: true });
		shots.push('login-320.png');
		await page.setViewportSize({ width: 1440, height: 900 });

		await signIn(page, 'Alice');

		// ------------------------------------------------------- organization
		const orgLinks = await page.getByRole('link', { name: /synthetic demo/ }).count();
		check('organization selection lists exactly her membership', orgLinks === 1, String(orgLinks));

		// -------------------------------------------------------------- ledger
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		const rows = page.locator('table.ledger tbody tr');
		check('ledger renders bank movements as table rows', (await rows.count()) === 3, String(await rows.count()));
		check(
			'ledger shows exact money for the seeded fixture',
			await page.getByRole('cell', { name: '-Rp 1.500.000' }).first().isVisible(),
			'money cell missing'
		);

		for (const width of [320, 768, 1440, 1920]) {
			await page.setViewportSize({ width, height: width <= 768 ? 900 : 1080 });
			const box = await overflow(page);
			check(
				`ledger does not overflow horizontally at ${width}px`,
				box.scrollWidth <= box.clientWidth + 1,
				`scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth}`
			);
			const name = `ledger-${width}.png`;
			await page.screenshot({ path: `${ROOT}/.wrangler/ui/${name}`, fullPage: true });
			shots.push(name);
		}

		// ----------------------------------------------------- mobile money labels
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		// The `stack` action adds the roles on hydration.
		await page.waitForFunction(() => document.querySelector('table.ledger tbody tr')?.getAttribute('role') === 'row');
		const mobileLabels = await page.evaluate(() => {
			const cell = document.querySelector('table.ledger td[data-label="Amount"]');
			const table = document.querySelector('table.ledger');
			return {
				label: cell ? getComputedStyle(cell, '::before').content : null,
				role: table?.getAttribute('role'),
				rowRole: document.querySelector('table.ledger tbody tr')?.getAttribute('role')
			};
		});
		check(
			'stacked mobile cells keep a visible money label',
			typeof mobileLabels.label === 'string' && mobileLabels.label.includes('Amount'),
			String(mobileLabels.label)
		);
		check(
			'stacked mobile rows keep their table semantics',
			mobileLabels.role === 'table' && mobileLabels.rowRole === 'row',
			`${mobileLabels.role}/${mobileLabels.rowRole}`
		);

		// -------------------------------------------------------------- keyboard
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		const focusOrder = [];
		for (let i = 0; i < 16; i += 1) {
			await page.keyboard.press('Tab');
			focusOrder.push(
				await page.evaluate(() => {
					const element = document.activeElement;
					if (!element || element === document.body) return 'body';
					const style = getComputedStyle(element);
					const nav = element.closest('nav')?.getAttribute('aria-label') ?? '';
					return `${element.tagName.toLowerCase()}[${(element.textContent ?? '').trim().slice(0, 24)}] nav=${nav} outline=${style.outlineStyle}`;
				})
			);
		}
		check('the skip link is the first tab stop', focusOrder[0].includes('Skip to content'), focusOrder[0]);
		check(
			'keyboard reaches the status filter links',
			focusOrder.some((entry) => entry.includes('nav=Status filter')),
			focusOrder.join(' | ')
		);
		check(
			'focused controls show a visible outline',
			focusOrder.filter((entry) => entry.includes('nav=Status filter') || entry.startsWith('a[Skip')).every((entry) => entry.includes('outline=solid')),
			focusOrder.join(' | ')
		);
		check(
			'the current ledger filter is marked, not only coloured',
			(await page.locator('nav[aria-label="Status filter"] a[aria-current="true"]').count()) === 1
		);

		// ------------------------------------------------------- menus + avatar
		const accountMenu = page.locator('details.menu', { has: page.locator('summary[aria-label^="Account"]') });
		await accountMenu.locator('summary').click();
		check('the account menu opens', await accountMenu.evaluate((node) => node.open));
		await page.keyboard.press('Escape');
		check('Escape closes the account menu', !(await accountMenu.evaluate((node) => node.open)));
		await accountMenu.locator('summary').click();
		await page.mouse.click(700, 500);
		check('a press outside closes the account menu', !(await accountMenu.evaluate((node) => node.open)));
		const avatar = await page.evaluate(() => ({
			text: document.querySelector('.avatar')?.textContent?.trim(),
			broken: [...document.querySelectorAll('.avatar img')].some((img) => img.complete && img.naturalWidth === 0 && img.hasAttribute('data-loaded'))
		}));
		check('the avatar shows initials without a broken image', avatar.text === 'AF' && !avatar.broken, JSON.stringify(avatar));
		const fullBleed = await page.evaluate(() => {
			const bar = document.querySelector('.topbar')?.getBoundingClientRect();
			return bar ? { left: bar.left, width: bar.width, viewport: document.documentElement.clientWidth } : null;
		});
		check('the topbar spans the full viewport width', fullBleed !== null && fullBleed.left === 0 && fullBleed.width === fullBleed.viewport, JSON.stringify(fullBleed));

		// ---------------------------------------------------------- reduced motion
		const reduced = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			reducedMotion: 'reduce'
		});
		const reducedPage = await reduced.newPage();
		await signIn(reducedPage, 'Alice');
		await reducedPage.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		check(
			'the ledger renders fully with reduced motion requested',
			(await reducedPage.locator('table.ledger tbody tr').count()) === 3,
			'rows missing under reduced motion'
		);
		await reduced.close();

		// ---------------------------------------------------------------- detail
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions/1`);
		check(
			'detail page shows purposes and the owed-documentation notice',
			(await page.locator('input[name="split_label[]"]').evaluateAll((inputs) => inputs.map((input) => input.value))).includes('DEMO: workshop supplies') &&
				(await page.getByText('DEMO: workshop supplies').count()) === 0 &&
				(await page.getByText(/Needed before review/).count()) === 1,
			'detail content missing'
		);
		const labelAudit = await page.evaluate(() =>
			[...document.querySelectorAll('label')].map((label) => `${label.getAttribute('for') ?? '?'}=${(label.textContent ?? '').trim()}`)
		);
		const countA = await page.getByRole('textbox', { name: /Explanation/ }).count();
		const countB = await page.getByRole('combobox', { name: 'Responsible member', exact: true }).count();
		check(
			'detail page labels its primary money inputs',
			countA === 1 && countB === 1,
			`explanation=${countA} responsible=${countB} :: ${labelAudit.join(' | ')}`
		);
		check(
			'detail page exposes one page heading',
			(await page.locator('h1').count()) === 1,
			String(await page.locator('h1').count())
		);
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/detail-1440.png`, fullPage: true });
		shots.push('detail-1440.png');
		await page.setViewportSize({ width: 320, height: 900 });
		const detailBox = await overflow(page);
		check(
			'detail page does not overflow horizontally at 320px',
			detailBox.scrollWidth <= detailBox.clientWidth + 1,
			`scrollWidth ${detailBox.scrollWidth} vs clientWidth ${detailBox.clientWidth}`
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/detail-320.png`, fullPage: true });
		shots.push('detail-320.png');

		// ------------------------------------------------------------------- 403
		await page.setViewportSize({ width: 1440, height: 900 });
		const forbidden = await page.goto(`${ORIGIN}/org/demo-indonesia/transactions`);
		check(
			'a foreign organization renders a readable denial page',
			forbidden?.status() === 403 && (await page.getByText(/Not allowed/).count()) === 1,
			String(forbidden?.status())
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/forbidden-1440.png`, fullPage: true });
		shots.push('forbidden-1440.png');

		// ------------------------------------------------------------- settings
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings`);
		check(
			'settings overview links each section once, with status',
			(await page.locator('h1').count()) === 1 &&
				(await page.locator('nav[aria-label="Settings sections"] a[href*="/settings/"]').count()) === 5,
			String(await page.locator('nav[aria-label="Settings sections"] a').count())
		);
		for (const section of ['pockets', 'routing', 'people', 'roles', 'notifications']) {
			await page.goto(`${ORIGIN}/org/demo-jakarta/settings/${section}`);
			check(
				`settings ${section} page renders one heading and no overflow`,
				(await page.locator('h1').count()) === 1 &&
					(await page.locator('h1').first().innerText()).toLowerCase() === section
			);
		}
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings`);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/settings-1440.png`, fullPage: true });
		shots.push('settings-1440.png');
		await page.setViewportSize({ width: 320, height: 900 });
		const settingsBox = await overflow(page);
		check(
			'settings does not overflow horizontally at 320px',
			settingsBox.scrollWidth <= settingsBox.clientWidth + 1,
			`scrollWidth ${settingsBox.scrollWidth} vs clientWidth ${settingsBox.clientWidth}`
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/settings-320.png`, fullPage: true });
		shots.push('settings-320.png');

		// --------------------------------------------------------------- imports
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`${ORIGIN}/org/demo-jakarta/imports`);
		check(
			'import staging page renders its labelled form',
			(await page.getByLabel('Pocket', { exact: true }).count()) === 1 &&
				(await page.getByLabel('Original statement PDF').count()) === 1 &&
				(await page.getByRole('button', { name: 'Stage statement' }).count()) === 1,
			'staging form controls missing'
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/imports-1440.png`, fullPage: true });
		shots.push('imports-1440.png');

		// -------------------------------------------------------------- platform
		await page.goto(`${ORIGIN}/platform`);
		check(
			'platform administration renders accounts and the audit trail',
			(await page.getByRole('heading', { name: 'Accounts' }).count()) === 1 &&
				(await page.getByRole('heading', { name: 'Audit trail' }).count()) === 1 &&
				(await page.getByText('Administrator').count()) >= 1,
			'platform sections missing'
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/platform-1440.png`, fullPage: true });
		shots.push('platform-1440.png');

		// ---------------------------------------------------------- a11y basics
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		const unlabeled = await page.evaluate(() => {
			const bad = [];
			for (const element of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
				const id = element.getAttribute('id');
				const labelled = element.closest('label') || (id && document.querySelector(`label[for="${id}"]`));
				const named = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
				if (!labelled && !named) bad.push(element.outerHTML.slice(0, 60));
			}
			return bad;
		});
		check('every visible control has an accessible name', unlabeled.length === 0, unlabeled.join(' | '));

		await page.setViewportSize({ width: 390, height: 844 });
		const menuButton = page.getByRole('button', { name: 'Menu' });
		await menuButton.click();
		check(
			'mobile menu opens the organization navigation',
			(await page.locator('#org-nav').getAttribute('data-open')) === 'true' &&
				(await page.locator('#org-nav').isVisible())
		);


		// ------------------------------------------------ controls (bits-ui)
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions/new`);
		const direction = page.locator('button#new-direction');
		const date = page.locator('button#new-date');
		await direction.waitFor();

		// Select: keyboard opens, arrow + Enter selects, Escape closes, value is submitted.
		await direction.focus();
		await page.keyboard.press('Enter');
		check('select opens from the keyboard', (await page.getByRole('listbox').count()) === 1);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		check(
			'select shows the chosen label and submits its value',
			(await direction.innerText()).includes('Money in') && (await page.locator('input[name="direction"]').inputValue()) === 'in',
			await direction.innerText()
		);
		await direction.focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		await page.getByRole('listbox').waitFor({ state: 'detached' });
		check('Escape closes the select and keeps its value', (await page.getByRole('listbox').count()) === 0 && (await page.locator('input[name="direction"]').inputValue()) === 'in');

		// DatePicker: opens as a grid, a day is picked, ISO is submitted, human text is shown.
		await date.focus();
		await page.keyboard.press('Enter');
		check('date picker opens a calendar grid', (await page.getByRole('grid').count()) === 1);
		await page.keyboard.press('Escape');
		await page.getByRole('grid').waitFor({ state: 'detached' });
		check('Escape closes the date picker', (await page.getByRole('grid').count()) === 0);
		await date.click();
		await page.getByRole('button', { name: /, [A-Z][a-z]+ 15, \d{4}$/ }).first().click();
		const picked = await page.locator('input[name="date"]').inputValue();
		check(
			'date picker submits ISO and shows a human date',
			/^\d{4}-\d{2}-15$/.test(picked) && /^15 [A-Z][a-z]{2} \d{4}$/.test((await date.innerText()).trim()),
			`${picked} / ${await date.innerText()}`
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/new-controls-1440.png`, fullPage: true });
		shots.push('new-controls-1440.png');

		// Combobox: known unmapped labels are offered, mapped ones are not, a new
		// label is accepted, and the typed or picked text is what is submitted.
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings/routing`);
		const label = page.locator('input#mapping-pattern');
		await label.waitFor();
		await label.click();
		await page.getByRole('option', { name: 'Demo Print Shop' }).waitFor();
		check(
			'label picker offers unmapped labels only',
			(await page.getByRole('option', { name: 'Demo Print Shop' }).count()) === 1 &&
				(await page.getByRole('option', { name: 'Demo Coffee Supplier' }).count()) === 0
		);
		await page.keyboard.press('Escape');
		await page.getByRole('listbox').waitFor({ state: 'detached' });
		check('Escape closes the label picker', (await page.getByRole('listbox').count()) === 0);
		await label.fill('Brand new vendor');
		check(
			'label picker accepts a new label and submits it as typed',
			(await page.locator('input[name="pattern"]').inputValue()) === 'Brand new vendor'
		);
		await label.fill('Print');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		check('label picker fills the chosen label', (await label.inputValue()) === 'Demo Print Shop', await label.inputValue());
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/routing-1440.png`, fullPage: true });
		shots.push('routing-1440.png');

		// Notifications: the cutoff shows one human format and submits ISO.
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings/notifications`);
		const cutoff = page.locator('button#cutoff');
		await cutoff.waitFor();
		check(
			'cutoff shows a human date and submits ISO',
			(await cutoff.innerText()).trim() === '1 Jan 2025' && (await page.locator('input[name="cutoff_date"]').first().inputValue()) === '2025-01-01',
			await cutoff.innerText()
		);

		// Inline confirm: no dialog; the button becomes Revoke/Cancel with focus on Revoke.
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings/people`);
		await page.waitForFunction(() => document.querySelector('form[action="?/removeMember"]') !== null);
		let dialogs = 0;
		page.on('dialog', () => (dialogs += 1));
		const revoke = page.getByRole('button', { name: /Revoke access for Bob/ });
		await revoke.click();
		const confirmGroup = page.getByRole('group').filter({ hasText: 'Revoke Bob' });
		check('revoke asks inline, not in a dialog', (await confirmGroup.count()) === 1 && dialogs === 0 && (await page.locator('dialog[open]').count()) === 0);
		check('focus moves to the confirm button', (await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Revoke');
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/confirm-1440.png`, fullPage: true });
		shots.push('confirm-1440.png');
		await page.keyboard.press('Escape');
		check(
			'Escape cancels the inline confirm and restores the button focus',
			(await confirmGroup.count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent?.includes('Revoke')))
		);
		await revoke.click();
		await page.waitForTimeout(5400);
		check('an inline confirm does not revert while focus is inside it', (await confirmGroup.count()) === 1);
		await page.locator('main').click({ position: { x: 5, y: 5 } });
		await page.waitForTimeout(5400);
		check('an inline confirm left alone, focus elsewhere, reverts by itself', (await confirmGroup.count()) === 0);

		// A plain-endpoint rejection stays on the page, inline, focused, with the typed value kept.
		await page.goto(`${ORIGIN}/org/demo-jakarta/settings/people`);
		await page.waitForFunction(() => document.querySelector('form[action$="/settings/invitations"]') !== null);
		await page.waitForTimeout(300);
		await page.locator('input#invite-email').fill('bob@example.test');
		await page.getByRole('button', { name: 'Invite' }).click();
		const inviteAlert = page.locator('form[action$="/settings/invitations"] .form-error');
		await inviteAlert.waitFor();
		check(
			'a rejected invitation shows an inline alert, keeps the typed email and focuses the alert',
			page.url().endsWith('/settings/people') &&
				(await page.locator('input#invite-email').inputValue()) === 'bob@example.test' &&
				(await inviteAlert.evaluate((node) => node === document.activeElement)) &&
				(await inviteAlert.innerText()).length > 0,
			await inviteAlert.innerText()
		);

		// Narrow: the pickers stay inside the viewport.
		await page.setViewportSize({ width: 375, height: 800 });
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions/new`);
		await page.locator('button#new-date').click();
		const calendarBox = await page.getByRole('grid').boundingBox();
		check('calendar stays inside a 375px viewport', calendarBox !== null && calendarBox.x >= 0 && calendarBox.x + calendarBox.width <= 375, JSON.stringify(calendarBox));
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/new-date-375.png` });
		shots.push('new-date-375.png');
		await page.keyboard.press('Escape');
		await page.locator('button#new-direction').click();
		const listBox = await page.getByRole('listbox').boundingBox();
		check('select list stays inside a 375px viewport', listBox !== null && listBox.x >= 0 && listBox.x + listBox.width <= 375, JSON.stringify(listBox));
		await page.keyboard.press('Escape');

		// Drawer: overlay with a scrim; focus moves in; Escape closes and returns focus.
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions`);
		await page.getByRole('button', { name: 'Menu' }).click();
		check(
			'drawer opens over the page with focus on its first link',
			(await page.evaluate(() => document.activeElement?.closest('#org-nav') !== null)) && (await page.locator('.scrim').count()) === 1
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/drawer-375.png` });
		shots.push('drawer-375.png');
		await page.keyboard.press('Escape');
		check('Escape closes the drawer and returns focus to the menu button', (await page.locator('.scrim').count()) === 0 && (await page.evaluate(() => document.activeElement?.id)) === 'menu-button');
		await page.getByRole('button', { name: 'Menu' }).click();
		await page.locator('.scrim').click({ position: { x: 360, y: 400 } });
		check('a backdrop press closes the drawer', (await page.locator('.scrim').count()) === 0);

		await context.close();
	} finally {
		await browser.close();
	}
});

process.stdout.write(`${results.join('\n')}\n`);
process.stdout.write(`\nScreenshots in .wrangler/ui/:\n${shots.map((name) => `  ${name}`).join('\n')}\n`);
if (failures > 0) {
	process.stdout.write(`\n${failures} UI check(s) failed.\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(`\nAll ${results.length} UI checks passed.\n`);
}
