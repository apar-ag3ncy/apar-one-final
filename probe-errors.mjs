import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:3000';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const events = [];
page.on('pageerror', (err) => events.push({ type: 'pageerror', text: err.message, stack: err.stack }));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    events.push({ type: `console.${msg.type()}`, text: msg.text() });
  }
});
page.on('requestfailed', (req) => events.push({ type: 'requestfailed', url: req.url(), failure: req.failure()?.errorText }));
page.on('response', (res) => {
  if (res.status() >= 400) events.push({ type: 'http_error', status: res.status(), url: res.url() });
});

let navError = null;
let bodyText = '';
try {
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  events.push({ type: 'nav', status: resp?.status(), url: resp?.url() });
  await page.waitForTimeout(1500);
  bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
} catch (e) {
  navError = e.message;
}

console.log(JSON.stringify({ url: URL, navError, bodyText, events }, null, 2));
await browser.close();
