import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3004');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/layout-check.png', fullPage: false });
await browser.close();
console.log('Screenshot saved to /tmp/layout-check.png');
