// usage: node shot.mjs <outprefix> <url> [<url>...]
import { chromium } from 'playwright';
const [, , prefix, ...urls] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
let i = 0;
for (const u of urls) {
  await p.goto(u, { waitUntil: 'networkidle' }).catch(e => errs.push('NAV ' + e.message));
  await p.waitForTimeout(800);
  const f = `${prefix}-${i++}.png`;
  await p.screenshot({ path: f, fullPage: true });
  console.log(f, u, '\n  text:', (await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 400));
}
console.log('console errors:', errs.slice(0, 10));
await b.close();
