const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage();

  // 先直接打 login 页
  await page.goto('http://localhost:5200/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());
  await page.screenshot({ path: '/tmp/login-page.png' });

  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent?.trim())
  );
  console.log('buttons:', btns);

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
