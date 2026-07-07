// Verify the attendance duplicate-key fix by reproducing the exact failing
// action: set Rita's attendance for today (07-07) and yesterday (07-06) to WFH.
// Both days had soft-deleted rows, which used to make the mark 500. Captures
// any 500 response + error toast. This also resolves the employee's request.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT = '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 940 } })).newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const results = [];
const report = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

const serverErrors = [];
page.on('response', (r) => {
  if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url().split('?')[0]}`);
});

async function cmdk(text) {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
}

async function markRita(dayIndex, dayLabel) {
  const win = page.locator('.window').last();
  const ritaRow = win.locator('tr', { hasText: 'Rita' }).first();
  await ritaRow.waitFor({ timeout: 20000 });
  const cell = ritaRow.locator('td.att-cell').nth(dayIndex);
  await cell.click();
  // picker popup
  const picker = page.locator('.mb-dropdown').last();
  await picker.waitFor({ timeout: 5000 });
  await picker.locator('.row.live', { hasText: 'WFH' }).first().click();
  await page.waitForTimeout(3500);
  const errToast = await page.getByText(/Could not mark|error occurred|500/i).count();
  report(`mark Rita ${dayLabel} WFH — no error`, errToast === 0 && serverErrors.length === 0, serverErrors.join('; '));
}

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await cmdk('Open Office');
  await page.getByRole('button', { name: /Attendance/ }).first().click();
  await page.waitForTimeout(3500);
  // month defaults to July 2026 (today). day 7 → att-cell index 6; day 6 → 5.
  await markRita(6, '07-07 (today)');
  await shot('att-01-today');
  await markRita(5, '07-06 (yesterday)');
  await shot('att-02-yesterday');
  report('no 5xx responses during marking', serverErrors.length === 0, serverErrors.join('; '));
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('att-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
