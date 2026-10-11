// usage: node login.mjs <user> <outprefix> <path>...
import { chromium } from 'playwright';
const [, , user, prefix, ...paths] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
await p.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
console.log('landing:', p.url());
if (p.url().includes('8081') || await p.locator('#username').count()) {
  await p.fill('#username', user); await p.fill('#password', user === 'demo' ? 'demo' : 'pw');
  await p.click('#kc-login'); await p.waitForLoadState('networkidle');
} else {
  const btn = p.getByRole('button', { name: /log ?in|sign ?in/i }).or(p.getByRole('link', { name: /log ?in|sign ?in/i }));
  if (await btn.count()) { await btn.first().click(); await p.waitForLoadState('networkidle');
    await p.fill('#username', user); await p.fill('#password', 'pw'); await p.click('#kc-login'); await p.waitForLoadState('networkidle'); }
}
console.log('after login:', p.url());
let i = 0;
for (const path of paths) {
  await p.goto('http://localhost:3001' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
  const f = `${prefix}-${i++}.png`; await p.screenshot({ path: f, fullPage: true });
  console.log(f, path, '|', (await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 350));
}
console.log('errors:', errs.slice(0, 12));
await b.close();
