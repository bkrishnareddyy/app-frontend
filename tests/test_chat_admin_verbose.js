const { chromium } = require("@playwright/test");

async function run() {
  console.log("Launching headed Chromium browser...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Register listeners for errors
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]:`, msg.text());
    }
  });

  page.on("pageerror", (exception) => {
    console.error("[BROWSER UNCAUGHT EXCEPTION]:", exception.stack || exception.toString());
  });

  page.on("requestfailed", (request) => {
    console.log("[REQUEST FAILED]:", request.url(), request.failure()?.errorText);
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      console.log(`[HTTP ERROR RESPONSE ${response.status()}]:`, response.url());
    }
  });

  console.log("Navigating to http://localhost:3000/chat...");
  await page.goto("http://localhost:3000/chat");

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
    await page.goto("http://localhost:3000/chat");
  }

  console.log("Waiting for /chat page to load and render...");
  try {
    await page.waitForURL("**/chat", { timeout: 15000 });
  } catch (e) {
    console.log("URL did not match **/chat, current URL is:", page.url());
  }

  console.log("Waiting for rendering components...");
  await page.waitForTimeout(10000);

  const screenshotPath = "/Users/rachitlohani/.gemini/antigravity-ide/brain/05ec099a-a361-4628-9185-d0f3bacf10cc/chat_page_local_admin.png";
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  console.log("Closing browser...");
  await browser.close();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
