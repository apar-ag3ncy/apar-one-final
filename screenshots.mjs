import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('./.screenshots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const errors = [];

async function shot(name, run) {
  const page = await ctx.newPage();
  page.on('pageerror', (err) => errors.push(`${name} pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name} console.error: ${msg.text()}`);
  });
  const start = Date.now();
  await run(page);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[ok] ${name} -> ${file} (${Date.now() - start}ms)`);
  await page.close();
}

async function freshSession(page) {
  await page.goto('http://localhost:3000/os', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
}

async function signIn(page) {
  await page.locator('.lock-screen__field input').fill('apar2026');
  await page.locator('.lock-screen__submit').click();
  await page.waitForTimeout(900);
}

async function openClientDetail(page) {
  // Open Clients, click the first row to bring up its detail window.
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(200);
  await page.locator('.cmdk-input input').fill('Open Clients');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.locator('.row-with-actions').first().click();
  await page.waitForTimeout(700);
}

// 1. Overview tab (default) — primary actions are just Edit + Delete.
await shot('tabs-1-overview', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
});

// 2. Contacts tab — "+ Add Contact" appears in the header.
await shot('tabs-2-contacts', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
  await page.getByText('Contacts', { exact: true }).first().click();
  await page.waitForTimeout(500);
});

// 3. Projects tab — "+ New Project" appears.
await shot('tabs-3-projects', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
  await page.getByText('Projects', { exact: true }).first().click();
  await page.waitForTimeout(500);
});

// 4. Documents tab — "+ Upload Document" appears. Click it to open the modal.
await shot('tabs-4-documents', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
  await page.getByText('Documents', { exact: true }).first().click();
  await page.waitForTimeout(500);
});

// 5. Documents tab with upload modal open.
await shot('tabs-5-upload-modal', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
  await page.getByText('Documents', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Upload Document/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder(/MSA_v3_signed/).fill('Royal_Enfield_MSA_v1.pdf');
});

// 6. Ledger tab — "+ Record Transaction" appears.
await shot('tabs-6-ledger', async (page) => {
  await freshSession(page);
  await signIn(page);
  await openClientDetail(page);
  await page.getByText('Ledger', { exact: true }).first().click();
  await page.waitForTimeout(500);
});

await browser.close();

if (errors.length) {
  console.log('\n--- runtime errors observed ---');
  for (const e of errors) console.log(e);
  process.exit(2);
}
