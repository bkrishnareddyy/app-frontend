const { chromium } = require("@playwright/test");

async function run() {
  console.log("Launching headed Chromium browser...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log("Navigating to https://demo-app.qubere.ai/chat...");
  await page.goto("https://demo-app.qubere.ai/chat");

  try {
    await Promise.race([
      page.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: 10000 }),
      page.waitForSelector('h1:has-text("Personal Workspace"), textarea', { timeout: 10000 }),
    ]);
  } catch (err) {}

  const isLoginPage = await page.locator('input[type="email"], input[name="identifier"]').isVisible();
  if (isLoginPage) {
    console.log("Logging in as admin@qubere.ai...");
    const emailInput = page.locator('input[type="email"], input[name="identifier"]');
    await emailInput.fill("admin@qubere.ai");
    await page.keyboard.press("Enter");

    await page.waitForSelector('input[type="password"], input[name="password"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    await passwordInput.fill("QuberePass2026!");
    await page.keyboard.press("Enter");
  }

  console.log("Waiting 8 seconds on dashboard...");
  await page.waitForTimeout(8000);

  const cookies = await context.cookies();
  console.log("COOKIES:", JSON.stringify(cookies, null, 2));

  console.log("Navigating to /chat...");
  await page.goto("https://demo-app.qubere.ai/chat");

  console.log("Waiting 10 seconds for rendering/crashes...");
  await page.waitForTimeout(10000);

  console.log("Current URL:", page.url());
  await browser.close();
}

run().catch(console.error);
