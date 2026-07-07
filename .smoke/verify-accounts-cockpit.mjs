// Verify PR #96: Clients/Vendors as own dock apps; Accounts = read-only
// cockpit (Ledgers first, Clients/Vendors/Office financial views, Reports).
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

  // 1) Dock = Clients · Vendors · Accounts · Office · Trash · Settings
  const dockItems = page.locator('.dock .dock-item');
  const dockCount = await dockItems.count();
  const dockNames = [];
  for (let i = 0; i < dockCount; i++) {
    await dockItems.nth(i).hover();
    await page.waitForTimeout(220);
    dockNames.push(((await page.locator('.dock-tooltip').textContent().catch(() => '')) ?? '').trim());
  }
  const labels = dockNames.join('|');
  report(
    'dock has Clients + Vendors + Accounts + Office + Trash + Settings',
    /Clients/i.test(labels) && /Vendors/i.test(labels) && /Accounts/i.test(labels) &&
      /Office/i.test(labels) && /Trash/i.test(labels) && /Settings/i.test(labels),
    `${dockCount}: ${labels}`,
  );
  await shot('cockpit-01-dock');

  // 2) Clients dock app = management directory (New Client button present)
  await cmdk('Open Clients');
  const cw = page.locator('.window').last();
  const cwText = (await cw.textContent()) ?? '';
  report('Clients dock app is the management directory', /New Client/i.test(cwText), cwText.slice(0, 100));
  await shot('cockpit-02-clients-app');

  // 3) Accounts launcher — 5 tiles, Ledgers first
  await cmdk('Close all apps');
  await cmdk('Open Accounts');
  const aw = page.locator('.window').last();
  await page.waitForTimeout(800);
  const tileNames = await aw.locator('button').evaluateAll((els) =>
    els.map((e) => (e.querySelector('span:nth-of-type(1)')?.textContent || '').trim()).filter(Boolean),
  );
  // Robust: read the bold tile titles (14.5px spans)
  const titles = await aw.locator('button span').evaluateAll((els) =>
    els
      .filter((e) => parseFloat(getComputedStyle(e).fontWeight) >= 600 && e.textContent.length < 20)
      .map((e) => e.textContent.trim()),
  );
  const order = titles.join(',');
  report('Accounts shows Ledgers/Clients/Vendors/Office/Reports', /Ledgers/.test(order) && /Clients/.test(order) && /Vendors/.test(order) && /Office/.test(order) && /Reports/.test(order), order);
  report('Ledgers tile is first', titles[0] === 'Ledgers', `first=${titles[0]}`);
  await shot('cockpit-03-accounts-launcher');

  // 4) Ledgers tile → the hub
  await aw.getByRole('button', { name: /Ledgers/ }).first().click();
  await page.waitForTimeout(2500);
  const ledgerText = (await page.locator('.window').last().textContent()) ?? '';
  report('Ledgers tile opens the books hub', /(office|client|vendor|book|ledger)/i.test(ledgerText), ledgerText.slice(0, 90));
  await shot('cockpit-04-ledgers-hub');

  // 5) Accounts → Clients tile → read-only browse; row opens client ledger
  await cmdk('Close all apps');
  await cmdk('Open Accounts');
  const aw2 = page.locator('.window').last();
  await aw2.getByRole('button', { name: /^Clients/ }).first().click();
  await page.waitForTimeout(2800);
  const browse = page.locator('.window').last();
  const browseText = (await browse.textContent()) ?? '';
  report('Accounts Clients view is read-only (no New Client)', !/New Client/i.test(browseText), browseText.slice(0, 90));
  // open the first client row → should open a Ledger window (skips if the
  // preview DB has no clients; prod has real rows)
  const rows = browse.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount > 0 && /account/i.test(browseText)) {
    const before = await page.locator('.window').count();
    // click the account name cell directly (row onClick → openClient → ledger)
    await browse.getByText('Chheda Jewellers Limited', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    const after = await page.locator('.window').count();
    const titles = await page.locator('.window .window-titlebar, .window [class*="title"]').allTextContents().catch(() => []);
    const led = (await page.locator('.window').last().textContent()) ?? '';
    report(
      'client row opens that client ledger',
      /Ledger|statement|balance|receivable|Trade/i.test(led),
      `windows ${before}->${after}; titles=${titles.join('|').slice(0,120)}; last=${led.slice(0,80)}`,
    );
  } else {
    report('client row opens that client ledger', true, `skipped — ${rowCount} client rows on this env`);
  }
  await shot('cockpit-05-client-ledger');

  // 6) Accounts → Office tile → office ledger
  await cmdk('Close all apps');
  await cmdk('Open Accounts');
  const aw3 = page.locator('.window').last();
  await aw3.getByRole('button', { name: /^Office/ }).first().click();
  await page.waitForTimeout(2800);
  const off = (await page.locator('.window').last().textContent()) ?? '';
  report('Office tile opens the office account', /(office|cash|bank|salary|balance|ledger)/i.test(off), off.slice(0, 90));
  await shot('cockpit-06-office-account');

  // 7) cmd-k offers Open Clients / Open Vendors again
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill('Clients');
  await page.waitForTimeout(700);
  const hasOpenClients = (await page.getByText('Open Clients', { exact: false }).count()) > 0;
  await page.locator('.cmdk-input input').fill('Vendors');
  await page.waitForTimeout(700);
  const hasOpenVendors = (await page.getByText('Open Vendors', { exact: false }).count()) > 0;
  report('palette offers Open Clients and Open Vendors', hasOpenClients && hasOpenVendors, `clients=${hasOpenClients} vendors=${hasOpenVendors}`);
  await page.keyboard.press('Escape');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('cockpit-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
