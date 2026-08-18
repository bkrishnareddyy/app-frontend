import React from "react";
import Link from "next/link";
import { headers } from "next/headers";

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
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Commercial Engine
            </span>
            <span className="text-xs text-slate-400">Qubere v2.4</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            Billing, Costing & Profitability Workspace
          </h1>
          <p className="text-sm text-slate-400">
            Real-time usage metering, 3-layer shipment economics, rate cards, and revenue leakage detection.
          </p>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 overflow-x-auto pb-2 scrollbar-none">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/app/billing"
              ? pathname === "/app/billing"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? "bg-slate-800 text-white border border-slate-700 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
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
