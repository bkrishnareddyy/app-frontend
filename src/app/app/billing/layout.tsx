import React from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { DollarSign } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";

export default async function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "/app/billing";

  const tabs = [
    { name: "Overview", href: "/app/billing" },
    { name: "Rate Cards", href: "/app/billing/rate-cards" },
    { name: "Usage Ledger", href: "/app/billing/usage" },
    { name: "Shipment Economics", href: "/app/billing/shipments" },
    { name: "Invoices & AR", href: "/app/billing/invoices" },
    { name: "Exceptions & Leakage", href: "/app/billing/exceptions" },
    { name: "Profitability Reports", href: "/app/billing/reports" },
    { name: "Settings & Costing", href: "/app/billing/settings" },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-2 sm:p-4">
      {/* Workspace Header */}
      <div className="border-b border-[#E5E5EA] pb-6">
        <PanelHeading
          icon={DollarSign}
          badge="Billing, Costing & Unit Economics"
          title="Billing Workspace"
          subtitle="Real-time usage metering, 3-layer shipment unit economics, rate cards, and automated revenue leakage detection."
        />
      </div>

      {/* Primary Navigation Tabs */}
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

      {/* Main Workspace Content */}
      <main className="space-y-6">{children}</main>
    </div>
  );
}
