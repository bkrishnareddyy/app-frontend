import React from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DollarSign } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { getAccountContext } from "@/lib/auth";

export default async function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");

  const has = (permission: string) =>
    ctx.isPlatformAdmin || ctx.roleNames.includes("OWNER") || ctx.permissions.includes(permission);

  if (!has("billing.view")) redirect("/app");

  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "/app/billing";

  const tabs = [
    { name: "Overview", href: "/app/billing", visible: true },
    { name: "Rate Cards", href: "/app/billing/rate-cards", visible: has("billing.ratecard.manage") },
    { name: "Usage Ledger", href: "/app/billing/usage", visible: true },
    { name: "Shipment Economics", href: "/app/billing/shipments", visible: true },
    { name: "Invoices & AR", href: "/app/billing/invoices", visible: true },
    { name: "Exceptions & Leakage", href: "/app/billing/exceptions", visible: has("billing.reports.view") },
    { name: "Profitability Reports", href: "/app/billing/reports", visible: has("billing.reports.view") },
    { name: "Settings & Costing", href: "/app/billing/settings", visible: has("billing.cost.view") },
  ].filter((tab) => tab.visible);

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-2 sm:p-4">
      <div className="border-b border-[#E5E5EA] pb-6">
        <PanelHeading
          icon={DollarSign}
          badge="Billing, Costing & Unit Economics"
          title="Billing Workspace"
          subtitle="Real-time usage metering, 3-layer shipment unit economics, rate cards, and automated revenue leakage detection."
        />
      </div>

      <div className="flex items-center gap-1.5 border-b border-[#E5E5EA] pb-3 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/app/billing"
              ? pathname === "/app/billing"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? "bg-white text-ink shadow-sm border border-[#E5E5EA]"
                  : "text-ink-muted hover:text-ink hover:bg-slate-100/60"
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>

      <main className="space-y-6">{children}</main>
    </div>
  );
}
