#!/usr/bin/env node
// Compiled real templates + real HTMX; intercepted GETs only. No DB or mail.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const pages = JSON.parse(execFileSync('cargo', ['run', '--quiet', '--example', 'ui-polish-fixtures'], {
  cwd: root, encoding: 'utf8',
}));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined });
  const errors = [];
  let previewRequests = 0;
  async function intercept(page) {
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET', 'Never submit mutations');
      if (url.pathname.startsWith('/static/')) {
        return route.fulfill({ body: readFileSync(path.join(root, url.pathname.slice(1))),
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
      }
      if (url.searchParams.has('cutoff_date')) {
        assert.equal(url.pathname, '/org/demo/settings');
        assert.equal(url.searchParams.get('cutoff_date'), '2026-02-02');
        assert.equal(request.headers()['hx-request'], 'true', 'Actual HTMX GET');
        previewRequests++;
        return route.fulfill({ body: pages['settings-preview'], contentType: 'text/html' });
      }
      return route.fulfill({ body: pages[url.pathname.slice(1)] || pages['settings-populated'],
        contentType: 'text/html' });
    });
  }
  async function uniqueIds(page) {
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(ids).size, ids.length, 'No duplicate IDs, including enhanced controls');
  }
  try {
    const page = await browser.newPage();
    await intercept(page);
    for (const width of [1440, 320, 390, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://pockettrail.test/settings-populated');
      for (const text of ['View transactions', 'No permissions · no access', 'Former member',
        'No role', 'Community pocket', 'Main Pocket', '2026-01-01', '3 pending items', 'Synthetic reminder',
        'Owner: Synthetic organizer', 'Owner: Not set — choose an active owner', 'Income routing', 'Organizer']) {
        assert(await page.locator('.settings-config').getByText(text, { exact: false }).first().isVisible(), text);
      }
      assert.equal(await page.locator('dialog:visible').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('.settings-config').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), width === 1440 ? 2 : 1);
      await uniqueIds(page);
      if (process.env.DELTA_SCRATCH_DIR) await page.screenshot({
        path: `${process.env.DELTA_SCRATCH_DIR}/settings-${width}.png`, fullPage: true,
      });
      const ids = await page.locator('.settings-config [data-dialog-open]').evaluateAll(nodes => nodes.map(n => n.dataset.dialogOpen));
      assert.equal(ids.length, 6);
      for (const id of ids) {
        const trigger = page.locator(`[data-dialog-open="${id}"]`);
        await trigger.click();
        const dialog = page.locator(`#${id}-dialog`);
        assert(await dialog.evaluate(el => el.matches(':modal')));
        assert(await dialog.locator('form').count() > 0, 'Actions only');
        assert(await dialog.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        }));
        if (id === 'notifications' && process.env.DELTA_SCRATCH_DIR && [320, 1440].includes(width)) {
          await page.screenshot({ path: `${process.env.DELTA_SCRATCH_DIR}/settings-editor-${width}.png` });
        }
        await page.keyboard.press('Escape');
        assert(await trigger.evaluate(el => el === document.activeElement));
      }
    }
    // Inspect unchanged server contracts without executing any POST.
    for (const form of await page.locator('main form[method="post"]').all()) {
      assert.equal(await form.locator('[name="csrf_token"]').inputValue(), 'test-only');
      assert((await form.getAttribute('action')).startsWith('/org/demo/'));
    }
    assert.equal(await page.locator('form[action$="/remove"]').count(), 1);
    assert.equal(await page.locator('form[action$="/restore"]').count(), 1);
    assert.equal(await page.locator('#member-role').inputValue(), '');
    assert.equal(await page.locator('#cutoff').getAttribute('readonly'), '');
    await page.locator('[data-dialog-open="notifications"]').click();
    await page.locator('#preview-cutoff').evaluate(el => {
      el.value = '2026-02-02';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Preview recipients', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[name="preview_token"]')?.value === 'synthetic-new-cutoff-token');
    await page.waitForFunction(() => document.querySelector('#notifications-dialog')?.matches(':modal'));
    assert.equal(previewRequests, 1);
    assert.equal(new URL(page.url()).hash, '#notifications');
    assert.equal(await page.locator('#cutoff').inputValue(), '2026-02-02');
    assert.equal(await page.locator('.settings-config dt').filter({ hasText: 'Saved cutoff' }).locator('+ dd').textContent(), '2026-01-01');
    await page.keyboard.press('Escape');
    assert(await page.locator('.settings-config').getByText('No assigned items need reminders').isVisible());
    assert(await page.locator('.settings-config').getByText('This preview is limited').isVisible());
    await page.locator('[data-dialog-open="notifications"]').click();
    assert.equal(await page.locator('#cutoff').inputValue(), '2026-02-02');
    await uniqueIds(page);
    await page.keyboard.press('Escape');
    // Pocket ownership: per-pocket owner forms with active-member selects.
    await page.locator('[data-dialog-open="pockets"]').click();
    assert.equal(await page.locator('#pocket-owner').inputValue(), '', 'Add-pocket owner defaults to organization creator');
    assert.equal(await page.locator('#pocket-owner-1').inputValue(), '1');
    assert.equal(await page.locator('#pocket-owner-2').inputValue(), '1', 'Ownerless pocket prompts for an active owner (no empty option)');
    assert.equal(await page.locator('#pocket-owner-2 option[value=""]').count(), 0, 'Clearing an owner is not offered');
    for (const form of await page.locator('#pockets-dialog form[action$="/owner"]').all()) {
      assert(/\/settings\/pockets\/\d+\/owner$/.test(await form.getAttribute('action')));
      const names = await form.evaluate(el =>
        Array.from(el.elements).filter(el => el.name).map(el => el.name));
      assert.deepEqual(names, ['csrf_token', 'owner_membership_id'], 'Owner forms carry only scope fields');
    }
    await uniqueIds(page);
    await page.keyboard.press('Escape');
    // Mapping form: pocket scope + searchable editable combobox on the statement label.
    await page.locator('[data-dialog-open="mappings"]').click();
    await page.locator('#mappings-dialog details.accordion summary').click();
    const pattern = page.locator('#mapping-pattern');
    assert.equal(await pattern.getAttribute('role'), 'combobox');
    assert.equal(await pattern.getAttribute('aria-autocomplete'), 'list');
    assert.equal(await pattern.getAttribute('maxlength'), '300');
    const listbox = page.locator(`#${await pattern.getAttribute('aria-controls')}`);
    assert.equal(await pattern.getAttribute('aria-expanded'), 'false');
    await pattern.click();
    assert.equal(await pattern.getAttribute('aria-expanded'), 'true');
    assert.equal(await listbox.locator('.pt-option').count(), 3, 'Selected pocket supplies the suggestions');
    await pattern.fill('comm');
    assert.equal(await listbox.locator('.pt-option').count(), 1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await pattern.inputValue(), 'Community pocket');
    assert.equal(await pattern.getAttribute('aria-expanded'), 'false', 'Popover closed after commit');
    await pattern.fill('Brand new label');
    assert.equal(await pattern.inputValue(), 'Brand new label', 'Plain text accepted without suggestions');
    await page.keyboard.press('Escape');
    await page.locator('#mapping-pocket').evaluate(el => { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await pattern.click();
    assert(await listbox.locator('.pt-combobox-note').isVisible(), 'Empty first-import pocket teaches instead of empty listbox');
    await pattern.fill('');
    await page.locator('#mapping-pocket').evaluate(el => { el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await uniqueIds(page);
    await page.keyboard.press('Escape');
    assert(await pattern.evaluate(el => document.activeElement === el || el.contains(document.activeElement)), 'Mapping dialog closed to its own content');
    await page.keyboard.press('Escape');
    // Income routing: role selector posts the exact server contract.
    await page.locator('[data-dialog-open="income"]').click();
    assert(await page.locator('#income-dialog').evaluate(el => el.matches(':modal')));
    assert.equal(await page.locator('#income-role').inputValue(), '1');
    const incomeForm = page.locator('#income-dialog form');
    assert.equal(await incomeForm.getAttribute('action'), '/org/demo/settings/income-role');
    const incomeNames = await incomeForm.evaluate(el =>
      Array.from(el.elements).filter(el => el.name).map(el => el.name));
    assert.deepEqual(incomeNames, ['csrf_token', 'income_explanation_role_id']);
    await page.locator('#income-role').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.locator('#income-role').inputValue(), '', 'No-role option keeps pocket-owner fallback');
    await page.locator('#income-role').evaluate(el => { el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await uniqueIds(page);
    await page.keyboard.press('Escape');
    await page.goto('http://pockettrail.test/settings-readonly');
    assert.equal(await page.locator('main [data-dialog-open], main form, main [data-dialog-panel]').count(), 0);
    for (const text of ['View transactions', 'Former member', 'Community pocket', 'Main Pocket', '2026-01-01',
      'Requires notification management permission.', 'Owner: Synthetic organizer', 'Income routing', 'Organizer']) {
      assert(await page.locator('.settings-config').getByText(text, { exact: false }).first().isVisible(), text);
    }
    const fallback = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    await intercept(fallback);
    await fallback.goto('http://pockettrail.test/settings-populated');
    await fallback.locator('[data-dialog-open="pockets"]').click();
    assert.equal(new URL(fallback.url()).hash, '#pockets');
    assert(await fallback.locator('#pocket-name').isVisible());
    assert(await fallback.locator('#pocket-owner').isVisible(), 'Owner selector works without JS');
    assert(await fallback.locator('.settings-config').getByText('View transactions').isVisible());
    await fallback.goto('http://pockettrail.test/settings-populated#mappings');
    await fallback.locator('#mappings details.accordion summary').click();
    assert(await fallback.locator('#mapping-pocket').isVisible(), 'Pocket scope select works without JS');
    const patternNoJs = fallback.locator('#mapping-pattern');
    assert.equal(await patternNoJs.getAttribute('role'), null, 'Combobox degrades to a plain labeled input');
    assert.equal(await patternNoJs.getAttribute('aria-expanded'), null);
    await patternNoJs.fill('Main Pocket');
    assert.equal(await patternNoJs.inputValue(), 'Main Pocket');
    assert(await fallback.locator('#mapping-member').isVisible());
    await fallback.goto('http://pockettrail.test/settings-populated#income');
    assert(await fallback.locator('#income-role').isVisible(), 'Income role selector works without JS');
    await uniqueIds(fallback);
    assert.deepEqual(errors, []);
    console.log('PASS Settings: compiled details-first templates, 1440/320/390/800 layouts/screenshots, six action-only dialogs, unique IDs, readonly configuration/no editors, pocket owners (per-pocket active-member selects), pocket-scoped statement-label combobox (filter/commit/free-text/empty-import note), income routing role contract, CSRF/endpoints/revocation/restore/default no-role, actual HTMX cutoff preview GET/hash/reopen/token refresh, no-JS anchor forms. No POST/DB/mail/cloud.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
