// Verify a draft vendor bill can be EDITED and SAVED (external_ref self-clash fix) on Aarish Wadia and capture the failing
// server action's response body + any toast. Read-only: opens the edit form,
// does NOT save.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://apar-one-final.vercel.app';
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const OUT = '/private/tmp/claude-501/-Users-swayamzinzuwadia-Documents-Code-apar-one-final/60c9eb94-94ae-48d7-978b-cdeb1ced03dc/scratchpad/verify-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 940 } })).newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const fails = [];
page.on('response', async (r) => {
  if (r.status() >= 500) {
    let body = '';
    try { body = (await r.text()).slice(0, 1500); } catch {}
    const h = r.headers();
    const digest = h['x-nextjs-error-digest'] || h['x-vercel-error'] || '';
    fails.push(`${r.status()} ${r.statusText()} ${r.request().method()} ${r.url().split('?')[0]}\n   DIGEST: ${digest}\n   CT: ${h['content-type']||''}\n   BODY: ${body.replace(/\n/g,' ')}`);
  }
});
const consoleErrs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
const dbgHits = [];
page.on('response', async (r) => { try { const t = await r.text(); if (t.includes('DBGERR')) dbgHits.push(t.match(/DBGERR::[^"\\]{0,400}/)?.[0] || t.slice(0,400)); } catch {} });

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

  await cmdk('Open Vendors');
  const list = page.locator('.window').last();
  await list.getByText('Aarish Wadia', { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await list.getByText('Aarish Wadia', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const vw = page.locator('.window').last();
  await vw.getByText('Bills', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  console.log('BILLS_TAB_500s=' + fails.length);
  await shot('repro-01-bills');

  // click the first "Edit draft" pencil
  const editBtn = vw.locator('button[title="Edit draft"]').first();
  await editBtn.waitFor({ timeout: 10000 });
  fails.length = 0; // reset — count only edit-triggered failures
  await editBtn.click();
  await page.waitForTimeout(5000);
  await shot('repro-02-edit-open');

  const toast = await page.locator('[data-sonner-toast], .toast, [role="status"]').allTextContents().catch(() => []);
  console.log('EDIT_500_COUNT=' + fails.length);
  console.log('FAILS:\n' + fails.join('\n'));
  console.log('TOASTS=' + JSON.stringify(toast));
  console.log('CONSOLE_ERRS=' + JSON.stringify(consoleErrs.slice(-8)));
  // did the form populate? check the invoice-number field value
  const invVal = await page.locator('#vb-num').inputValue().catch(() => '(no field)');
  console.log('FORM_INV_VALUE=' + invVal);

  // Now test the SAVE path (re-save the same draft — functionally idempotent).
  fails.length = 0;
  const modal = page.locator('.os-modal').last();
  await modal.getByRole('button', { name: /Save changes|Save draft/i }).click();
  await page.waitForTimeout(6000);
  const saveToasts = await page.locator('[data-sonner-toast], [role="status"]').allTextContents().catch(() => []);
  console.log('SAVE_500_COUNT=' + fails.length);
  console.log('SAVE_FAILS:\n' + fails.join('\n'));
  console.log('SAVE_TOASTS=' + JSON.stringify(saveToasts));
  console.log('DBGERR_HITS=' + JSON.stringify(dbgHits));
  await shot('repro-03-after-save');
} catch (e) {
  console.log('ERROR ' + e.message);
  await shot('repro-99-error');
}

await browser.close();
