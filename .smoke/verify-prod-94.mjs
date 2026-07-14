// Prod check for PR #94 — read-only: vault pane renders (NO submit, prod
// vault must stay unconfigured), client Settings tab has no Addresses dup.
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

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // 1) Vault password pane in Users & Roles (render only — DO NOT submit)
  await cmdk('Open Settings');
  const win = page.locator('.window').last();
  await win.locator('.side-item', { hasText: 'Users & Roles' }).first().click();
  await page.waitForTimeout(1500);
  await win.locator('.side-item', { hasText: 'Vault password' }).first().click();
  await page.waitForTimeout(2500);
  const pane = (await win.textContent()) ?? '';
  report(
    'vault pane renders create form (unconfigured)',
    /no password yet/i.test(pane) && /Create vault password/.test(pane),
    pane.slice(pane.indexOf('System'), pane.indexOf('System') + 120),
  );
  await shot('prod94-01-vault-pane');

  // 2) Client window: Addresses only in its own tab
  await cmdk('Close all apps');
  await cmdk('Open Accounts');
  await page
    .getByRole('button', { name: /Clients/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const list = page.locator('.window').last();
  // Wait for a real DB row (demo seed swaps out async), then click its name
  // cell — the row's own onClick opens the client window.
  const nameCell = list.getByText('Chheda Jewellers Limited', { exact: true }).first();
  await nameCell.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await nameCell.click();
  await page.waitForTimeout(4000);

  const cw = page.locator('.window').last();
  await cw.getByText('Settings', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const setTab = (await cw.textContent()) ?? '';
  report(
    'client Settings tab has no Addresses section',
    /LIFECYCLE|Delete moves this client/i.test(setTab) && !/Add address/i.test(setTab),
  );
  await cw.getByText('Addresses', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  report(
    'Addresses tab still renders',
    /Add address|No addresses/i.test((await cw.textContent()) ?? ''),
  );
  await shot('prod94-02-client');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('prod94-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
