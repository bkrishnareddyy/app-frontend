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
  Building2,
  Users,
  Settings,
  Shield,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";

interface SidebarProps {
  currentAccountId: string;
  accountName?: string;
  accountType?: string;
  roleName?: string;
  isPlatformAdmin?: boolean;
  memberships?: Array<{
    accountId: string;
    accountName: string;
    accountType: string;
    roleName: string;
  }>;
}

export function Sidebar({
  currentAccountId,
  accountName = "Personal Workspace",
  accountType = "INDIVIDUAL",
  roleName = "OWNER",
  isPlatformAdmin = false,
  memberships = [],
}: SidebarProps) {
  const pathname = usePathname();

  const mainNavigation = [
    { name: "Command Center", href: "/app/dashboard", icon: LayoutDashboard },
    { name: "Shipments", href: "/app/shipments/SHP-2026-004872", icon: FileText },
    { name: "Decisions", href: "/app/decisions", icon: Scale },
    { name: "Customs Filing", href: "/app/filing", icon: FileCheck2 },
    { name: "Regulatory Intel", href: "/app/regulatory", icon: Globe },
  ];

  const adminNavigation = [
    { name: "Account Profile", href: "/app/admin", icon: Building2 },
    { name: "User Management", href: "/app/admin/users", icon: Users },
    { name: "Settings & Audit", href: "/app/admin/settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[#F5F5F7] border-r border-[#E5E5EA] flex flex-col h-screen sticky top-0 z-40">
      {/* Brand Header */}
      <div className="h-16 px-6 flex items-center border-b border-[#E5E5EA]">
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
          currentRoleName={roleName}
          memberships={
            memberships.length > 0
              ? memberships
              : [
                  {
                    accountId: currentAccountId,
                    accountName,
                    accountType,
                    roleName,
                  },
                ]
          }
        />
      </div>

      {/* Main Navigation */}
      <div className="flex-1 px-3 space-y-6 overflow-y-auto py-2">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#86868B] mb-2">
            Main Operations
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

        {/* Administration Section */}
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#86868B] mb-2">
            Account Admin
          </p>
          <nav className="space-y-1">
            {adminNavigation.map((item) => {
              const isActive = pathname === item.href;
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

        {/* Platform Admin Link */}
        {isPlatformAdmin && (
          <div>
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-2">
              Platform Admin
            </p>
            <nav className="space-y-1">
              <Link
                href="/platform-admin"
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all",
                  pathname === "/platform-admin"
                    ? "bg-amber-500/10 text-amber-700 shadow-sm border border-amber-500/20 font-semibold"
                    : "text-amber-800 hover:text-amber-900 hover:bg-amber-50/50"
                )}
              >
                <div className="flex items-center space-x-3">
                  <Shield className="w-4 h-4 text-amber-600" />
                  <span>Qubere Console</span>
                </div>
              </Link>
            </nav>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#E5E5EA] bg-white/40 text-xs text-[#86868B]">
        <p className="font-semibold text-[#1D1D1F]">Qubere AI Trade Platform</p>
        <p className="text-[11px] text-[#86868B]">Production Enterprise Core</p>
      </div>
    </aside>
  );
}
