// Ad-hoc Playwright smoke test against production. Drives the OS through
// lock-screen → menubar → vendors edit/archive → attendance, capturing
// screenshots + console errors so the merge stack can be sanity-checked.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'https://apar-one-final.vercel.app';
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';

const OUT = path.resolve('./.screenshots-prod');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const events = [];
page.on('pageerror', (err) => events.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') events.push(`console.error: ${msg.text()}`);
});
page.on('requestfailed', (req) => events.push(`requestfailed: ${req.url()} — ${req.failure()?.errorText ?? ''}`));

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[shot] ${name}`);
}

async function step(label, run) {
  process.stdout.write(`→ ${label} ... `);
  const t0 = Date.now();
  try {
    await run();
    console.log(`ok (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`FAIL (${Date.now() - t0}ms): ${e.message}`);
    await shot(`fail-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    throw e;
  }
}

try {
  await step('Lock screen renders', async () => {
    await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.lock-screen__field input', { timeout: 15000 });
    await shot('01-lockscreen');
  });

  await step('Brand mark on lock-screen avatar', async () => {
    const hasMark = await page.locator('.lock-screen__avatar.is-mark img').count();
    if (!hasMark) throw new Error('selected avatar has no .is-mark image');
  });

  await step('Sign in', async () => {
    await page.locator('.lock-screen__field input').fill(PASSWORD);
    await page.locator('.lock-screen__submit').click();
    await page.waitForSelector('.menubar', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('02-desktop');
  });

  await step('Menubar wordmark is an SVG (not text)', async () => {
    const imgCount = await page.locator('.menubar .wordmark img').count();
    if (imgCount < 2) throw new Error(`expected 2 wordmark img variants, got ${imgCount}`);
    const lightSrc = await page.locator('.menubar .wordmark-img--light').getAttribute('src');
    if (!lightSrc?.includes('apar-orange.svg')) throw new Error(`light wordmark src wrong: ${lightSrc}`);
  });

  await step('Menubar admin avatar is brand mark', async () => {
    const adminAvatar = await page.locator('.menubar .avatar.avatar-mark img').count();
    if (!adminAvatar) throw new Error('menubar avatar is not the brand mark');
  });

  await step('Open Vendors via cmdk', async () => {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
    await page.locator('.cmdk-input input').fill('Open Vendors');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.window .main-header h2', { timeout: 8000 });
    await page.waitForTimeout(800);
    await shot('03-vendors');
  });

  await step('Vendor edit button is wired', async () => {
    const firstEdit = page.locator('.window .row-with-actions [title="Edit vendor"]').first();
    const editCount = await firstEdit.count();
    if (!editCount) throw new Error('no Edit vendor button — list may be empty');
    await firstEdit.click();
    await page.waitForSelector('.os-modal', { timeout: 4000 });
    await shot('04-vendor-edit-modal');
    // Close it without changes
    await page.locator('.os-form-actions .btn').first().click();
    await page.waitForTimeout(300);
  });

  await step('Vendor archive button labelled correctly', async () => {
    const archive = page.locator('.window .row-with-actions [title="Archive vendor"]').first();
    if (!(await archive.count())) throw new Error('Archive vendor button missing or still says Delete');
  });

  await step('Open Attendance', async () => {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
    await page.locator('.cmdk-input input').fill('Open Attendance');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.att-cell', { timeout: 8000 });
    await page.waitForTimeout(600);
    await shot('05-attendance');
  });

  await step('Attendance date stepper is present', async () => {
    const stepper = await page.locator('.att-date-picker').count();
    if (!stepper) throw new Error('.att-date-picker missing');
    const todayPill = await page.locator('.att-date-today-pill').count();
    if (!todayPill) throw new Error('Today pill missing (selected day should default to today)');
    const todayCell = await page.locator('.att-cell.is-today-col').count();
    if (!todayCell) throw new Error('No .is-today-col cells in matrix');
  });

  await step('Attendance step → next day', async () => {
    await page.locator('.att-date-step[aria-label="Next day"]').click();
    await page.waitForTimeout(200);
    // After stepping, no Today pill should be visible
    const todayPill = await page.locator('.att-date-today-pill').count();
    if (todayPill) throw new Error('Today pill should disappear after stepping');
    await shot('06-attendance-next-day');
  });

  await step('Toggle dark theme via menubar', async () => {
    // Open View menu → Theme: Dark (skip if menubar text differs)
    // Simpler: directly toggle by setting data-theme
    await page.evaluate(() => document.querySelector('.os-root')?.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);
    await shot('07-dark');
    const darkVis = await page.locator('.menubar .wordmark-img--dark').isVisible();
    const lightVis = await page.locator('.menubar .wordmark-img--light').isVisible();
    if (!darkVis || lightVis) throw new Error(`wordmark toggle broke (dark=${darkVis} light=${lightVis})`);
  });

  console.log('\n— ALL CHECKS PASSED —');
} catch (e) {
  console.log(`\n— ABORTED: ${e.message}`);
  process.exitCode = 1;
}

if (events.length) {
  console.log('\nConsole / network events observed:');
  for (const e of events) console.log(`  • ${e}`);
}

await browser.close();
