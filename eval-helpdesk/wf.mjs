import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
const btn = p.getByRole('button', { name: /log ?in|sign ?in/i }).or(p.getByRole('link', { name: /log ?in|sign ?in/i }));
if (await btn.count()) { await btn.first().click(); await p.waitForLoadState('networkidle'); }
if (await p.locator('#username').count()) { await p.fill('#username', 'ada'); await p.fill('#password', 'pw'); await p.click('#kc-login'); await p.waitForLoadState('networkidle'); }
await p.goto('http://localhost:3001/workflows/open_ticket', { waitUntil: 'networkidle' });
await p.screenshot({ path: 'eval-helpdesk/evidence/v2-ada-wf-form.png', fullPage: true });
console.log((await p.innerText('main')).replace(/\s+/g,' '));
const inputs = p.locator('main input, main textarea');
console.log('inputs', await inputs.count());
await inputs.nth(0).fill('Laptop broken'); await inputs.nth(1).fill('Screen flickers');
await p.getByRole('button', { name: /submit|run|open|start/i }).last().click();
await p.waitForTimeout(1500);
console.log('after submit url', p.url(), (await p.innerText('main')).replace(/\s+/g,' ').slice(0,300));
await p.screenshot({ path: 'eval-helpdesk/evidence/v2-ada-wf-after.png', fullPage: true });
await b.close();
