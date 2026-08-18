import React from "react";
import Link from "next/link";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function BillingOverviewPage() {
  // Fetch high level metrics from DB or calculate defaults
  const totalCharges = await db.shipmentCharge.aggregate({
    _sum: { netAmount: true, grossAmount: true, discountAmount: true },
    _count: { id: true },
  });

  const unbilledCharges = await db.shipmentCharge.aggregate({
    where: { status: "RATED" },
    _sum: { netAmount: true },
    _count: { id: true },
  });

  const invoicedCharges = await db.invoice.aggregate({
    where: { status: { in: ["SENT", "PARTIALLY_PAID", "APPROVED"] } },
    _sum: { totalAmount: true, balanceDue: true, paidAmount: true },
    _count: { id: true },
  });

  const costs = await db.shipmentCost.aggregate({
    _sum: { amount: true },
  });

  const exceptionsCount = await db.billingException.count({
    where: { status: "OPEN" },
  });

  const totalRev = Number(totalCharges._sum.netAmount ?? 0);
  const totalCost = Number(costs._sum.amount ?? 0);
  const grossProfit = totalRev - totalCost;
  const grossMargin = totalRev > 0 ? ((grossProfit / totalRev) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* Top Alert Banner for Exceptions / Leakage */}
      {exceptionsCount > 0 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <div>
              <h4 className="text-sm font-semibold text-amber-300">
                {exceptionsCount} Actionable Billing Exceptions & Revenue Leakage Alerts Detected
              </h4>
              <p className="text-xs text-amber-400/80">
                Manual interventions without customer charges, zero-rated events, or expired rate cards require review.
              </p>
            </div>
          </div>
          <Link
            href="/app/billing/exceptions"
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            Review Exceptions →
          </Link>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Accrued Revenue */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Accrued Charges</span>
          <div className="text-2xl font-bold text-white">${totalRev.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-xs text-slate-500">{totalCharges._count.id} rated operational charges</div>
        </div>

        {/* Unbilled Amount */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Unbilled Revenue</span>
          <div className="text-2xl font-bold text-emerald-400">
            ${Number(unbilledCharges._sum.netAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500">{unbilledCharges._count.id} charges awaiting invoice generation</div>
        </div>

        {/* Outstanding AR */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">Outstanding AR</span>
          <div className="text-2xl font-bold text-blue-400">
            ${Number(invoicedCharges._sum.balanceDue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500">{invoicedCharges._count.id} open customer invoices</div>
        </div>

        {/* Gross Profit Margin */}
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <span className="text-xs font-medium text-purple-400 uppercase tracking-wider">Gross Profit / Margin</span>
          <div className="text-2xl font-bold text-purple-300">
            ${grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            <span className="text-sm font-normal text-purple-400 ml-2">({grossMargin}%)</span>
          </div>
          <div className="text-xs text-slate-500">Internal Cost: ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      {/* Quick Action Operations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Rate Cards Box */}
        <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
          <h3 className="text-base font-semibold text-white">Rate Card Management</h3>
          <p className="text-xs text-slate-400">
            Manage brokerage default, client-specific, and importer rate card versions.
          </p>
          <div className="flex gap-2">
            <Link
              href="/app/billing/rate-cards"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              View Rate Cards
            </Link>
            <Link
              href="/app/billing/rate-cards/import"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 transition-colors border border-emerald-500/30"
            >
              Upload XLSX Rate Card
            </Link>
          </div>
        </div>

        {/* Invoicing Box */}
        <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
          <h3 className="text-base font-semibold text-white">Invoicing & Collections</h3>
          <p className="text-xs text-slate-400">
            Group unbilled charges by client/importer, generate PDF invoices, and record payments.
          </p>
          <div className="flex gap-2">
            <Link
              href="/app/billing/invoices"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Manage Invoices
            </Link>
            <Link
              href="/app/billing/invoices/create"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 transition-colors border border-blue-500/30"
            >
              + Create Invoice
            </Link>
          </div>
        </div>

        {/* Intelligence Box */}
        <div className="p-5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
          <h3 className="text-base font-semibold text-white">Unit Economics & Analytics</h3>
          <p className="text-xs text-slate-400">
            Analyze client profitability, AI agent ROI, broker labor efficiency, and shipment margins.
          </p>
          <div className="flex gap-2">
            <Link
              href="/app/billing/reports"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              View Profitability Reports
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
