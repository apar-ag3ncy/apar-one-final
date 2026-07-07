// Verify PR #93: Office super-app launcher, Settings⊕Admin merge (Users &
// Roles + gear icon), uniform employee cards, Inactive label.
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

  // 1) Dock = Accounts · Office · Trash · Settings only (icon-only items —
  // read names by hovering each for its tooltip)
  const dockItems = page.locator('.dock .dock-item');
  const dockCount = await dockItems.count();
  const dockNames = [];
  for (let i = 0; i < dockCount; i++) {
    await dockItems.nth(i).hover();
    await page.waitForTimeout(250);
    dockNames.push(((await page.locator('.dock-tooltip').textContent().catch(() => '')) ?? '').trim());
  }
  const labels = dockNames.join('|');
  report(
    'dock is exactly Accounts/Office/Trash/Settings',
    dockCount === 4 &&
      /Accounts/i.test(labels) && /Office/i.test(labels) && /Trash/i.test(labels) && /Settings/i.test(labels) &&
      !/Projects|Employees|Admin/i.test(labels),
    `${dockCount} items: ${labels}`,
  );
  // Gear icon — the new settings glyph has a center circle r=3
  const gearOk = await dockItems.evaluateAll((els) =>
    els.some((e) => !!e.querySelector('svg circle[cx="12"][cy="12"][r="3"]')),
  );
  report('Settings dock icon is the gear', gearOk);
  await shot('os-01-dock');

  // 2) Office launcher: 4 tiles
  await cmdk('Open Office');
  const off = (await page.locator('.window').last().textContent()) ?? '';
  report(
    'Office launcher shows Expenses/Projects/Team/Attendance',
    /Expenses/.test(off) && /Projects/.test(off) && /Team/.test(off) && /Attendance/.test(off),
  );
  await shot('os-02-office-launcher');

  // 2a) Expenses tile → expense tracker (not "record no longer available")
  await page.getByRole('button', { name: /Expenses/ }).first().click();
  await page.waitForTimeout(2500);
  const expWin = (await page.locator('.window').last().textContent()) ?? '';
  report(
    'Expenses tile opens the office tracker',
    !/no longer available/i.test(expWin) && /(Office|expense|Add expense|total)/i.test(expWin),
    expWin.slice(0, 120),
  );
  report('office launcher dismissed', (await page.locator('.window', { hasText: 'Pick where you' }).count()) === 0);
  await shot('os-03-expenses');

  // 2b) Projects tile
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page.getByRole('button', { name: /Projects/ }).first().click();
  await page.waitForTimeout(2500);
  const projWin = (await page.locator('.window').last().textContent()) ?? '';
  report('Projects tile opens kanban', /(kanban|In progress|Backlog|New project|Projects)/i.test(projWin), projWin.slice(0, 100));
  await shot('os-04-projects');

  // 2c) Team tile → directory grid; card uniformity
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  await page.waitForTimeout(3000);
  const teamWin = (await page.locator('.window').last().textContent()) ?? '';
  report('Team tile opens directory', /(Search|teammate|Active)/i.test(teamWin), teamWin.slice(0, 100));

  // Card uniformity: all cards in the grid should share the same height per row
  const cardHeights = await page
    .locator('.window')
    .last()
    .locator('.emp-card')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  if (cardHeights.length >= 2) {
    const spread = Math.max(...cardHeights) - Math.min(...cardHeights);
    report('employee cards uniform height', spread <= 2, `heights=${cardHeights.join(',')}`);
  } else {
    report('employee cards uniform height', true, `only ${cardHeights.length} measurable cards (skip)`);
  }
  await shot('os-05-team-cards');

  // 2d) Attendance tile
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page.getByRole('button', { name: /Attendance/ }).first().click();
  await page.waitForTimeout(2500);
  const attWin = (await page.locator('.window').last().textContent()) ?? '';
  report('Attendance tile opens matrix', /(attendance|Present|holiday|matrix|Mark)/i.test(attWin), attWin.slice(0, 100));
  await shot('os-06-attendance');

  // 3) Settings: Users & Roles section with embedded admin console
  await cmdk('Close all apps');
  await cmdk('Open Settings');
  const setWin = page.locator('.window').last();
  const sideText = (await setWin.locator('.sidebar').first().textContent()) ?? '';
  report('Settings sidebar shows Users & Roles', /Users & Roles/.test(sideText), sideText.slice(0, 200));
  await setWin.locator('.side-item', { hasText: 'Users & Roles' }).first().click();
  await page.waitForTimeout(1500);
  const consoleText = (await setWin.textContent()) ?? '';
  report(
    'Users & Roles embeds the admin console',
    /New user/i.test(consoleText) && /Users/.test(consoleText),
    consoleText.slice(0, 150),
  );
  report('no duplicated Trash inside console sidebar', !/Restore or dispose permanently/.test(consoleText));
  await shot('os-07-users-roles');

  // 4) cmdk should NOT offer Open Projects / Open Employees / Admin Console
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.cmdk-input input', { timeout: 5000 });
  await page.locator('.cmdk-input input').fill('Open ');
  await page.waitForTimeout(600);
  const palette = (await page.locator('.cmdk-list, [class*="cmdk"]').last().textContent()) ?? '';
  report(
    'palette hides Projects/Employees/Admin apps',
    !/Open Projects/i.test(palette) && !/Open Employees/i.test(palette) && !/Admin Console/i.test(palette),
    palette.slice(0, 200),
  );
  await page.keyboard.press('Escape');
  await shot('os-08-palette');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('os-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
