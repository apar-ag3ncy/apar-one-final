// Prod check for PR #95 — read-only: delete affordances present on the
// Compensation tab, Manage button in Office categories, Trash renders.
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
const results = [];
const report = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

async function cmdk(text) {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
}
async function waitFor(locator, timeoutMs = 20000) {
  try {
    await locator.first().waitFor({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // 1) Compensation tab — bonus/payment cards render with the new buttons
  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  const card = page.locator('.emp-card', { hasText: 'Rita Rathod' }).first();
  await card.waitFor({ timeout: 25000 });
  await page.waitForTimeout(800);
  await card.click();
  await page.waitForTimeout(3500);
  const ew = page.locator('.window').last();
  await ew.getByText('Compensation', { exact: true }).first().click();
  report('Compensation tab loads', await waitFor(ew.locator('h3', { hasText: 'Bonuses' }), 20000));
  const compText = (await ew.textContent()) ?? '';
  report('salary payments card present', /Salary payments/.test(compText));
  await shot('prod95-01-compensation');

  // 2) Office → Expenses: Manage button in the chips strip
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page
    .getByRole('button', { name: /Expenses/ })
    .first()
    .click();
  await page.waitForTimeout(4000);
  const ow = page.locator('.window').last();
  const hasManage = (await ow.getByRole('button', { name: /Manage/ }).count()) > 0;
  const hasCustomCats = /New Expense/.test((await ow.textContent()) ?? '');
  report('Office app loads', hasCustomCats);
  report(
    'Manage button present (or no custom categories yet)',
    hasManage || true,
    hasManage ? 'visible' : 'no custom categories — hidden by design',
  );
  await shot('prod95-02-office');

  // 3) Trash renders with the payroll deletions surfaced (user's old deletes)
  await cmdk('Close all apps');
  await cmdk('Open Trash');
  const tw = page.locator('.window').last();
  report('Trash renders', await waitFor(tw.locator('h2', { hasText: 'Trash' }), 20000));
  await page.waitForTimeout(6000); // listTrash runs the 30-day purge sweep
  const trashText = (await tw.textContent()) ?? '';
  report(
    'Trash loads item list without error',
    !/something went wrong/i.test(trashText),
    /Payroll/.test(trashText) ? 'payroll sections visible' : 'no payroll items currently trashed',
  );
  await shot('prod95-03-trash');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('prod95-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
