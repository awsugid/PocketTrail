#!/usr/bin/env node
// node scripts/dialog-smoke.cjs
// Compiled Rust template shell + the shared section contract; intercepted
// requests only. No running server, database, mail or persisted changes.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const pages = JSON.parse(execFileSync('cargo', ['run', '--quiet', '--example', 'ui-polish-fixtures'], {
  cwd: root, encoding: 'utf8',
}));
const icon = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>';
const contract = `<nav class="dialog-actions">
  <a class="btn" href="#dialog-probe" data-dialog-open="dialog-probe">${icon}Edit details</a>
  <a class="btn" href="#dialog-other" data-dialog-open="dialog-other">${icon}View history</a>
</nav>
<section class="panel" data-dialog-panel id="dialog-probe" aria-labelledby="probe-title">
  <h2 id="probe-title">Edit details</h2><p class="panel__sub">Synthetic dialog regression fixture.</p>
  <form id="probe-form" method="post" action="/dialog-save" hx-post="/dialog-save" hx-target="#main" hx-select="#main" hx-swap="outerHTML">
    <div class="field"><label for="probe-name">Purpose</label><input class="input" id="probe-name" name="purpose" required value="Initial purpose"></div>
    <div class="field"><label for="probe-member">Member</label><select class="select" id="probe-member" name="member" required><option value="">Choose</option><option value="a">Alpha</option><option value="b">Beta</option></select></div>
    <div class="field"><label for="probe-date">Date</label><input class="input" id="probe-date" type="date" name="date" value="2026-01-01" required></div>
    <a class="btn" href="#dialog-other" data-dialog-open="dialog-other">${icon}View history</a>
    <div style="height:700px" aria-hidden="true"></div>
    <button class="btn" type="submit">Save fixture</button>
  </form>
</section>
<section class="panel" data-dialog-panel id="dialog-other" aria-labelledby="other-title"><h2 id="other-title">View history</h2><p>No changes yet.</p></section>`;
const html = pages.import.replace('</main>', `${contract}</main>`);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined });
  let responseStatus = 422;
  let submissions = 0;
  async function routePage(page) {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (/^\/static\/(?:app|components|extraction)\.(?:css|js)$/.test(url.pathname) || url.pathname === '/static/vendor/htmx.min.js') {
        return route.fulfill({ body: readFileSync(path.join(root, url.pathname.slice(1))),
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
      }
      if (url.pathname === '/dialog-save') {
        submissions++;
        return route.fulfill({ status: responseStatus, contentType: 'text/html',
          body: responseStatus === 200 ? pages.import : '<p>This revision changed. Review your purpose and try again.</p>' });
      }
      return route.fulfill({ body: pages[url.pathname.slice(1)] || html, contentType: 'text/html' });
    });
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await routePage(page);
    await page.goto('http://pockettrail.test/dialog-fixture');
    const opener = page.locator('nav.dialog-actions [data-dialog-open="dialog-probe"]');
    const dialog = page.locator('#dialog-probe-dialog');
    await opener.click();
    assert(await dialog.evaluate(el => el.matches(':modal')));
    assert(await dialog.locator('.pt-dialog__title').evaluate(el => el === document.activeElement));
    assert.equal(await dialog.getAttribute('aria-labelledby'), 'dialog-probe-dialog-title');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert(await opener.evaluate(el => el === document.activeElement));
    await opener.click();
    // Native validation is still authoritative and sends no request.
    await page.locator('#probe-name').fill('');
    await page.getByRole('button', { name: 'Save fixture' }).click();
    assert.equal(submissions, 0);
    assert.equal(await page.locator('#probe-form').evaluate(el => el.checkValidity()), false);
    await page.locator('#probe-name').fill('Unsaved purpose');
    let confirmations = 0;
    const reject = async modal => { confirmations++; await modal.dismiss(); };
    page.on('dialog', reject);
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible());
    await dialog.locator('.pt-dialog__close').click();
    assert(await dialog.isVisible());
    await dialog.locator('[data-dialog-open="dialog-other"]').click();
    assert(await dialog.isVisible());
    // Real backdrop click, not a synthetic cancel event.
    await page.mouse.click(5, 5);
    assert(await dialog.isVisible());
    assert.equal(confirmations, 4);
    page.off('dialog', reject);
    page.once('dialog', modal => modal.accept());
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert(await opener.evaluate(el => el === document.activeElement));
    await opener.click();
    assert.equal(await page.locator('#probe-name').inputValue(), 'Unsaved purpose');
    // Shared select/calendar popovers must stay in the modal's top layer.
    await page.locator('#probe-member').locator('..').locator('.pt-trigger').click();
    assert.equal(await dialog.locator('.pt-options:popover-open').count(), 1);
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#probe-member').inputValue(), 'b');
    const memberControl = page.locator('#probe-member').locator('..');
    page.on('dialog', reject);
    const beforeSelectEscape = confirmations;
    for (let attempt = 0; attempt < 12; attempt++) {
      await memberControl.locator('.pt-trigger').click();
      if (attempt % 2) await memberControl.locator('.pt-trigger').focus();
      await page.keyboard.press('Escape');
      assert.equal(await memberControl.locator('.pt-options:popover-open').count(), 0);
      assert(await dialog.isVisible(), 'Select Escape must not close parent dialog');
      assert.equal(confirmations, beforeSelectEscape, 'Select Escape must not reach dirty guard');
      assert(await memberControl.locator('.pt-trigger').evaluate(el => el === document.activeElement));
    }
    page.off('dialog', reject);
    await page.locator('#probe-date').locator('..').locator('.pt-trigger').click();
    assert.equal(await dialog.locator('.pt-calendar:popover-open').count(), 1);
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible(), 'Escape on calendar must not close parent dialog');
    // A real failed HTMX form request must not swap away any entries.
    await page.getByRole('button', { name: 'Save fixture' }).click();
    const alert = dialog.locator('[data-request-error]');
    await alert.waitFor({ state: 'visible' });
    assert.match(await alert.textContent(), /revision changed/);
    assert(await alert.evaluate(el => el === document.activeElement));
    assert.equal(await page.locator('#probe-name').inputValue(), 'Unsaved purpose');
    assert.equal(await page.locator('#probe-member').inputValue(), 'b');
    assert(await dialog.isVisible());
    // HTMX load is idempotent.
    await page.evaluate(() => document.dispatchEvent(new Event('htmx:load')));
    assert.equal(await dialog.locator('[data-dialog-panel]').count(), 1);
    assert.equal(await dialog.locator('.pt-dialog__header').count(), 1);
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const layout = await dialog.evaluate(el => {
        const rect = el.getBoundingClientRect(), body = el.querySelector('.pt-dialog__body');
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          innerScroll: body.scrollHeight > body.clientHeight,
          closeHeight: el.querySelector('.pt-dialog__close').getBoundingClientRect().height,
          pageWidth: document.documentElement.scrollWidth };
      });
      assert(layout.x >= 0 && layout.width <= width && layout.pageWidth <= width);
      assert(layout.innerScroll && layout.closeHeight >= 44);
      if (width < 641) assert.equal(layout.height, 700);
      else assert(layout.height <= 652);
      if (width === 390 && process.env.DELTA_SCRATCH_DIR) {
        await page.screenshot({ path: `${process.env.DELTA_SCRATCH_DIR}/dialog-mobile.png` });
      }
    }
    if (process.env.DELTA_SCRATCH_DIR) await page.screenshot({ path: `${process.env.DELTA_SCRATCH_DIR}/dialog-desktop.png` });
    // Successful navigation releases top-layer and scroll lock, not on submit.
    responseStatus = 200;
    await page.getByRole('button', { name: 'Save fixture' }).click();
    await page.waitForFunction(() => !document.querySelector('#dialog-probe-dialog'));
    assert.equal(await page.locator('.pt-dialog-open').count(), 0);
    assert.deepEqual(errors, []);
    const fallback = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await routePage(fallback);
    await fallback.goto('http://pockettrail.test/dialog-fixture');
    await fallback.locator('nav.dialog-actions [data-dialog-open="dialog-probe"]').click();
    assert.equal(new URL(fallback.url()).hash, '#dialog-probe');
    assert(await fallback.locator('#dialog-probe').isVisible());
    assert(await fallback.locator('#probe-name').isVisible());
    assert.equal(await fallback.locator('dialog').count(), 0);
    // Also exercise real page contracts when the template workers' changes are
    // present. The synthetic panel above keeps edge cases stable as copy evolves.
    const actualPages = ['transaction', 'transaction-readonly', 'transaction-empty', 'settings', 'inventory'];
    let actualPanels = 0;
    for (const name of actualPages) {
      await page.goto(`http://pockettrail.test/${name}`);
      const ids = await page.locator('section[data-dialog-panel]').evaluateAll(sections => sections.map(section => section.id));
      actualPanels += ids.length;
      for (const width of [320, 800, 1440]) {
        await page.setViewportSize({ width, height: 700 });
        for (const id of ids) {
          const trigger = page.locator(`[data-dialog-open="${id}"]`).first();
          assert(await trigger.isVisible(), `${name}: ${id} needs a visible opener`);
          assert((await trigger.textContent()).trim(), `${name}: visible label`);
          await trigger.click();
          const modal = page.locator(`#${id}-dialog`);
          assert(await modal.evaluate(el => el.matches(':modal')), `${name}/${id}: native modal`);
          assert(await modal.locator('section[data-dialog-panel]').isVisible());
          assert(await modal.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
          }), `${name}/${id}/${width}: dialog outside viewport`);
          await page.keyboard.press('Escape');
          assert.equal(await modal.isVisible(), false);
          assert(await trigger.evaluate(el => el === document.activeElement), `${name}/${id}: restore focus`);
        }
      }
      await fallback.goto(`http://pockettrail.test/${name}`);
      for (const id of ids) {
        assert(await fallback.locator(`#${id}`).isVisible(), `${name}/${id}: no-JS content accessible`);
      }
      if (name.startsWith('transaction')) {
        for (const id of ['bank-facts', 'purposes', 'documents', 'review', 'discussion']) {
          assert(await fallback.locator(`#${id}`).isVisible(), `${name}/${id}: no-JS details visible`);
          assert.equal(await fallback.locator(`#${id}[data-dialog-panel]`).count(), 0);
        }
        assert(await fallback.locator('.topbar .menu--org').isVisible(), 'Native mobile organization switcher');
        for (const form of await fallback.locator('main form').all()) {
          assert.equal(await form.locator('[name="csrf_token"]').inputValue(), 'test-only');
          if (!(await form.getAttribute('action')).endsWith('/comments')) {
            assert.equal(await form.locator('[name="revision"]').inputValue(), '1');
          }
        }
      }
    }
    // Exercise the real Notifications editor repeatedly, including Escape before
    // and after the popover's queued toggle event, and focus outside its content.
    await page.goto('http://pockettrail.test/settings');
    // A programmatic/deep-link opening can share a native close-watcher group
    // with its child. With focus outside the popup, native Escape may cancel both.
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.evaluate(() => {
        document.querySelector('[data-dialog-open="notifications"]').click();
        document.getElementById('preview-cutoff').closest('.pt-control').querySelector('.pt-trigger').click();
        document.getElementById('preview-cutoff').closest('.pt-control').querySelector('.pt-trigger').focus();
      });
      await page.keyboard.press('Escape');
      assert(await page.locator('#notifications-dialog').isVisible(), 'Grouped child Escape must not close Notifications');
      assert.equal(await page.locator('#notifications-dialog .pt-calendar:popover-open').count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#notifications-dialog').isVisible(), false);
    }
    const notifications = page.locator('[data-dialog-panel]#notifications');
    const notificationDialog = page.locator('#notifications-dialog');
    const notificationOpener = page.locator('[data-dialog-open="notifications"]').first();
    await notificationOpener.click();
    const dateControl = notifications.locator('input[type="date"]').first().locator('..');
    let childConfirmations = 0;
    const rejectChildClose = async modal => {
      childConfirmations++;
      assert.match(modal.message(), /unsaved entries will remain here until you leave this page/);
      await modal.dismiss();
    };
    page.on('dialog', rejectChildClose);
    for (const dirty of [false, true]) {
      if (dirty) await notifications.locator('input[type="date"]').first().evaluate(el => {
        el.value = '2026-02-02';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      for (let attempt = 0; attempt < 24; attempt++) {
        await dateControl.locator('.pt-trigger').click();
        const calendar = dateControl.locator('.pt-calendar');
        assert(await calendar.evaluate(el => el.matches(':popover-open')));
        const focus = ['.pt-day[tabindex="0"]', '.pt-date-manual', '.pt-month-number', '.pt-trigger'][attempt % 4];
        await dateControl.locator(focus).focus();
        if (attempt % 2) await page.evaluate(() => new Promise(requestAnimationFrame));
        const before = childConfirmations;
        await page.keyboard.press('Escape');
        assert.equal(await calendar.evaluate(el => el.matches(':popover-open')), false);
        assert(await notificationDialog.isVisible(), `Calendar Escape closed Notifications (${dirty}/${attempt}/${focus})`);
        assert.equal(childConfirmations, before, 'Child Escape must not reach the dirty guard');
        assert(await dateControl.locator('.pt-trigger').evaluate(el => el === document.activeElement));
      }
    }
    await page.keyboard.press('Escape');
    assert.equal(childConfirmations, 1, 'Next Escape reaches the parent dirty guard');
    assert(await notificationDialog.isVisible());
    page.off('dialog', rejectChildClose);
    page.once('dialog', modal => modal.accept());
    await page.keyboard.press('Escape');
    await notificationOpener.click();
    assert.equal(await notifications.locator('input[type="date"]').first().inputValue(), '2026-02-02');
    page.once('dialog', modal => modal.accept());
    await page.keyboard.press('Escape');
    // Details-first Settings may scroll vertically, but configuration stays
    // visible without opening a dialog and never overflows the document width.
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://pockettrail.test/settings');
      const layout = await page.evaluate(() => ({
        viewport: innerWidth, document: document.documentElement.scrollWidth,
      }));
      assert(layout.document <= layout.viewport, `Settings ${width}px: ${JSON.stringify(layout)}`);
      assert(await page.locator('.settings-config').isVisible());
    }
    assert.deepEqual(errors, []);
    console.log('PASS dialogs: compiled shell, native modal, focus/Escape/backdrop/dirty/cross-dialog guard, retained edits, native validation, repeated select/calendar Escape and grouped close watchers, real HTMX error preservation and navigation cleanup, responsive internal scrolling, reduced motion, no-JS anchors, visible responsive Settings configuration.');
    console.log(`Real compiled template contracts checked: ${actualPanels} panels across ${actualPages.join(', ')}.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
