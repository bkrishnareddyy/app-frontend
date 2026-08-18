import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function BillingOverviewPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");

  const [canViewCost, canManageRateCards, canManageInvoices, canViewReports] = await Promise.all([
    hasPermission("billing.cost.view"),
    hasPermission("billing.ratecard.manage"),
    hasPermission("billing.invoice.manage"),
    hasPermission("billing.reports.view"),
  ]);

  const totalCharges = await db.shipmentCharge.aggregate({
    where: { accountId: ctx.accountId },
    _sum: { netAmount: true, grossAmount: true, discountAmount: true },
    _count: { id: true },
  });

  const unbilledCharges = await db.shipmentCharge.aggregate({
    where: { accountId: ctx.accountId, status: "RATED", invoiceLineId: null },
    _sum: { netAmount: true },
    _count: { id: true },
  });

  const invoicedCharges = await db.invoice.aggregate({
    where: { accountId: ctx.accountId, status: { in: ["SENT", "PARTIALLY_PAID", "APPROVED", "OVERDUE"] } },
    _sum: { totalAmount: true, balanceDue: true, paidAmount: true },
    _count: { id: true },
  });

  const costs = canViewCost
    ? await db.shipmentCost.aggregate({ where: { accountId: ctx.accountId }, _sum: { amount: true } })
    : null;

  const exceptionsCount = await db.billingException.count({
    where: { accountId: ctx.accountId, status: "OPEN" },
  });

  const totalRev = Number(totalCharges._sum.netAmount ?? 0);
  const totalCost = Number(costs?._sum.amount ?? 0);
  const grossProfit = totalRev - totalCost;
  const grossMargin = totalRev > 0 ? ((grossProfit / totalRev) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {exceptionsCount > 0 && canViewReports && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <div>
              <h4 className="text-xs font-semibold text-amber-900">
                {exceptionsCount} Actionable Billing Exceptions & Revenue Leakage Alerts Detected
              </h4>
              <p className="text-xs text-amber-700/80 mt-0.5">
                Unmapped, zero-rated, missing-rate, or other billing exceptions require review.
              </p>
            </div>
          </div>
          <Link href="/app/billing/exceptions" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300">
            Review Exceptions →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-2">
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Accrued Charges</span>
          <div className="text-2xl font-extrabold text-ink">${totalRev.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-xs text-ink-muted">{totalCharges._count.id} operational charges</div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-2">
          <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Unbilled Revenue</span>
          <div className="text-2xl font-extrabold text-emerald-600">
            ${Number(unbilledCharges._sum.netAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-ink-muted">{unbilledCharges._count.id} charges awaiting invoicing</div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-2">
          <span className="text-xs font-semibold text-brand uppercase tracking-wider">Outstanding AR</span>
          <div className="text-2xl font-extrabold text-brand">
            ${Number(invoicedCharges._sum.balanceDue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-ink-muted">{invoicedCharges._count.id} open customer invoices</div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-2">
          <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Gross Profit / Margin</span>
          {canViewCost ? (
            <>
              <div className="text-2xl font-extrabold text-purple-900">
                ${grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                <span className="text-sm font-semibold text-purple-600 ml-2">({grossMargin}%)</span>
              </div>
              <div className="text-xs text-ink-muted">Internal Cost: ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </>
          ) : (
            <div className="text-sm font-semibold text-ink-muted">Restricted by billing cost permissions</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <h3 className="text-base font-bold text-ink">Rate Card Management</h3>
          <p className="text-xs text-ink-muted">Manage brokerage, client, and importer rate-card versions and capability mappings.</p>
          {canManageRateCards ? (
            <div className="flex gap-2">
              <Link href="/app/billing/rate-cards" className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ink border border-slate-200">View Rate Cards</Link>
              <Link href="/app/billing/rate-cards/import" className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white">Import Rate Card</Link>
            </div>
          ) : <div className="text-xs text-ink-muted">Billing Admin permission required.</div>}
        </div>

        <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <h3 className="text-base font-bold text-ink">Invoicing & Collections</h3>
          <p className="text-xs text-ink-muted">Convert unbilled charges into customer invoices and track receivables.</p>
          <div className="flex gap-2">
            <Link href="/app/billing/invoices" className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ink border border-slate-200">View Invoices</Link>
            {canManageInvoices && <Link href="/app/billing/invoices/create" className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white">+ Create Invoice</Link>}
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <h3 className="text-base font-bold text-ink">Unit Economics & Analytics</h3>
          <p className="text-xs text-ink-muted">Analyze client profitability, AI-agent economics, and shipment margins.</p>
          {canViewReports ? <Link href="/app/billing/reports" className="inline-block px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ink border border-slate-200">View Profitability Reports</Link> : <div className="text-xs text-ink-muted">Reporting permission required.</div>}
        </div>
      </div>
    </div>
  );
}
