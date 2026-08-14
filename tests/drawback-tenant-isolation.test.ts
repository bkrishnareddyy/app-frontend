import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

// DrawbackLot has no automatic tenant isolation backstop at the schema level beyond
// the Phase 0 DataMode fix (see datamode-middleware.test.ts), so every call site must
// filter by accountId explicitly. Two lookups previously matched on lineItemId alone;
// this locks in the fix so a future edit can't silently drop the accountId filter.
describe("DrawbackService: explicit accountId scoping on drawbackLot lookups", () => {
  it("scopes the existing-lot check in createDrawbackLotsFromFiling by accountId", async () => {
    const source = await readFile(
      new URL("../src/modules/drawback/drawback.service.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(
      /db\.drawbackLot\.findFirst\(\{\s*where: \{ accountId: filing\.accountId, lineItemId: item\.id \}/
    );
  });

  it("scopes the claim-confirmation lot lookup in createClaim by accountId", async () => {
    const source = await readFile(
      new URL("../src/modules/drawback/drawback.service.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(
      /tx\.drawbackLot\.findFirst\(\{\s*where: \{ accountId, lineItemId: m\.shipmentLineItemId \}/
    );
  });
});
