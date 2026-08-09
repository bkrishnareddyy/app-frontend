import { describe, it, expect } from "vitest";
import {
  NAV_SECTIONS,
  activeNavHref,
  canAccessHref,
  canAccessNavItem,
  isPathWithin,
  visibleNavigation,
  type NavAccess,
} from "@/lib/navigation";

const viewer: NavAccess = { roleNames: ["VIEWER"], permissions: [], isPlatformAdmin: false };
const member: NavAccess = { roleNames: ["MEMBER"], permissions: [], isPlatformAdmin: false };
const admin: NavAccess = { roleNames: ["ADMIN"], permissions: [], isPlatformAdmin: false };
const owner: NavAccess = { roleNames: ["OWNER"], permissions: [], isPlatformAdmin: false };
const platform: NavAccess = { roleNames: ["VIEWER"], permissions: [], isPlatformAdmin: true };

function hrefsFor(access: NavAccess): string[] {
  return visibleNavigation(access).flatMap((s) => s.items.map((i) => i.href));
}

describe("navigation visibility", () => {
  it("hides account administration from viewers and members", () => {
    for (const access of [viewer, member]) {
      const hrefs = hrefsFor(access);
      expect(hrefs).not.toContain("/app/admin");
      expect(hrefs).not.toContain("/app/admin/users");
      expect(hrefs).not.toContain("/app/admin/settings");
    }
  });

  it("shows account administration to ADMIN and OWNER", () => {
    for (const access of [admin, owner]) {
      expect(hrefsFor(access)).toContain("/app/admin/users");
    }
  });

  it("grants admin items by explicit permission when the role is not an admin role", () => {
    const scoped: NavAccess = { roleNames: ["MEMBER"], permissions: ["users.manage"], isPlatformAdmin: false };
    const hrefs = hrefsFor(scoped);
    expect(hrefs).toContain("/app/admin/users");
    expect(hrefs).not.toContain("/app/admin/settings");
  });

  it("shows the platform console only to platform admins", () => {
    expect(hrefsFor(platform)).toContain("/platform-admin");
    for (const access of [viewer, member, admin, owner]) {
      expect(hrefsFor(access)).not.toContain("/platform-admin");
    }
  });

  it("gives every member the operational pages", () => {
    const hrefs = hrefsFor(viewer);
    expect(hrefs).toContain("/app/work");
    expect(hrefs).toContain("/app/shipments");
    expect(hrefs).toContain("/app/filing");
  });

  it("drops sections that end up empty", () => {
    expect(visibleNavigation(viewer).map((s) => s.id)).toEqual(["operations"]);
  });

  it("owner bypass does not extend to platform-admin-only items", () => {
    const console = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === "/platform-admin")!;
    expect(canAccessNavItem(owner, console)).toBe(false);
    expect(canAccessNavItem(platform, console)).toBe(true);
  });
});

describe("canAccessHref server guard", () => {
  it("mirrors sidebar visibility", () => {
    expect(canAccessHref(viewer, "/app/admin/users")).toBe(false);
    expect(canAccessHref(admin, "/app/admin/users")).toBe(true);
  });

  it("fails closed for hrefs that are not in the navigation model", () => {
    expect(canAccessHref(owner, "/app/unknown")).toBe(false);
  });
});

describe("active route matching", () => {
  it("does not match a sibling route that merely shares a prefix", () => {
    expect(isPathWithin("/app/shipments-archive", "/app/shipments")).toBe(false);
    expect(activeNavHref("/app/shipments-archive", ["/app/shipments"])).toBeNull();
  });

  it("matches nested routes on segment boundaries", () => {
    expect(isPathWithin("/app/shipments/abc123", "/app/shipments")).toBe(true);
  });

  it("prefers the longest match so a nested item wins over its parent", () => {
    const hrefs = ["/app/admin", "/app/admin/users"];
    expect(activeNavHref("/app/admin/users", hrefs)).toBe("/app/admin/users");
    expect(activeNavHref("/app/admin", hrefs)).toBe("/app/admin");
  });

  it("keeps the parent highlighted for a nested admin page with no own entry", () => {
    expect(activeNavHref("/app/admin/settings/keys", ["/app/admin", "/app/admin/settings"])).toBe(
      "/app/admin/settings"
    );
  });

  it("returns null when nothing matches", () => {
    expect(activeNavHref("/app/regulatory", ["/app/shipments"])).toBeNull();
  });
});
