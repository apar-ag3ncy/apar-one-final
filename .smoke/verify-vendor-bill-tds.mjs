// Verify the vendor-bill TDS 500 fix: create a vendor bill DRAFT carrying a
// TDS section (194C), which runs the tds_threshold_crossed validation that was
// crashing on `column s.code does not exist`. Selects an EXISTING document (no
// upload). Prints the invoice number + any draft txn id for cleanup.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT = '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
fs.mkdirSync(OUT, { recursive: true });
const INV = `SMOKE-TDS-${Date.now()}`;
const DOC_ID = '4ac95a1f-e086-4227-807d-47a08ebb6561'; // Chitra Vaibhav Press existing doc

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

try {
  console.log('INVOICE_NUMBER=' + INV);
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Vendors dock app → Chitra Vaibhav Press → Bills tab → New bill
  await cmdk('Open Vendors');
  const list = page.locator('.window').last();
  await list.getByText('Chitra Vaibhav Press', { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await list.getByText('Chitra Vaibhav Press', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const vw = page.locator('.window').last();
  await vw.getByText('Bills', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await vw.getByRole('button', { name: /New bill/i }).first().click();
  await page.waitForTimeout(1200);
  const modal = page.locator('.os-modal').last();
  await modal.waitFor({ timeout: 5000 });

  // Fill the form
  await modal.locator('label', { hasText: 'Other' }).first().click();
  await page.waitForTimeout(400);
  await modal.locator('input[placeholder*="Diwali"]').first().fill('SMOKE TDS test');
  await modal.locator('select').first().selectOption(DOC_ID); // source document
  await modal.locator('#vb-num').fill(INV);
  await modal.locator('#vb-date').fill('2026-07-07');
  await modal.locator('input[placeholder="Line 1 description"]').fill('smoke line');
  await modal.locator('input[placeholder="Net ₹"]').first().fill('1000');
  await modal.locator('#vb-tds-amt').fill('100');
  await modal.locator('select').last().selectOption('194C'); // TDS section
  await shot('vb-01-filled');

  await modal.getByRole('button', { name: /Save draft/i }).click();
  await page.waitForTimeout(6000);

  const bodyText = (await page.locator('body').textContent()) ?? '';
  const savedToast = /draft saved|Saved with \d+ flag/i.test(bodyText);
  const failToast = /Could not save|error occurred in the Server|s\.code|does not exist/i.test(bodyText);
  report('no 5xx during vendor bill save', serverErrors.length === 0, serverErrors.join('; '));
  report('vendor bill draft saved (TDS validation ran, no crash)', savedToast && !failToast, savedToast ? 'saved toast seen' : `no saved toast; fail=${failToast}`);
  await shot('vb-02-after-save');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('vb-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
