const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000/chat...");
  await page.goto("http://localhost:3000/chat");

  await page.waitForSelector('input[type="email"], input[name="identifier"]');
  console.log("Logging in as admin@qubere.ai...");
  await page.locator('input[type="email"], input[name="identifier"]').fill("admin@qubere.ai");
  await page.keyboard.press("Enter");

  await page.waitForSelector('input[type="password"], input[name="password"]');
  await page.locator('input[type="password"], input[name="password"]').fill("QuberePass2026!");
  await page.keyboard.press("Enter");

  console.log("Waiting 6s after login...");
  await page.waitForTimeout(6000);

  console.log("Current URL after login:", page.url());
  if (page.url().includes("/app/dashboard")) {
    console.log("Navigating to /chat...");
    await page.goto("http://localhost:3000/chat");
    await page.waitForTimeout(6000);
  }

  const screenshotPath = "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/fresh_chat_landing.png";
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);
  await browser.close();
}

run().catch(console.error);
