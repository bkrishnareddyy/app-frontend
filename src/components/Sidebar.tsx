"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  LayoutDashboard,
  Package as ShipmentIcon,
  Scale,
  FileCheck2,
  Globe,
  FileText,
  Files,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface SidebarProps {
  currentAccountId: string;
  accountName?: string;
  accountType?: string;
  roleNames?: string[];
  isPlatformAdmin?: boolean;
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
  memberships = [],
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const mainNavigation = [
    { name: t.nav.commandCenter, href: "/app/dashboard", icon: LayoutDashboard },
    { name: t.nav.shipments, href: "/app/shipments", icon: FileText },
    { name: t.nav.tradeDocuments, href: "/app/documents", icon: Files },
    { name: t.nav.decisions, href: "/app/decisions", icon: Scale },
    { name: t.nav.customsFiling, href: "/app/filing", icon: FileCheck2 },
    { name: t.nav.regulatoryIntel, href: "/app/regulatory", icon: Globe },
  ];

  return (
    <aside className="w-64 bg-[#F5F5F7] border-r border-[#E5E5EA] flex flex-col h-screen sticky top-0 z-40">
      {/* Brand Header */}
      <div className="h-16 px-6 flex items-center justify-between border-b border-[#E5E5EA]">
        <Link href="/app/dashboard" className="flex items-center space-x-3 group">
          <div className="w-9 h-9 rounded-xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight text-[#1D1D1F]">Qubere</span>
        </Link>
      </div>

      {/* Account Switcher Widget */}
      <div className="px-3 my-4">
        <AccountSwitcher
          currentAccountId={currentAccountId}
          currentAccountName={accountName}
          currentAccountType={accountType}
          currentRoleNames={roleNames}
          memberships={
            memberships.length > 0
              ? memberships
              : [
                  {
                    accountId: currentAccountId,
                    accountName,
                    accountType,
                    roleNames,
                  },
                ]
          }
        />
      </div>

      {/* Main Navigation */}
      <div className="flex-1 px-3 space-y-6 overflow-y-auto py-2">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#86868B] mb-2">
            {t.nav.mainOperations}
          </p>
          <nav className="space-y-1">
            {mainNavigation.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/app/dashboard" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all",
                    isActive
                      ? "bg-white text-[#0071E3] shadow-sm border border-[#E5E5EA] font-semibold"
                      : "text-[#1D1D1F] hover:text-[#0071E3] hover:bg-white/60"
                  )}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className={cn("w-4 h-4", isActive ? "text-[#0071E3]" : "text-[#86868B]")} />
                    <span>{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#E5E5EA] bg-white/40 text-xs text-[#86868B]">
        <p className="font-semibold text-[#1D1D1F]">Qubere AI Trade Platform</p>
        <p className="text-[11px] text-[#86868B]">Production Enterprise Core</p>
      </div>
    </aside>
  );
}
