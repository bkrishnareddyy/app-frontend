export interface NavAccess {
  roleNames: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
}

export type NavIcon =
  | "inbox"
  | "dashboard"
  | "shipments"
  | "clients"
  | "documents"
  | "decisions"
  | "exceptions"
  | "filing"
  | "regulatory"
  | "account"
  | "users"
  | "roles"
  | "settings"
  | "platform";

export interface NavItem {
  id: string;
  labelKey: string;
  href: string;
  icon: NavIcon;
  /** Roles that may see the item, in addition to OWNER and platform admins. */
  roles?: string[];
  /** Permission that also grants visibility when the caller's role is not listed. */
  permission?: string;
  platformAdminOnly?: boolean;
}

export interface NavSection {
  id: string;
  labelKey: string;
  items: NavItem[];
}

export const ACCOUNT_ADMIN_ROLES = ["OWNER", "ADMIN"];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "operations",
    labelKey: "mainOperations",
    items: [
      { id: "work", labelKey: "myWork", href: "/app/work", icon: "inbox" },
      { id: "dashboard", labelKey: "commandCenter", href: "/app/dashboard", icon: "dashboard" },
      { id: "shipments", labelKey: "shipments", href: "/app/shipments", icon: "shipments" },
      { id: "clients", labelKey: "clients", href: "/app/clients", icon: "clients" },
      { id: "documents", labelKey: "tradeDocuments", href: "/app/documents", icon: "documents" },
      { id: "decisions", labelKey: "decisions", href: "/app/decisions", icon: "decisions" },
      { id: "exceptions", labelKey: "exceptions", href: "/app/exceptions", icon: "exceptions" },
      { id: "filing", labelKey: "customsFiling", href: "/app/filing", icon: "filing" },
      { id: "regulatory", labelKey: "regulatoryIntel", href: "/app/regulatory", icon: "regulatory" },
    ],
  },
  {
    id: "administration",
    labelKey: "accountAdmin",
    items: [
      {
        id: "account",
        labelKey: "accountProfile",
        href: "/app/admin",
        icon: "account",
        roles: ACCOUNT_ADMIN_ROLES,
        permission: "account.manage",
      },
      {
        id: "users",
        labelKey: "userManagement",
        href: "/app/admin/users",
        icon: "users",
        roles: ACCOUNT_ADMIN_ROLES,
        permission: "users.manage",
      },
      {
        id: "roles",
        labelKey: "rolesPermissions",
        href: "/app/admin/roles",
        icon: "roles",
        roles: ACCOUNT_ADMIN_ROLES,
        permission: "users.manage",
      },
      {
        id: "settings",
        labelKey: "settingsAudit",
        href: "/app/admin/settings",
        icon: "settings",
        roles: ACCOUNT_ADMIN_ROLES,
        permission: "settings.manage",
      },
    ],
  },
  {
    id: "platform",
    labelKey: "platformAdmin",
    items: [
      {
        id: "console",
        labelKey: "qubereConsole",
        href: "/platform-admin",
        icon: "platform",
        platformAdminOnly: true,
      },
    ],
  },
];

/** Mirrors hasPermission() in src/lib/auth.ts: platform admins and OWNER bypass checks. */
export function canAccessNavItem(access: NavAccess, item: NavItem): boolean {
  if (item.platformAdminOnly) {
    return access.isPlatformAdmin;
  }
  if (access.isPlatformAdmin || access.roleNames.includes("OWNER")) {
    return true;
  }
  if (item.roles?.some((role) => access.roleNames.includes(role))) {
    return true;
  }
  if (item.permission) {
    return access.permissions.includes(item.permission);
  }
  return !item.roles;
}

export function visibleNavigation(access: NavAccess, sections: NavSection[] = NAV_SECTIONS): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => canAccessNavItem(access, item)) }))
    .filter((section) => section.items.length > 0);
}

export function navItemByHref(href: string, sections: NavSection[] = NAV_SECTIONS): NavItem | undefined {
  return sections.flatMap((section) => section.items).find((item) => item.href === href);
}

/** Server-side guard for a routed page. Unknown hrefs fail closed. */
export function canAccessHref(access: NavAccess, href: string, sections: NavSection[] = NAV_SECTIONS): boolean {
  const item = navItemByHref(href, sections);
  return item ? canAccessNavItem(access, item) : false;
}

/** True when href is pathname or one of its ancestors, matched on segment boundaries. */
export function isPathWithin(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}

/**
 * Longest match wins, so /app/admin/users highlights itself rather than /app/admin,
 * and /app/shipments does not highlight for /app/shipments-archive.
 */
export function activeNavHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (isPathWithin(pathname, href) && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
