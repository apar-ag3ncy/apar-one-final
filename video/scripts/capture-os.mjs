/**
 * Capture real Apar OS screenshots for the intro video, at 4K DPI.
 *
 *   node video/scripts/capture-os.mjs
 *   BASE=https://<preview>.vercel.app node video/scripts/capture-os.mjs
 *
 * Viewport 1920x1080 @ deviceScaleFactor 2  ->  3840x2160 PNGs.
 * Reports read the production DB, so point BASE at prod (default) or a Vercel
 * preview — local dev shows DB errors for report windows.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'public', 'os');
fs.mkdirSync(OUT, { recursive: true });
const BASE = (process.env.BASE || 'https://apar-one-final.vercel.app') + '/os';
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
} catch {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
}
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});

const log = [];
async function fresh(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}
async function signIn(page) {
  try {
    const field = page.locator('.lock-screen__field input');
    await field.waitFor({ state: 'visible', timeout: 8000 });
    await field.fill(PASSWORD);
    await page.locator('.lock-screen__submit').click();
    await page.waitForTimeout(1500);
  } catch {
    /* already unlocked */
  }
}
async function cmd(page, label) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(700);
  const input = page.locator('.cmdk-input input');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.click();
  await input.fill(label);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
}
async function grab(page, name) {
  await page.addStyleTag({
    content: '*{transition:none!important;animation:none!important;caret-color:transparent!important}',
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 60000, animations: 'disabled' });
}
async function shot(name, label, waitDark = 0) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`));
  try {
    await fresh(page);
    await signIn(page);
    if (waitDark) await page.waitForTimeout(waitDark); // let dark theme apply
    if (label) await cmd(page, label);
    await grab(page, name);
    log.push(`[ok] ${name}`);
  } catch (e) {
    log.push(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

// Dark desktop (wait for the saved dark theme to apply before shooting).
await shot('desktop-dark', null, 4500);
// Feature windows (opened via the command palette).
await shot('trial-balance', 'Trial Balance');
await shot('pnl', 'Profit & Loss');
await shot('balance-sheet', 'Balance Sheet');
await shot('ar-aging', 'AR Aging');
await shot('statement', 'Statement of Account');

await browser.close();
console.log(log.join('\n'));
