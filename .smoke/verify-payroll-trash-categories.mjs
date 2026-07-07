// Verify PR #95 on the Vercel preview (prod DB — everything created here is
// cleaned up at the end):
//  A. bonus: record → delete → appears in Trash → restore → delete → dispose
//  B. salary update: create version → delete (heal) → Trash section → dispose
//  C. salary payment: record ₹1 → delete (reverses) → Trash → dispose
//  D. category: create via expense form → Manage modal shows count → bulk
//     move → delete when empty → dispose from Trash; smoke expense deleted.
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

// Poll until a locator's count matches, instead of a single instant check.
async function waitCount(locator, predicate, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const n = await locator.count();
    if (predicate(n)) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Fill a labelled input by its label text, scoped to a container. Works for
// both the OS `.os-field` wrapper and the comp-section's plain <label>.
async function fillField(scope, label, value) {
  const field = scope.locator('.os-field, label', { hasText: label }).first();
  await field.locator('input, select, textarea').first().fill(value);
}

try {
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock-screen__field input', { timeout: 25000 });
  await page.locator('.lock-screen__field input').fill(PASSWORD);
  await page.locator('.lock-screen__submit').click();
  await page.waitForSelector('.menubar', { timeout: 15000 });
  await page.waitForTimeout(1200);

  /* ---- open Devraj's Compensation tab --------------------------------- */
  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  const nameCard = page.locator('.emp-card', { hasText: 'Devraj Pillay' }).first();
  await nameCard.waitFor({ timeout: 25000 });
  await page.waitForTimeout(800);
  await nameCard.click();
  await page.waitForTimeout(3500);
  const ew = page.locator('.window').last();
  await ew.getByText('Compensation', { exact: true }).first().click();
  await page.waitForTimeout(3000);

  /* ---- A. bonus round-trip -------------------------------------------- */
  const bonusCard = ew.locator('.os-card, [class*="card"]', { hasText: 'Bonuses' }).first();
  await ew.getByRole('button', { name: '+ Record', exact: true }).click();
  await page.waitForTimeout(800);
  await fillField(ew, 'Date', new Date().toISOString().slice(0, 10));
  await fillField(ew, 'Amount (₹)', '1');
  await fillField(ew, 'Description', 'Smoke bonus (test)');
  await ew.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForTimeout(3500);
  const bonusRow = ew.locator('li', { hasText: 'Smoke bonus (test)' }).first();
  report('bonus recorded', (await bonusRow.count()) > 0);
  await bonusRow.locator('button[title*="Trash"]').first().click();
  report(
    'bonus delete leaves list',
    await waitCount(ew.locator('li', { hasText: 'Smoke bonus (test)' }), (n) => n === 0),
  );
  await shot('pt-01-bonus-deleted');

  /* ---- B. salary update round-trip ------------------------------------ */
  await ew.getByRole('button', { name: '+ New version' }).click();
  await page.waitForTimeout(800);
  await fillField(ew, 'Effective from', new Date().toISOString().slice(0, 10));
  await fillField(ew, 'Monthly CTC (₹)', '1000');
  await fillField(ew, 'Basic (₹)', '1000');
  await ew.getByRole('button', { name: 'Save salary version' }).click();
  report(
    'salary history visible after create',
    await waitCount(ew.locator('h3', { hasText: 'Salary history' }), (n) => n > 0, 20000),
  );
  await page.waitForTimeout(1500);
  // delete the newest version (first row ✕)
  const histTable = ew.locator('table', { hasText: 'Monthly CTC' }).first();
  await histTable.locator('button[title*="Trash"]').first().click();
  await page.waitForTimeout(3000);
  await shot('pt-02-structure-deleted');

  /* ---- C. salary payment round-trip ------------------------------------ */
  await ew.getByRole('button', { name: '+ Record payment' }).click();
  await page.waitForTimeout(2000);
  await ew.getByRole('button', { name: 'Cash', exact: true }).click();
  await fillField(ew, 'Amount paid (₹)', '1');
  await ew.getByRole('button', { name: 'Record payment', exact: true }).click();
  const payRow = ew.locator('li', { hasText: 'Remove this payment' });
  const payRowByBtn = ew.locator('li:has(button[title="Remove this payment"])');
  report(
    '₹1 salary payment recorded',
    await waitCount(payRowByBtn, (n) => n > 0, 25000),
  );
  await payRowByBtn.first().locator('button[title="Remove this payment"]').click();
  report(
    'payment delete leaves list',
    await waitCount(payRowByBtn, (n) => n === 0, 25000),
  );
  await shot('pt-03-payment-deleted');

  /* ---- Trash: three payroll sections + restore/dispose ----------------- */
  await cmdk('Close all apps');
  await cmdk('Open Trash');
  const tw = page.locator('.window').last();
  await waitCount(tw.locator('text=Payroll'), (n) => n > 0, 30000);
  const trashText = (await tw.textContent()) ?? '';
  report('Trash has salary payments section', /Payroll — salary payments/.test(trashText));
  report('Trash has salary updates section', /Payroll — salary updates/.test(trashText));
  report('Trash has bonuses section', /Payroll — bonuses/.test(trashText));
  await shot('pt-04-trash-sections');

  // restore the bonus, verify it disappears from Trash
  const bonusTrashRow = tw.locator('[class*="row"], li, tr', { hasText: 'Smoke bonus (test)' }).first();
  await bonusTrashRow.getByRole('button', { name: 'Restore' }).click();
  await page.waitForTimeout(3000);
  report('bonus restored out of Trash', !((await tw.textContent()) ?? '').includes('Smoke bonus (test)'));

  // dispose payment + structure permanently (accept confirm dialogs if any)
  page.on('dialog', (d) => void d.accept());
  for (const label of ['₹1 —', 'CTC ₹10']) {
    const row = tw.locator('[class*="row"], li, tr', { hasText: label }).first();
    if ((await row.count()) > 0) {
      const btn = row.getByRole('button', { name: /Delete|Dispose|forever/i }).last();
      await btn.click();
      await page.waitForTimeout(2500);
    }
  }
  await shot('pt-05-trash-after-dispose');

  /* ---- re-delete restored bonus, then dispose it ----------------------- */
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page.getByRole('button', { name: /^Team/ }).first().click();
  await page.locator('.emp-card', { hasText: 'Devraj Pillay' }).first().waitFor({ timeout: 25000 });
  await page.locator('.emp-card', { hasText: 'Devraj Pillay' }).first().click();
  await page.waitForTimeout(3000);
  const ew2 = page.locator('.window').last();
  await ew2.getByText('Compensation', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const restoredBonus = ew2.locator('li', { hasText: 'Smoke bonus (test)' }).first();
  report('restored bonus back on Compensation tab', (await restoredBonus.count()) > 0);
  if ((await restoredBonus.count()) > 0) {
    await restoredBonus.locator('button[title*="Trash"]').first().click();
    await page.waitForTimeout(3000);
  }
  await cmdk('Close all apps');
  await cmdk('Open Trash');
  await page.waitForTimeout(2500);
  const tw2 = page.locator('.window').last();
  const bonusAgain = tw2.locator('[class*="row"], li, tr', { hasText: 'Smoke bonus (test)' }).first();
  if ((await bonusAgain.count()) > 0) {
    await bonusAgain.getByRole('button', { name: /Delete|Dispose|forever/i }).last().click();
    await page.waitForTimeout(2500);
  }

  /* ---- D. category: create → move → delete ----------------------------- */
  await cmdk('Close all apps');
  await cmdk('Open Office');
  await page.getByRole('button', { name: /Expenses/ }).first().click();
  await page.waitForTimeout(3500);
  const ow = page.locator('.window').last();
  await ow.getByRole('button', { name: 'New Expense' }).click();
  await page.waitForTimeout(1000);
  const modal = page.locator('.os-modal').last();
  await fillField(modal, 'Description', 'Smoke cat entry (test)');
  await fillField(modal, 'Amount', '1');
  // pick "Create new" in the category select
  const catField = modal.locator('.os-field', { hasText: 'Category' }).first();
  await catField.locator('select').first().selectOption('__create__');
  await page.waitForTimeout(800);
  await modal.locator('input[placeholder*="Subscriptions"]').first().fill('Smoke Test Cat');
  await modal.getByRole('button', { name: 'Create category' }).click();
  await page.waitForTimeout(2500);
  await modal.getByRole('button', { name: /Save expense|^Save$|Add expense|Log expense/i }).last().click();
  await page.waitForTimeout(5000);
  const chips = (await ow.textContent()) ?? '';
  report('custom category chip appears', /Smoke Test Cat/.test(chips));
  await shot('pt-06-category-created');

  // Manage → move → delete
  await ow.getByRole('button', { name: /Manage/ }).click();
  await page.waitForTimeout(2500);
  const mm = page.locator('.os-modal').last();
  const catRow = mm.locator('div', { hasText: 'Smoke Test Cat' }).last();
  report('manage modal shows 1 entry', /1 entry/.test((await mm.textContent()) ?? ''));
  await catRow.locator('select').first().selectOption('stationary');
  await catRow.getByRole('button', { name: /Move 1/ }).click();
  await page.waitForTimeout(6000);
  const afterMove = (await mm.textContent()) ?? '';
  report('entries moved (0 left)', /0 entries/.test(afterMove), afterMove.slice(0, 150));
  await mm.locator('div', { hasText: 'Smoke Test Cat' }).last().getByRole('button', { name: /Delete/ }).click();
  await page.waitForTimeout(3000);
  report('category deleted from manage modal', !/Smoke Test Cat/.test((await page.locator('.os-modal').last().textContent().catch(() => '')) ?? ''));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  await shot('pt-07-category-deleted');

  // cleanup: delete the smoke expense (existing hard-delete flow)
  const expRow = ow.locator('tr', { hasText: 'Smoke cat entry (test)' }).first();
  if ((await expRow.count()) > 0) {
    await expRow.hover();
    await expRow.locator('button[title*="Delete" i], button[title*="Remove" i]').last().click();
    await page.waitForTimeout(1200);
    const confirm = page.locator('.os-modal').last();
    await confirm.getByRole('button', { name: /Delete/i }).last().click();
    await page.waitForTimeout(4000);
  }
  report('smoke expense cleaned up', (await ow.locator('tr', { hasText: 'Smoke cat entry (test)' }).count()) === 0);

  // dispose the category from Trash
  await cmdk('Close all apps');
  await cmdk('Open Trash');
  await page.waitForTimeout(2500);
  const tw3 = page.locator('.window').last();
  const catTrash = tw3.locator('[class*="row"], li, tr', { hasText: 'Smoke Test Cat' }).first();
  if ((await catTrash.count()) > 0) {
    await catTrash.getByRole('button', { name: /Delete|Dispose|forever/i }).last().click();
    await page.waitForTimeout(2500);
  }
  report('category disposed from Trash', !((await tw3.textContent()) ?? '').includes('Smoke Test Cat'));
  await shot('pt-08-final-trash');
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await shot('pt-99-error');
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
