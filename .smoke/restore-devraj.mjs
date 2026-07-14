// Restore Devraj Pillay to active; verify Inactive badge along the way.
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

  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  await page.waitForSelector('.emp-card', { timeout: 20000 });
  // Wait for the real dataset (Devraj is hidden while inactive, so key on a
  // stable real teammate instead)
  await page.locator('.emp-card', { hasText: 'Rita Rathod' }).first().waitFor({ timeout: 20000 });

  const win = page.locator('.window').last();
  await win.locator('[aria-label="Show separated teammates"]').first().click();
  await page.waitForTimeout(1500);
  await shot('restore-01-show-inactive');

  const target = win.locator('.emp-card', { hasText: 'Devraj Pillay' }).first();
  await target.waitFor({ timeout: 10000 });
  const badge = ((await target.textContent()) ?? '').trim();
  report(
    'badge says Inactive (not On leave)',
    /Inactive/.test(badge) && !/On leave/i.test(badge),
    badge.slice(0, 140),
  );

  // Reactivate via the card's status toggle
  await target.hover();
  const toggle = target.locator('.toggle, [role="switch"]').first();
  if ((await toggle.count()) > 0) {
    await toggle.click();
  } else {
    await target
      .locator('button', { hasText: /activate/i })
      .first()
      .click();
  }
  await page.waitForTimeout(3000);
  await shot('restore-02-after-reactivate');

  const after = (
    (await win.locator('.emp-card', { hasText: 'Devraj Pillay' }).first().textContent()) ?? ''
  ).trim();
  report(
    'Devraj restored to Active',
    /Active/.test(after) && !/Inactive/.test(after),
    after.slice(0, 140),
  );
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('restore-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
