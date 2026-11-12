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
		await page.goto(`${ORIGIN}/org/demo-jakarta/ledger`);
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
		await page.goto(`${ORIGIN}/org/demo-jakarta/ledger`);
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
		await page.goto(`${ORIGIN}/org/demo-jakarta/ledger`);
		const focusOrder = [];
		for (let i = 0; i < 12; i += 1) {
			await page.keyboard.press('Tab');
			focusOrder.push(
				await page.evaluate(() => {
					const element = document.activeElement;
					if (!element || element === document.body) return 'body';
					const style = getComputedStyle(element);
					return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[${(element.textContent ?? '').trim().slice(0, 24)}] outline=${style.outlineStyle}`;
				})
			);
		}
		check(
			'keyboard reaches the status filter control',
			focusOrder.some((entry) => entry.startsWith('select#filter-status')),
			focusOrder.join(' | ')
		);
		check(
			'keyboard reaches the filter submit button',
			focusOrder.some((entry) => entry.includes('[Apply]')),
			focusOrder.join(' | ')
		);
		check(
			'focused controls show a visible outline',
			focusOrder.filter((entry) => entry.startsWith('select') || entry.includes('Apply')).every((entry) => entry.includes('outline=solid')),
			focusOrder.join(' | ')
		);

		// ---------------------------------------------------------- reduced motion
		const reduced = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			reducedMotion: 'reduce'
		});
		const reducedPage = await reduced.newPage();
		await signIn(reducedPage, 'Alice');
		await reducedPage.goto(`${ORIGIN}/org/demo-jakarta/ledger`);
		check(
			'the ledger renders fully with reduced motion requested',
			(await reducedPage.locator('table.ledger tbody tr').count()) === 3,
			'rows missing under reduced motion'
		);
		await reduced.close();

		// ---------------------------------------------------------------- detail
		await page.goto(`${ORIGIN}/org/demo-jakarta/ledger/1`);
		check(
			'detail page shows purposes and the owed-documentation notice',
			(await page.getByText('DEMO: workshop supplies').count()) === 1 &&
				(await page.getByText(/Documentation is still owed/).count()) === 1,
			'detail content missing'
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
		const forbidden = await page.goto(`${ORIGIN}/org/demo-indonesia/ledger`);
		check(
			'a foreign organization renders a readable denial page',
			forbidden?.status() === 403 && (await page.getByText(/Not allowed/).count()) === 1,
			String(forbidden?.status())
		);
		await page.screenshot({ path: `${ROOT}/.wrangler/ui/forbidden-1440.png`, fullPage: true });
		shots.push('forbidden-1440.png');

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
