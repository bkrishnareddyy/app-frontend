const { chromium } = require("@playwright/test");

async function run() {
  console.log("Launching headed Chromium browser for admin@qubere.ai...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log("Navigating to https://demo-app.qubere.ai/chat...");
  await page.goto("https://demo-app.qubere.ai/chat");

  console.log("Checking if redirect to login occurs...");
  try {
    await Promise.race([
      page.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: 10000 }),
      page.waitForSelector('h1:has-text("Personal Workspace"), textarea', { timeout: 10000 }),
    ]);
  } catch (err) {
    console.log("Timeout waiting for initial selectors, continuing...");
  }

  const isLoginPage = await page.locator('input[type="email"], input[name="identifier"]').isVisible();
  if (isLoginPage) {
    console.log("Clerk login page detected. Attempting login as admin@qubere.ai...");
    const emailInput = page.locator('input[type="email"], input[name="identifier"]');
    await emailInput.fill("admin@qubere.ai");
    await page.keyboard.press("Enter");

    console.log("Waiting for password input...");
    await page.waitForSelector('input[type="password"], input[name="password"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    await passwordInput.fill("QuberePass2026!");
    await page.keyboard.press("Enter");
  } else {
    console.log("Already authenticated.");
  }

  console.log("Waiting for page load...");
  await page.waitForTimeout(5000);

  if (page.url().includes("/app/dashboard")) {
    console.log("Redirected to dashboard. Navigating back to /chat...");
    await page.goto("https://demo-app.qubere.ai/chat");
  }

  console.log("Waiting for /chat page to load and render...");
  try {
    await page.waitForURL("**/chat", { timeout: 15000 });
  } catch (e) {
    console.log("URL did not match **/chat, current URL is:", page.url());
  }

  console.log("Waiting for rendering components...");
  await page.waitForTimeout(10000);

  const screenshotPath = "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/chat_page_admin.png";
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  console.log("Browser will remain open for 45 seconds for observation...");
  await page.waitForTimeout(45000);

  await browser.close();
  console.log("Browser closed. Test finished.");
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
