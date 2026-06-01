import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const events = [];
page.on('pageerror', (err) => events.push({ type: 'pageerror', text: err.message }));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') events.push({ type: `console.${msg.type()}`, text: msg.text().slice(0, 400) });
});
page.on('requestfailed', (req) => events.push({ type: 'requestfailed', url: req.url(), failure: req.failure()?.errorText }));
page.on('response', (res) => { if (res.status() >= 400) events.push({ type: 'http_error', status: res.status(), url: res.url() }); });

await page.goto('http://localhost:3000/os', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.lock-screen__field input').fill('apar2026');
await page.locator('.lock-screen__submit').click();
await page.waitForTimeout(1500);

await page.keyboard.press('Meta+k');
await page.waitForTimeout(300);
await page.locator('.cmdk-input input').fill('Open Clients');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 1500);
console.log(JSON.stringify({ bodyAfter: body, events }, null, 2));
await browser.close();
