// Verify the iOS calendar: clicking a day CHANGES the field and persists;
// month/year drill reaches a far year (1990). Read-only (no form submit).
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT =
  '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 940 } })).newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const results = [];
const report = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => errs.push('PAGEERR: ' + (e.message || '').slice(0, 160)));

async function cmdk(text) {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
}

const dateBtn = () => page.locator('.os-modal button:has(svg.lucide-calendar)').first();
const fieldText = async () =>
  (
    await dateBtn()
      .innerText()
      .catch(() => '')
  ).trim();

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await cmdk('Open Office');
  await page
    .getByRole('button', { name: /Expenses/ })
    .first()
    .click();
  await page.waitForTimeout(3500);
  const ow = page.locator('.window').last();
  await ow.getByRole('button', { name: 'New Expense' }).click();
  await page.waitForTimeout(1200);

  // 1) OPEN → should land on the MONTHS view (not days)
  await dateBtn().click();
  await page.waitForTimeout(800);
  const cal = page.locator('[data-slot="popover-content"]').last();
  report('iOS calendar opens', (await cal.count()) > 0);
  const monthBtns0 = await cal.getByRole('button', { name: 'Jul', exact: true }).count();
  const dayBtns0 = await cal.locator('button[data-day]').count();
  report(
    'opens at MONTHS view (months shown, no day grid yet)',
    monthBtns0 > 0 && dayBtns0 === 0,
    `monthBtns=${monthBtns0} dayBtns=${dayBtns0}`,
  );
  const headerText = (
    await cal
      .locator('button[aria-label="Switch month or year"]')
      .innerText()
      .catch(() => '')
  ).trim();
  report('months-view header shows the year', /20\d\d/.test(headerText), headerText);
  await shot('ios-01-open');

  // 2) common flow: click a month → days → click a day → field updates
  await cal.getByRole('button', { name: 'Jul', exact: true }).click();
  await cal.locator('button[data-day]').first().waitFor({ timeout: 5000 });
  const before = await fieldText();
  await cal.locator('button[data-day="2026-07-20"]').click();
  await page.waitForTimeout(1000);
  const after = await fieldText();
  console.log('FIELD_AFTER_CLICK=' + JSON.stringify(after));
  report('month → day picks a date', /20 Jul 2026/.test(after), `${before} -> ${after}`);
  report(
    'popover closed after pick',
    (await page.locator('[data-slot="popover-content"]').count()) === 0,
  );
  await shot('ios-02-picked');

  // 3) persistence
  await page.waitForTimeout(3500);
  report('selected date persists (no revert)', (await fieldText()) === after);

  // 4) tap the YEAR in the header → years view → drill to 1990 → month → day
  await dateBtn().click();
  await page.waitForTimeout(700);
  const cal2 = page.locator('[data-slot="popover-content"]').last();
  // opens at months; tap the year to go to years
  await cal2.locator('button[aria-label="Switch month or year"]').click();
  await page.waitForTimeout(400);
  const yearsShown = await cal2.getByRole('button', { name: /^20\d\d$/ }).count();
  report('tapping the year opens the YEARS view', yearsShown >= 6, `yearBtns=${yearsShown}`);
  let found1990 = false;
  for (let i = 0; i < 12; i++) {
    if ((await cal2.getByRole('button', { name: '1990', exact: true }).count()) > 0) {
      found1990 = true;
      break;
    }
    await cal2.locator('button[aria-label="Previous"]').click();
    await page.waitForTimeout(250);
  }
  report('year drill can reach 1990', found1990);
  if (found1990) {
    await cal2.getByRole('button', { name: '1990', exact: true }).click(); // → months (1990)
    await page.waitForTimeout(300);
    await cal2.getByRole('button', { name: 'Jun', exact: true }).click(); // → days
    await page.waitForTimeout(300);
    await cal2.locator('button[data-day="1990-06-15"]').click();
    await page.waitForTimeout(900);
    const far = await fieldText();
    console.log('FIELD_AFTER_1990=' + JSON.stringify(far));
    report('picking a 1990 date works', /15 Jun 1990/.test(far), far);
  }
  await shot('ios-03-far-year');

  report('no console/page errors', errs.length === 0, errs.slice(-4).join(' | '));
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('ios-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
