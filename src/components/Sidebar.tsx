"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  LayoutDashboard,
  Inbox,
  Scale,
  FileCheck2,
  Globe,
  Building2,
  Users,
  Settings,
  Shield,
  FileText,
  Files,
  Contact2,
  Menu,
  TriangleAlert,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";
import { activeNavHref, visibleNavigation, type NavIcon } from "@/lib/navigation";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { dataModeFooterLabel, type DataMode } from "@/lib/dataMode";

const ICONS: Record<NavIcon, LucideIcon> = {
  inbox: Inbox,
  dashboard: LayoutDashboard,
  shipments: FileText,
  clients: Contact2,
  documents: Files,
  decisions: Scale,
  exceptions: TriangleAlert,
  filing: FileCheck2,
  regulatory: Globe,
  account: Building2,
  users: Users,
  roles: ShieldCheck,
  settings: Settings,
  platform: Shield,
};

interface SidebarProps {
  currentAccountId: string;
  accountName?: string;
  accountType?: string;
  roleNames?: string[];
  isPlatformAdmin?: boolean;
  permissions?: string[];
  dataMode?: DataMode;
  memberships?: Array<{
    accountId: string;
    accountName: string;
    accountType: string;
    roleNames: string[];
  }>;
}

export function Sidebar({
  currentAccountId,
  accountName = "Personal Workspace",
  accountType = "INDIVIDUAL",
  roleNames = ["OWNER"],
  isPlatformAdmin = false,
  permissions = [],
  dataMode = "PRODUCTION",
  memberships = [],
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sections = visibleNavigation({ roleNames, permissions, isPlatformAdmin });

  const activeHref = activeNavHref(
    pathname,
    sections.flatMap((section) => section.items.map((item) => item.href))
  );

  const labels = t.nav as Record<string, string>;

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
        className="lg:hidden fixed top-3 left-3 z-50 w-10 h-10 rounded-xl bg-white border border-border shadow-sm flex items-center justify-center text-ink"
      >
        <Menu className="w-5 h-5" />
      </button>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          aria-hidden="true"
        />
      )}

      <aside
        id="primary-navigation"
        aria-label="Primary"
        className={cn(
          "bg-surface-muted border-r border-border flex flex-col h-screen z-40 transition-transform duration-200",
          "fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-20" : "w-64"
        )}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-border">
          <Link
            href="/app/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center space-x-3 group min-w-0"
          >
            <div className="w-9 h-9 shrink-0 rounded-xl bg-brand flex items-center justify-center text-white shadow-md shadow-brand/20 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            {!collapsed && (
              <span className="block text-xl font-bold tracking-tight text-ink truncate min-w-0">
                Qubere
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:bg-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!collapsed && (
          <div className="px-3 my-4">
            <AccountSwitcher
              currentAccountId={currentAccountId}
              currentAccountName={accountName}
              currentAccountType={accountType}
              currentRoleNames={roleNames}
              memberships={
                memberships.length > 0
                  ? memberships
                  : [{ accountId: currentAccountId, accountName, accountType, roleNames }]
              }
            />
          </div>
        )}

        <div className="flex-1 px-3 space-y-6 overflow-y-auto py-2">
          {sections.map((section) => (
            <div key={section.id}>
              {!collapsed && (
                <p
                  className={cn(
                    "px-3 text-[11px] font-bold uppercase tracking-wider mb-2",
                    section.id === "platform" ? "text-amber-600" : "text-ink-muted"
                  )}
                >
                  {labels[section.labelKey] ?? section.labelKey}
                </p>
              )}
              <nav className="space-y-1">
                {section.items.map((item) => {
                  const isActive = activeHref === item.href;
                  const Icon = ICONS[item.icon];
                  const label = labels[item.labelKey] ?? item.labelKey;
                  const isPlatform = section.id === "platform";
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "flex items-center px-3 py-2 rounded-xl text-sm font-medium transition-all",
                        collapsed ? "justify-center" : "space-x-3",
                        isActive && isPlatform &&
                          "bg-amber-500/10 text-amber-700 shadow-sm border border-amber-500/20 font-semibold",
                        isActive && !isPlatform &&
                          "bg-white text-brand shadow-sm border border-border font-semibold",
                        !isActive && isPlatform && "text-amber-800 hover:text-amber-900 hover:bg-amber-50/50",
                        !isActive && !isPlatform && "text-ink hover:text-brand hover:bg-white/60"
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-4 h-4 shrink-0",
                          isPlatform ? "text-amber-600" : isActive ? "text-brand" : "text-ink-muted"
                        )}
                      />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-border bg-white/40">
          {!collapsed && (
            <div className="px-2 pb-2 text-xs text-ink-muted">
              <p className="font-semibold text-ink">Qubere AI Trade Platform</p>
              <p className="text-[11px] text-ink-muted">{dataModeFooterLabel(dataMode)}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="hidden lg:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-ink-muted hover:text-brand hover:bg-white transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
