// Verify: deactivating an employee badges them "Inactive" (not "On leave"),
// then immediately reactivate to restore state.
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

  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  // Wait for a real DB row, not the demo seed
  await page.waitForSelector('.emp-card', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const card = page.locator('.emp-card').first();
  const who = ((await card.locator('.name').first().textContent()) ?? '').trim();

  // Deactivate from the card's hover actions
  await card.hover();
  const deactivate = card.locator('button', { hasText: /deactivate/i }).first();
  if ((await deactivate.count()) === 0) {
    // Some builds put it behind an icon button with a title
    await card.locator('[title*="eactivate"]').first().click();
  } else {
    await deactivate.click();
  }
  await page.waitForTimeout(3000);
  await shot('inact-01-after-deactivate');

  // The card moves to the Inactive group; find it by name anywhere in the grid
  const win = page.locator('.window').last();
  const target = win.locator('.emp-card', { hasText: who }).first();
  const badge = ((await target.textContent()) ?? '').trim();
  report('deactivated badge says Inactive', /Inactive/.test(badge) && !/On leave/i.test(badge), badge.slice(0, 120));

  // Restore: reactivate the same card
  await target.hover();
  const activate = target.locator('button', { hasText: /activate/i }).first();
  if ((await activate.count()) > 0) {
    await activate.click();
  } else {
    await target.locator('[title*="ctivate"]').first().click();
  }
  await page.waitForTimeout(3000);
  const after = ((await win.locator('.emp-card', { hasText: who }).first().textContent()) ?? '').trim();
  report('reactivated back to Active', /Active/.test(after) && !/Inactive/.test(after), after.slice(0, 120));
  await shot('inact-02-restored');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('inact-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
