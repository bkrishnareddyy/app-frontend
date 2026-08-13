const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000/chat...");
  await page.goto("http://localhost:3000/chat");

  const isLoginPage = await page.locator('input[type="email"], input[name="identifier"]').isVisible().catch(() => false);
  if (isLoginPage) {
    console.log("Logging in as admin@qubere.ai...");
    await page.locator('input[type="email"], input[name="identifier"]').fill("admin@qubere.ai");
    await page.keyboard.press("Enter");
    await page.waitForSelector('input[type="password"], input[name="password"]');
    await page.locator('input[type="password"], input[name="password"]').fill("QuberePass2026!");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(6000);
  }

  // 1. Capture Chat UI
  if (page.url().includes("/app/dashboard")) {
    await page.goto("http://localhost:3000/chat");
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/chat_ux_landing.png" });
  console.log("Saved chat_ux_landing.png");

  // 2. Capture Line Item Advisory & Valuation Modal
  console.log("Navigating to shipment SHP-SARAH-01 detail page...");
  await page.goto("http://localhost:3000/app/shipments/cmsj8hbot000ofxk97x4c1vu4");
  await page.waitForTimeout(5000);

  // Click on the "Tabs" button in the Extracted Line Items table
  const tabsButton = page.locator('button:has-text("Tabs")').first();
  if (await tabsButton.isVisible().catch(() => false)) {
    console.log("Clicking Tabs button...");
    await tabsButton.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/line_item_tabs_modal.png" });
    console.log("Saved line_item_tabs_modal.png");
  } else {
    console.log("Tabs button not found, saving page screenshot...");
    await page.screenshot({ path: "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/shipment_detail_page.png" });
  }

  await browser.close();
}

run().catch(console.error);
