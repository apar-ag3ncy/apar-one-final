// Verify: client window shows Addresses ONLY in its dedicated tab — the
// Settings tab no longer duplicates the section.
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

  await cmdk('Open Accounts');
  await page
    .getByRole('button', { name: /Clients/ })
    .first()
    .click();
  await page.waitForTimeout(2500);

  // Open the first REAL client row (wait out the demo-seed race by waiting
  // for the list to settle, then clicking the first row).
  const list = page.locator('.window').last();
  await page.waitForTimeout(2000);
  const firstRow = list.locator('tbody tr, .client-row, [role="row"]').first();
  await firstRow.click();
  await page.waitForTimeout(3000);

  const cw = page.locator('.window').last();
  const tabs = (await cw.textContent()) ?? '';
  report(
    'client window opened with tabs',
    /Addresses/.test(tabs) && /Settings/.test(tabs),
    tabs.slice(0, 120),
  );

  // Addresses tab still renders the section
  await cw.getByText('Addresses', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const addrTab = (await cw.textContent()) ?? '';
  report(
    'Addresses tab renders the section',
    /(Add address|address|Registered|No addresses)/i.test(addrTab),
    addrTab.slice(0, 120),
  );
  await shot('addr-01-addresses-tab');

  // Settings tab must NOT render the addresses section anymore
  await cw.getByText('Settings', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const setTab = (await cw.textContent()) ?? '';
  report(
    'Settings tab has no Addresses section',
    !/Add address/i.test(setTab) && !/primary address/i.test(setTab),
    setTab.slice(0, 200),
  );
  await shot('addr-02-settings-tab');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('addr-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
