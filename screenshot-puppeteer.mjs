import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto('http://localhost:3004', { waitUntil: 'networkidle0' });
await page.screenshot({ path: '/tmp/layout-check.png' });
await browser.close();
console.log('Screenshot saved to /tmp/layout-check.png');
