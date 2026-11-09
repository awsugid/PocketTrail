/* Run: node scripts/components-smoke.cjs. Uses existing app at 127.0.0.1:8787; no writes. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, timezoneId: 'Pacific/Honolulu' });
    // Live assets and real HTMX settling: class/style restoration must not expose sources.
    const live = await browser.newPage();
    // Serve worktree component assets through actual app; no server restart/rebuild.
    await live.route('**/static/components.js', route => route.fulfill({ path: path.resolve('static/components.js'), contentType: 'application/javascript' }));
    await live.route('**/static/components.css', route => route.fulfill({ path: path.resolve('static/components.css'), contentType: 'text/css' }));
    await live.goto('http://127.0.0.1:8787');
    await live.route('**/components-smoke-swap', route => route.fulfill({ contentType: 'text/html', body: '<select id="dev-user" class="select" name="probe" required><option value="">Choose</option><option value="ok">Ready</option></select>' }));
    await live.evaluate(() => window.htmx.ajax('GET', '/components-smoke-swap', { target: '#dev-user', swap: 'outerHTML' }));
    await live.waitForTimeout(100);
    for (const width of [1100, 390]) {
      await live.setViewportSize({ width, height: 844 });
      const native = live.locator('#dev-user');
      assert.equal(await native.evaluate(el => getComputedStyle(el).visibility), 'hidden', 'HTMX settling exposed native select');
      assert.equal(await native.evaluate(el => { el.focus(); return document.activeElement === el; }), false);
      assert.equal(await live.getByRole('combobox').count(), 0);
      await native.locator('..').locator('> .pt-trigger').click();
      assert.equal(await live.locator('.pt-options:popover-open').count(), 1);
      await live.keyboard.press('Escape');
    }
    assert.equal(await live.locator('#dev-user').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementsFromPoint(rect.x, rect.y).includes(el);
    }), false, 'native source is hit-testable');
    assert.equal(await live.locator('#dev-user').evaluate(el => el.reportValidity()), false);
    await live.keyboard.press('Escape');
    await live.evaluate(() => {
      const wrap = document.querySelector('#dev-user').closest('.pt-control');
      const clone = wrap.cloneNode(true);
      clone.querySelector('select').id = 'cloned-source';
      wrap.after(clone);
      document.dispatchEvent(new CustomEvent('htmx:load', { detail: { elt: clone } }));
    });
    await live.waitForTimeout(50);
    assert.equal(await live.locator('#cloned-source').locator('..').locator('.pt-control').count(), 0);
    assert.equal(await live.locator('#cloned-source').locator('..').locator('> .pt-trigger').count(), 1);
    await live.locator('#cloned-source').locator('..').locator('> .pt-trigger').click();
    await live.keyboard.press('End'); await live.keyboard.press('Enter');
    assert.equal(await live.locator('#cloned-source').inputValue(), 'ok');
    await live.close();
    for (const failure of ['absent', 'network']) {
      const fallback = await browser.newPage();
      await fallback.route('**/static/components.js', route => route.fulfill({ path: path.resolve('static/components.js'), contentType: 'application/javascript' }));
      await fallback.route('**/static/components.css', route => failure === 'network' ? route.abort() : route.fulfill({ body: '', contentType: 'text/css' }));
      await fallback.goto('http://127.0.0.1:8787');
      assert.equal(await fallback.locator('.pt-trigger').count(), 0, `${failure}: duplicate control`);
      const source = fallback.locator('#dev-user');
      assert.equal(await source.isVisible(), true);
      assert.equal(await source.getAttribute('aria-hidden'), null);
      await source.focus();
      assert.equal(await source.evaluate(el => document.activeElement === el), true);
      await fallback.close();
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<form id="form"><label for="person">Member</label><select id="person" name="member" required><option value="">Choose member</option><option disabled>Blocked</option><option value="a">Alpha</option><option value="b">Beta</option></select><label for="date">Transaction date</label><input id="date" type="date" name="date" min="2020-01-01" max="2030-12-31" required><input id="readonly" type="date" value="2024-01-01" readonly><button type="submit">Save</button></form><template id="row"><select name="split_member[]" aria-label="Allocation member"><option value="a">Alpha</option><option value="b">Beta</option></select></template><div id="rows"></div>`);
    await page.addStyleTag({ path: path.resolve('static/components.css') });
    await page.addScriptTag({ path: path.resolve('static/components.js') });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.pt-trigger').count(), 2);
    assert.equal(await page.locator('#readonly').evaluate(el => el.closest('.pt-control')), null);
    assert.equal(await page.locator('#form').evaluate(el => el.checkValidity()), false);
    await page.keyboard.press('Escape');
    const select = page.locator('.pt-trigger').first();
    await page.locator('label[for="person"]').click();
    assert.equal(await select.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('#person').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.locator('#person').evaluate(el => { el.className = 'select'; });
    assert.equal(await page.locator('#person').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await select.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.pt-options').evaluate(el => getComputedStyle(el).transitionDuration.split(',')[0].trim()), '0.12s');
    assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#person').inputValue(), 'a');
    await select.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#person').inputValue(), 'b');
    await select.click(); await page.keyboard.press('Home'); await page.keyboard.press('b'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#person').inputValue(), 'b');
    const date = page.locator('.pt-trigger').nth(1);
    await date.click();
    await page.getByLabel('Date (YYYY-MM-DD)').fill('2019-12-31'); await page.getByRole('button', { name: 'Use date', exact: true }).click();
    assert.equal(await page.locator('#date').inputValue(), '');
    await page.getByLabel('Date (YYYY-MM-DD)').fill('2024-02-29'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#date').inputValue(), '2024-02-29');
    await date.click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#date').inputValue(), '2024-03-01');
    await date.click(); await page.keyboard.press('Home'); await page.keyboard.press('End'); await page.keyboard.press('PageUp'); await page.keyboard.press('Escape');
    assert.equal(await date.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#form').evaluate(el => el.checkValidity()), true);
    assert.deepEqual(await page.locator('#form').evaluate(el => Object.fromEntries(new FormData(el))), { member: 'b', date: '2024-03-01' });
    await page.evaluate(() => {
      document.querySelector('#rows').append(document.querySelector('#row').content.cloneNode(true));
      document.dispatchEvent(new CustomEvent('htmx:load', { detail: { elt: document.body } }));
      document.dispatchEvent(new CustomEvent('htmx:load', { detail: { elt: document.body } }));
    });
    await page.waitForFunction(() => document.querySelectorAll('.pt-trigger').length === 3);
    assert.equal(await page.locator('#rows .pt-control').count(), 1);
    await page.addScriptTag({ path: path.resolve('static/components.js') });
    assert.equal(await page.locator('.pt-trigger').count(), 3);
    await page.evaluate(() => document.querySelector('#person').append(new Option('Gamma', 'g')));
    await select.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#person').inputValue(), 'g');
    await select.click(); await page.mouse.click(1050, 800);
    await page.waitForFunction(() => document.querySelector('.pt-trigger').getAttribute('aria-expanded') === 'false');
    assert.equal(await select.getAttribute('aria-expanded'), 'false');
    await page.locator('#form').evaluate(el => el.reset());
    await page.waitForFunction(() => document.querySelector('.pt-value').textContent === 'Choose member');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await date.click();
    const bounds = await page.locator('.pt-calendar').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 375);
    assert.equal(await date.evaluate(el => getComputedStyle(el).minHeight), '44px');
    assert.equal(await date.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.equal(await page.locator('.pt-calendar').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    await page.getByLabel('Year', { exact: true }).fill('1995');
    await page.getByLabel('Year', { exact: true }).press('Tab');
    assert.match(await page.locator('.pt-calendar-heading').textContent(), /1995/);
    await page.keyboard.press('Escape');
    // Actual review regression: calendar must not cover its anchor near mid-screen.
    for (const [width, height] of [[1100, 844], [1100, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await date.evaluate(el => { el.closest('.pt-control').style.cssText = 'position:fixed;top:480px;left:16px;width:300px'; });
      await date.click();
      const anchor = await date.boundingBox();
      const panel = page.locator('.pt-calendar:popover-open');
      const box = await panel.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width);
      assert(box.y >= 12 && box.y + box.height <= height - 12);
      assert(box.y + box.height <= anchor.y - 5 || box.y >= anchor.y + anchor.height + 5, 'calendar overlaps anchor');
      // Tab traverses calendar, ISO input, and footer even when panel scrolls.
      let reached = false;
      for (let tab = 0; tab < 12; tab++) {
        await page.keyboard.press('Tab');
        reached = await page.getByRole('button', { name: 'Use date', exact: true }).evaluate(el => document.activeElement === el);
        if (reached) break;
      }
      assert(reached, 'calendar footer keyboard unreachable');
      const footer = await page.getByRole('button', { name: 'Use date', exact: true }).boundingBox();
      assert(footer.y >= box.y && footer.y + footer.height <= box.y + box.height);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: process.env.DELTA_SCRATCH_DIR ? `${process.env.DELTA_SCRATCH_DIR}/components-mobile.png` : '/tmp/pockettrail-components-mobile.png', fullPage: true });
    console.log('PASS components: live HTMX settling desktop/mobile, hidden/non-hit-testable/non-focusable/AX-excluded sources, enhanced clones, absent/failed CSS fallback; keyboard, labels, disabled/typeahead, ISO/calendar, constraints, required/FormData, HTMX/template clones, reset, outside dismissal, mobile/reduced motion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
