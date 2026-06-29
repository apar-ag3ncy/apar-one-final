// Headless verification of the new "Payments" tab on the Vercel preview.
// READ-ONLY: logs in, opens the client & vendor Payments tabs, asserts the
// "Due to collect / pay" cards + record dialogs render (exercising every new
// server-action read path against the prod DB) — never submits a payment.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const CLIENT_ID = process.env.CLIENT_ID;
const VENDOR_ID = process.env.VENDOR_ID;
if (!BASE || !CLIENT_ID || !VENDOR_ID) {
  console.error('Set BASE, CLIENT_ID, VENDOR_ID');
  process.exit(2);
}

const OUT = path.resolve('./.screenshots-verify');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const events = [];
page.on('pageerror', (e) => events.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && events.push(`console.error: ${m.text()}`));
page.on('requestfailed', (r) => events.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => {
  if (r.status() >= 500) events.push(`http${r.status()}: ${r.url()}`);
});

async function shot(n) {
  await page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: false });
  console.log(`[shot] ${n}`);
}
async function step(label, run) {
  process.stdout.write(`→ ${label} ... `);
  try {
    await run();
    console.log('ok');
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    await shot(`fail-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    throw e;
  }
}

async function openPaymentsTab() {
  // Radix Tabs trigger; fall back to any element with the label.
  const tab = page.getByRole('tab', { name: 'Payments' });
  if (await tab.count()) await tab.first().click();
  else await page.getByText('Payments', { exact: true }).first().click();
  await page.waitForTimeout(1500);
}

try {
  await step('Sign in', async () => {
    await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.lock-screen__field input', { timeout: 20000 });
    await page.locator('.lock-screen__field input').fill(PASSWORD);
    await page.locator('.lock-screen__submit').click();
    await page.waitForSelector('.menubar', { timeout: 20000 });
  });

  await step('Client → Payments tab renders Due to collect', async () => {
    await page.goto(`${BASE}/clients/${CLIENT_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await openPaymentsTab();
    await page.waitForSelector('text=Due to collect', { timeout: 15000 });
    if (await page.getByText('Could not load payments').count()) {
      throw new Error('client Payments tab errored (read path failed)');
    }
    await shot('01-client-payments');
  });

  await step('Client → Record dialog populates bank + open invoices', async () => {
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await page.waitForSelector('.os-modal', { timeout: 8000 });
    await page.waitForTimeout(1200);
    const selectCount = await page.locator('.os-modal select').count();
    if (selectCount < 1) throw new Error('no bank/method selects in the receipt dialog');
    const bankOpts = await page.locator('.os-modal select').first().locator('option').count();
    console.log(`   bank options=${bankOpts}, selects=${selectCount}`);
    await shot('02-client-record-dialog');
    // Close without submitting (no mutation).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });

  await step('Vendor → Payments tab renders Due to pay', async () => {
    await page.goto(`${BASE}/vendors/${VENDOR_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await openPaymentsTab();
    await page.waitForSelector('text=Due to pay', { timeout: 15000 });
    if (await page.getByText('Could not load payments').count()) {
      throw new Error('vendor Payments tab errored (read path failed)');
    }
    await shot('03-vendor-payments');
  });

  await step('Vendor → Record dialog populates bank picker', async () => {
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await page.waitForSelector('.os-modal', { timeout: 8000 });
    await page.waitForTimeout(1000);
    const bankOpts = await page.locator('.os-modal select').first().locator('option').count();
    console.log(`   bank options=${bankOpts}`);
    if (bankOpts < 2) throw new Error('vendor payment dialog has no agency bank options');
    await shot('04-vendor-record-dialog');
    await page.keyboard.press('Escape');
  });

  console.log('\n— PAYMENTS READ-PATH VERIFICATION PASSED —');
} catch (e) {
  console.log(`\n— ABORTED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (events.length) {
    console.log('\nConsole / network events:');
    for (const e of events) console.log(`  • ${e}`);
  } else {
    console.log('\nNo console/network errors observed.');
  }
  await browser.close();
}
