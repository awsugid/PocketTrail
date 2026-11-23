import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { ORIGIN, ROOT, run, withWorker } from './harness.mjs';

// Exercise a legacy provider-backed handle without modifying persistent fixtures.
appendFileSync(`${ROOT}/e2e/fixtures/extra.sql`, '\n' + readFileSync(`${ROOT}/e2e/fixtures/mentions.sql`, 'utf8'));

await withWorker(async () => {
	const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
	try {
		const page = await browser.newPage({ reducedMotion: 'reduce' });
		await page.goto(`${ORIGIN}/login`);
		await page.getByRole('button', { name: /Alice/ }).click();
		await page.waitForURL(url => url.pathname !== '/login');
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			await page.goto(`${ORIGIN}/org/demo-jakarta/transactions/1?chat=1`);
			const drawer = page.getByRole('dialog', { name: /Discussion/ });
			const editor = drawer.getByRole('textbox', { name: 'Discussion message' });
			await page.locator('dialog:modal').waitFor();
			await editor.click();
			await page.keyboard.insertText('@');
			const list = drawer.getByRole('listbox');
			await list.waitFor();
			const result = await list.evaluate(node => {
				const drawer = node.closest('dialog');
				const composer = node.closest('form').querySelector('.composer');
				const bounds = drawer.getBoundingClientRect();
				const rect = node.getBoundingClientRect();
				return {
					painted: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
					fits: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= composer.getBoundingClientRect().top && rect.width <= 320 && drawer.scrollWidth <= drawer.clientWidth,
					labels: Array.from(node.querySelectorAll('[role=option]'), row => row.textContent)
				};
			});
			assert(result.painted && result.fits && result.labels.every(text => !/github:|org:|email:|@example\.test/.test(text)), JSON.stringify(result));

			await editor.press('Escape');
			await list.waitFor({ state: 'hidden' });
			assert(await drawer.isVisible());
			await page.keyboard.press('Backspace');
			await page.keyboard.type('@ali', { delay: 180 });
			await page.waitForSelector('[role=listbox]', { state: 'visible' });
			const open = await list.evaluate(node => {
				const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
				return {
					x, y, width, height,
					visible: width > 0 && height > 0 && x >= 0 && y >= 0 && right <= innerWidth && bottom <= innerHeight &&
						node.contains(document.elementFromPoint(x + width / 2, y + height / 2)),
					options: [...node.querySelectorAll('[role=option]')].map(row => row.innerText.replace(/\s+/g, ' ').trim())
				};
			});
			console.log(`${width}px open: ${JSON.stringify(open)}`);
			assert(open.visible);
			await drawer.screenshot({ path: `.playwright-mcp/v7-mention-open-${width}.png` });
			await list.getByRole('option', { name: /Alice/ }).waitFor();
			assert.equal(await list.getByRole('option').count(), 1);
			await editor.press('ArrowDown');
			await editor.press('Enter');
			assert.equal(await editor.locator('.mention--chip').textContent(), '@Alice (fixture)');
			await editor.pressSequentially(` mention smoke ${width}`);
			await drawer.getByRole('button', { name: 'Send' }).click();
			const message = drawer.locator('.bubble').filter({ hasText: `mention smoke ${width}` });
			await message.locator('.mention').waitFor();
			assert.equal(await message.locator('.mention').textContent(), '@Alice (fixture)');
			if (width === 390) await drawer.screenshot({ path: '.playwright-mcp/v7-mention-posted.png' });
			console.log(`${width}px: mention suggestions, bounds, keyboard and post passed`);
		}
		await page.goto(`${ORIGIN}/org/demo-jakarta/transactions/1?chat=1`);
		const drawer = page.locator('dialog:modal');
		const editor = drawer.getByRole('textbox', { name: 'Discussion message' });
		await editor.click();
		for (const [query, name, handle] of [
			['@budi s', 'Budi Santoso', 'budi'],
			['@Suhri', 'Mochamad Suhri Ardiansyah', '{m:802}'],
			['@mochamad suhri a', 'Mochamad Suhri Ardiansyah', '{m:802}'],
			['@BÚDI ', 'Budi Santoso', 'budi']
		]) {
			await editor.fill('');
			await page.keyboard.type(query, { delay: 60 });
			const option = drawer.getByRole('option', { name: new RegExp(name) });
			await option.waitFor({ timeout: 5000 });
			assert(await option.evaluate(node => {
				const r = node.getBoundingClientRect();
				return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
			}));
			if (query === '@budi s') await drawer.screenshot({ path: '.playwright-mcp/v8-mention-multiword.png' });
			if (query === '@Suhri') {
							mkdirSync('.playwright-mcp', { recursive: true });
							await drawer.screenshot({ path: '.playwright-mcp/v9-mention-suhri.png' });
						}
						if (query === '@mochamad suhri a' || query === '@BÚDI ') continue;
			await editor.press('Enter');
			assert.equal(await editor.locator('.mention--chip').getAttribute('data-handle'), handle);
			await page.keyboard.type(` multiword ${handle}`);
			await drawer.getByRole('button', { name: 'Send' }).click();
			const posted = drawer.locator('.bubble').filter({ hasText: `multiword ${handle}` }).locator('.mention');
			await posted.waitFor();
			assert.equal(await posted.textContent(), `@${name}`);
		}
		const [db] = JSON.parse(run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', "SELECT to_membership_id FROM notification_outbox WHERE kind = 'mention' AND transaction_id = 1 AND to_membership_id IN (801, 802) ORDER BY to_membership_id"]));
		assert.deepEqual(db.results.map(row => row.to_membership_id), [801, 802]);
		console.log('Multiword, folded search, posted names and notification recipients passed');
		await page.goto(`${ORIGIN}/org/demo-jakarta/purposes/1?chat=1`);
				const purposeDrawer = page.getByRole('dialog', { name: /Discussion/ });
				const purposeEditor = purposeDrawer.getByRole('textbox', { name: 'Discussion message' });
				await purposeEditor.click();
				await page.keyboard.insertText('@Suhri');
				await purposeDrawer.getByRole('option', { name: /Mochamad Suhri Ardiansyah/ }).click();
				await purposeDrawer.getByRole('button', { name: 'Send' }).click();
				await purposeDrawer.locator('.bubble .mention').getByText('@Mochamad Suhri Ardiansyah').waitFor();
				const [purposeDb] = JSON.parse(run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', "SELECT to_membership_id FROM notification_outbox WHERE kind = 'mention' AND purpose_id = 1 AND to_membership_id = 802"]));
				assert.deepEqual(purposeDb.results.map(row => row.to_membership_id), [802]);
				console.log('Purpose discussion: posted name and notification recipient passed');
				await page.goto(`${ORIGIN}/org/demo-jakarta/purposes/1?tab=notes`);
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		const notes = page.getByRole('textbox', { name: 'Purpose Notes' });
		await notes.click();
		await notes.press('Control+End');
		await page.keyboard.insertText(' @a');
		await page.getByRole('option', { name: /Alice/ }).waitFor();
		await notes.press('Enter');
		assert.equal(await notes.locator('.mention--chip').textContent(), '@Alice (fixture)');
		console.log('Notes: mention suggestions and keyboard selection passed');
	} finally {
		await browser.close();
	}
});
