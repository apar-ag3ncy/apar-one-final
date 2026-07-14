// Reproduce the broken calendar: open a DateField popover, screenshot it,
// dump the popover HTML + console/page errors.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://apar-one-final.vercel.app';
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT =
  '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 940 } })).newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300));
});
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + (e.message || String(e)).slice(0, 300)));

async function cmdk(text) {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
}

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Office → New Expense → the date field
  await cmdk('Open Office');
  await page
    .getByRole('button', { name: /Expenses/ })
    .first()
    .click();
  await page.waitForTimeout(3500);
  const ow = page.locator('.window').last();
  await ow.getByRole('button', { name: 'New Expense' }).click();
  await page.waitForTimeout(1200);
  const modal = page.locator('.os-modal').last();

  // The DateInput renders a <button> with a calendar icon. Find the date trigger.
  const dateBtn = modal
    .locator('button:has(svg.lucide-calendar), button:has-text("Pick a date")')
    .first();
  const hasDateBtn = (await dateBtn.count()) > 0;
  console.log('DATE_BUTTON_FOUND=' + hasDateBtn);
  await shot('cal-01-form');
  if (hasDateBtn) {
    await dateBtn.click();
    await page.waitForTimeout(1500);
    const pop = page
      .locator('[data-slot="popover-content"], [role="dialog"], .rdp, [data-slot="calendar"]')
      .last();
    const popHtml = await pop.innerHTML().catch(() => '(no popover)');
    const dayCells = await page
      .locator('[data-slot="calendar"] button[data-day], .rdp-day, table td button')
      .count();
    const monthCaption = await page
      .locator('[data-slot="calendar"], .rdp')
      .innerText()
      .catch(() => '');
    console.log('DAY_CELL_COUNT=' + dayCells);
    console.log('MONTH_CAPTION_TEXT=' + JSON.stringify(monthCaption.slice(0, 120)));
    console.log('POPOVER_HTML_LEN=' + popHtml.length);
    console.log('POPOVER_HTML_HEAD=' + popHtml.slice(0, 300).replace(/\n/g, ' '));
    await shot('cal-02-popover');

    // --- INTERACTION TESTS ---
    const captionOf = async () =>
      (
        await page
          .locator(
            '[data-slot="calendar"] .rdp-month_caption, .rdp-caption_label, [data-slot="calendar"]',
          )
          .first()
          .innerText()
          .catch(() => '')
      ).split('\n')[0];
    const cap0 = await captionOf();
    console.log('CAPTION_BEFORE=' + JSON.stringify(cap0));
    // previous-month arrow
    const prevBtn = page
      .locator('button.rdp-button_previous, button[aria-label*="previous" i], .rdp-nav button')
      .first();
    await prevBtn.click().catch((e) => console.log('PREV_CLICK_ERR=' + e.message));
    await page.waitForTimeout(700);
    const cap1 = await captionOf();
    console.log('CAPTION_AFTER_PREV=' + JSON.stringify(cap1));
    console.log('PREV_NAV_WORKS=' + (cap1 && cap1 !== cap0));
    // month/year dropdowns present?
    const dropdowns = await page.locator('[data-slot="calendar"] select').count();
    console.log('MONTH_YEAR_DROPDOWNS=' + dropdowns);
    // try jumping the YEAR via the year dropdown
    const selects = page.locator('[data-slot="calendar"] select');
    const nSel = await selects.count();
    if (nSel >= 1) {
      // last select is usually the year
      const yearSel = selects.nth(nSel - 1);
      const opts = await yearSel.locator('option').allTextContents();
      console.log(
        'YEAR_OPTIONS_SAMPLE=' +
          JSON.stringify([opts[0], opts[1], opts[opts.length - 1]]) +
          ' count=' +
          opts.length,
      );
      // pick a far-past year (e.g. 1990) to prove reachability
      const target = opts.find((o) => o.trim() === '1990') ? '1990' : opts[0];
      await yearSel.selectOption({ label: target }).catch(async () => {
        await yearSel.selectOption(target).catch(() => {});
      });
      await page.waitForTimeout(700);
      const capY = await captionOf();
      console.log('CAPTION_AFTER_YEAR_JUMP=' + JSON.stringify(capY) + ' target=' + target);
    }
    // click a day (15) and see if it selects + closes + updates the field
    const day15 = page.locator('[data-slot="calendar"] button', { hasText: /^15$/ }).first();
    await day15.click().catch((e) => console.log('DAY_CLICK_ERR=' + e.message));
    await page.waitForTimeout(1200);
    const popStillOpen = await page.locator('[data-slot="calendar"]').count();
    const fieldText = await modal
      .locator('button:has(svg.lucide-calendar)')
      .first()
      .innerText()
      .catch(() => '');
    console.log(
      'AFTER_DAY_CLICK_field=' + JSON.stringify(fieldText) + ' popoverStillOpen=' + popStillOpen,
    );
    await shot('cal-03-after-click');
  }
  console.log('ERRORS=\n' + errs.slice(-12).join('\n'));
} catch (e) {
  console.log('ERROR ' + e.message);
  await shot('cal-99-error');
}

await browser.close();
