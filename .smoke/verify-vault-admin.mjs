// Verify PR #94: vault password create + change from the admin console
// (Settings ▸ Users & Roles ▸ System ▸ Vault password).
// Round-trip on an EMPTY unconfigured vault; cleanup deletes the row after.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PASSWORD = process.env.OS_PASSWORD || 'apar2026';
const PW1 = 'smoke-vault-pass-1';
const PW2 = 'smoke-vault-pass-2';
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

  await cmdk('Open Settings');
  const win = page.locator('.window').last();
  await win.locator('.side-item', { hasText: 'Users & Roles' }).first().click();
  await page.waitForTimeout(1500);

  // System ▸ Vault password entry exists in the embedded console sidebar
  const vaultEntry = win.locator('.side-item', { hasText: 'Vault password' }).first();
  report('console sidebar has Vault password entry', (await vaultEntry.count()) > 0);
  await vaultEntry.click();
  await page.waitForTimeout(2000);
  await shot('vault-01-pane');

  const paneText = (await win.textContent()) ?? '';
  report(
    'unconfigured vault shows create form',
    /no password yet/i.test(paneText) && /Create vault password/.test(paneText),
    paneText.slice(paneText.indexOf('Vault password'), paneText.indexOf('Vault password') + 160),
  );

  // Create with mismatched confirm → inline error
  const inputs = win.locator('input[type="password"]');
  await inputs.nth(0).fill(PW1);
  await inputs.nth(1).fill('does-not-match');
  await win.getByRole('button', { name: 'Create vault password' }).click();
  await page.waitForTimeout(800);
  report('mismatch is rejected inline', /do not match/i.test((await win.textContent()) ?? ''));

  // Create for real
  await inputs.nth(1).fill(PW1);
  await win.getByRole('button', { name: 'Create vault password' }).click();
  await page.waitForTimeout(4000);
  await shot('vault-02-created');
  const afterCreate = (await win.textContent()) ?? '';
  report(
    'create flips pane to change form',
    /Current vault password/.test(afterCreate) && /Change vault password/.test(afterCreate),
  );

  // Change with WRONG current password → server error surfaced
  const ch = win.locator('input[type="password"]');
  await ch.nth(0).fill('totally-wrong-password');
  await ch.nth(1).fill(PW2);
  await ch.nth(2).fill(PW2);
  await win.getByRole('button', { name: 'Change vault password' }).click();
  await page.waitForTimeout(6000);
  report(
    'wrong current password is rejected',
    /current vault password is wrong/i.test((await win.textContent()) ?? ''),
  );
  await shot('vault-03-wrong-current');

  // Change with the CORRECT current password
  await ch.nth(0).fill(PW1);
  await ch.nth(1).fill(PW2);
  await ch.nth(2).fill(PW2);
  await win.getByRole('button', { name: 'Change vault password' }).click();
  await page.waitForTimeout(6000);
  const afterChange = (await win.textContent()) ?? '';
  // Success clears the fields and shows no inline error
  const fieldsCleared = (await ch.nth(0).inputValue()) === '' && (await ch.nth(1).inputValue()) === '';
  report(
    'correct current password changes it',
    fieldsCleared && !/wrong/i.test(afterChange),
    fieldsCleared ? 'fields cleared' : 'fields NOT cleared',
  );
  await shot('vault-04-changed');

  // The Settings ▸ Vault pane should now show the vault as configured (locked)
  await win.locator('.side-item', { hasText: 'Vault' }).first().click();
  await page.waitForTimeout(2500);
  const vaultPane = (await win.textContent()) ?? '';
  report('Settings Vault pane sees configured vault', /unlock/i.test(vaultPane), vaultPane.slice(0, 140));
  await shot('vault-05-vault-pane');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('vault-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
