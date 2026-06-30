const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 收集控制台错误
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

  console.log('=== Step 1: 打开登录页 ===');
  await page.goto('http://localhost:5200/app', { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: '/tmp/s1-login.png' });

  console.log('=== Step 2: 点击邮箱登录 ===');
  await page.click('button:has-text("邮箱登录")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/s2-email-form.png' });

  // 找到输入框
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map(i => ({ type: i.type, placeholder: i.placeholder }))
  );
  console.log('inputs found:', JSON.stringify(inputs));

  console.log('=== Step 3: 填写登录表单 ===');
  // username 字段
  const usernameInput = page.locator('input[type="text"], input[placeholder*="用户名"], input[placeholder*="username"]').first();
  await usernameInput.fill('admin');
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill('TestAdmin2026');
  await page.screenshot({ path: '/tmp/s3-filled.png' });

  console.log('=== Step 4: 提交登录 ===');
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/s4-after-login.png' });
  console.log('URL after login:', page.url());

  console.log('=== Step 5: 检查是否进入主界面 ===');
  const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('page content snippet:', pageContent);

  if (consoleErrors.length > 0) {
    console.log('\n=== 控制台错误 ===');
    consoleErrors.forEach(e => console.log(' -', e));
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
