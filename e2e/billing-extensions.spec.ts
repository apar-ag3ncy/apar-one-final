import { expect, test } from '@playwright/test';

/**
 * E2E for the billing extensions (PR: invoice types, manual number,
 * multi-address, project pickers). Drives the OS desktop end-to-end:
 *   - unlocks the demo OS
 *   - creates a billing-ready client (GSTIN + PAN + registered address)
 *   - verifies the new "Addresses" tab + the registered address + Primary badge
 *   - opens the invoice composer and asserts the four new controls
 *     (Document type, Invoice number prefilled, Project, Bill to)
 *   - switches to Proforma and confirms the out-of-sequence number warning
 *
 * Target a dev server on the local `apar_run` DB (default) or a Preview via
 * E2E_BASE_URL. The client is named uniquely per run and archived on teardown.
 */

const DEMO_PASSWORD = 'apar2026';
const CLIENT_NAME = `E2E Billing ${Date.now().toString(36)}`;

test('billing extensions render and behave end-to-end', async ({ page }) => {
  // 1) Unlock the OS.
  await page.goto('/os');
  const password = page.getByPlaceholder('Enter Password');
  if (await password.isVisible().catch(() => false)) {
    await password.fill(DEMO_PASSWORD);
    await password.press('Enter');
    await expect(password).toBeHidden({ timeout: 30_000 });
  }

  // 2) Open the Clients app (URL-restored window — robust vs desktop icons).
  await page.goto('/os?windows=w1&w1=clients');
  const newClient = page.getByRole('button', { name: 'New Client' });
  await expect(newClient).toBeVisible({ timeout: 30_000 });

  // 3) Create a billing-ready client: GSTIN + PAN + a registered address.
  await newClient.click();
  await page.getByPlaceholder('e.g. Asian Paints').fill(CLIENT_NAME);
  await page.getByPlaceholder('FMCG').fill('Media');
  await page.getByPlaceholder('27ABCDE1234F1Z5').fill('29ABCDE1234F1Z5'); // Karnataka
  await page.getByPlaceholder('ABCDE1234F', { exact: true }).fill('ABCDE1234F'); // PAN (exact: GSTIN placeholder contains this)
  await page
    .getByPlaceholder('Registered office address')
    .fill('5 Residency Road, Bengaluru 560025');
  await page.getByRole('button', { name: 'Create client' }).click();

  // Success toast confirms creation, and the client window opens.
  await expect(page.getByText(`Client "${CLIENT_NAME}" created.`)).toBeVisible({ timeout: 30_000 });

  // 4) Addresses tab exists and shows the registered address as Primary.
  await page.locator('.tab', { hasText: 'Addresses' }).click();
  await expect(page.getByText('5 Residency Road, Bengaluru', { exact: false })).toBeVisible();
  await expect(page.getByText('Primary', { exact: true }).first()).toBeVisible();

  // 4b) Add a second address (multi-address) — this also makes the composer's
  // bill-to selector, which only appears with ≥2 addresses, available.
  await page.getByRole('button', { name: 'Add address' }).click();
  const addrDialog = page.getByRole('dialog');
  await addrDialog
    .getByLabel('Address line 1', { exact: true })
    .fill('Plot 4, Bandra Kurla Complex');
  await addrDialog.getByLabel('City', { exact: true }).fill('Mumbai');
  await addrDialog.getByLabel('State code', { exact: true }).fill('MH');
  await addrDialog.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByText('Plot 4, Bandra Kurla Complex', { exact: false })).toBeVisible();

  // 5) Invoices tab → New invoice → the composer with the four new controls.
  await page.locator('.tab', { hasText: 'Invoices' }).click();
  await page.getByRole('button', { name: 'New invoice' }).click();
  await expect(page.getByText(/Enter line items and GST details/)).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Document type', { exact: true })).toBeVisible();
  await expect(page.getByText('Invoice number', { exact: true })).toBeVisible();
  await expect(page.getByText('Bill to', { exact: true })).toBeVisible();
  await expect(page.getByText('Project', { exact: true })).toBeVisible();

  // The number field is pre-filled with the next auto number (INV/<fy>/NNNN).
  const numberInput = page.getByLabel('Invoice number');
  await expect(numberInput).toHaveValue(/INV\/\d{4}-\d{2}\/\d+/, { timeout: 20_000 });

  // 6) Switch document type to Proforma.
  await page.locator('button[role="combobox"]').filter({ hasText: 'Invoice' }).first().click();
  await page.getByRole('option', { name: 'Proforma' }).click();
  await expect(
    page.locator('button[role="combobox"]').filter({ hasText: 'Proforma' }),
  ).toBeVisible();

  // 7) A manual, out-of-sequence number surfaces the non-blocking warning.
  await numberInput.fill('PRO/2026-27/0001');
  await expect(page.getByText(/out of sequence/i)).toBeVisible();

  // Close the composer without finalizing.
  await page.getByRole('button', { name: 'Cancel' }).click();
});
