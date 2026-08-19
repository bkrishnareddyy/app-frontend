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

  it("includes /app/clients, /app/importers-of-record, /app/bonds, and /app/poa in visible sidebar navigation", () => {
    const sections = visibleNavigation(access);
    const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));

    expect(allHrefs).toContain("/app/clients");
    expect(allHrefs).toContain("/app/importers-of-record");
    expect(allHrefs).toContain("/app/bonds");
    expect(allHrefs).toContain("/app/poa");
  });
});
