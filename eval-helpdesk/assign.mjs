import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto('http://localhost:3001/tickets/01a107a3-ae88-7b6f-ad77-c3373d409d17', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Assign' }).click();
await p.waitForTimeout(1000);
await p.screenshot({ path: '/home/user/Loc/eval-helpdesk/evidence/v1-assign.png' });
console.log(p.url(), (await p.innerText('body')).replace(/\s+/g,' ').slice(0,400));
await b.close();
