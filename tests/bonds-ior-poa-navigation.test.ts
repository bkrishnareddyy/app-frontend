import { describe, it, expect } from "vitest";
import { visibleNavigation, navItemByHref } from "@/lib/navigation";

describe("Bonds, Importers of Record, and POA Navigation Surface", () => {
  const access = {
    roleNames: ["OWNER"],
    permissions: [],
    isPlatformAdmin: false,
  };

  it("exposes /app/clients, /app/importers-of-record, /app/bonds, and /app/poa in navigation lookup", () => {
    expect(navItemByHref("/app/clients")).toBeDefined();
    expect(navItemByHref("/app/importers-of-record")).toBeDefined();
    expect(navItemByHref("/app/bonds")).toBeDefined();
    expect(navItemByHref("/app/poa")).toBeDefined();
  });

  it("includes /app/clients in visible sidebar navigation", () => {
    // importers-of-record, bonds, and poa were intentionally moved to
    // UNLISTED_NAV_ITEMS (reachable by direct link/lookup, not shown in the
    // sidebar) -- see 0efcb56 "updaed navigation - cleaned it up."
    const sections = visibleNavigation(access);
    const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));

    expect(allHrefs).toContain("/app/clients");
  });
});
