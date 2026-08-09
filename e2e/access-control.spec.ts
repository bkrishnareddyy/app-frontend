import { test, expect } from "@playwright/test";

/**
 * Every guard here is enforced in a different place -- src/proxy.ts for the
 * matched paths, each route's own getAccountContext check for the rest -- and
 * none of that seam is exercised by the unit suites, which mock both.
 *
 * Runs signed out, so it needs a server but no database and no Clerk user.
 */

const PROTECTED_PAGES = [
  "/app/dashboard",
  "/app/shipments",
  "/app/documents",
  "/app/decisions",
  "/app/filing",
  "/app/work",
  "/app/admin",
  "/app/admin/users",
];

// Covered by the proxy matcher.
const PROXY_MATCHED_APIS = ["/api/documents", "/api/agents/orchestrate", "/api/intake/agent"];

// Not matched by the proxy, so the route's own 401 is the only thing standing here.
const SELF_GUARDED_GET_APIS = [
  "/api/decisions",
  "/api/shipments",
  "/api/filing",
  "/api/findings",
];

// POST-only, so a GET would answer 405 and prove nothing about the guard.
const SELF_GUARDED_POST_APIS = ["/api/reconcile", "/api/admin/users"];

test.describe("signed out", () => {
  for (const path of PROTECTED_PAGES) {
    test(`${path} does not render to an anonymous visitor`, async ({ page }) => {
      await page.goto(path);

      expect(page.url()).not.toContain(path);
      await expect(page.locator("body")).not.toContainText("Command Center");
    });
  }

  for (const path of PROXY_MATCHED_APIS) {
    test(`GET ${path} is refused`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).not.toBe(200);
    });
  }

  for (const path of SELF_GUARDED_GET_APIS) {
    test(`GET ${path} answers 401`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(401);
    });
  }

  for (const path of SELF_GUARDED_POST_APIS) {
    test(`POST ${path} answers 401`, async ({ request }) => {
      const res = await request.post(path, { data: {}, maxRedirects: 0 });
      expect(res.status()).toBe(401);
    });
  }

  test("a mutating route is refused before it can write", async ({ request }) => {
    const res = await request.post("/api/shipments", {
      data: { shipmentNumber: "E2E-SHOULD-NOT-EXIST" },
      maxRedirects: 0,
    });

    expect(res.status()).not.toBe(201);
    expect(res.status()).not.toBe(200);
  });

  test("the document proxy rejects a host that merely contains the storage domain", async ({
    request,
  }) => {
    // The original check was `url.includes("vercel-storage.com")`, which this
    // passes -- and the route then forwards the storage token as a Bearer header.
    const res = await request.get(
      "/api/documents/proxy?url=https://attacker.example.com/vercel-storage.com/x.pdf",
      { maxRedirects: 0 }
    );

    expect(res.status()).not.toBe(200);
  });
});
