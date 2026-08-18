import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function InvoicesPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const canManageInvoices = await hasPermission("billing.invoice.manage");

  const invoices = await db.invoice.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      lines: true,
      payments: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink">Invoices & Accounts Receivable</h2>
          <p className="text-sm text-ink-muted">Generate customer invoices and track incoming payments and balances.</p>
        </div>
        {canManageInvoices && (
          <Link href="/app/billing/invoices/create" className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm">+ Create New Invoice</Link>
        )}
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr><th className="px-5 py-3">Invoice #</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Issue Date</th><th className="px-5 py-3">Due Date</th><th className="px-5 py-3">Total Amount</th><th className="px-5 py-3">Paid Amount</th><th className="px-5 py-3">Balance Due</th><th className="px-5 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] font-mono text-xs">
              {invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-ink-muted text-sm font-sans">No invoices generated yet.</td></tr>
              ) : invoices.map((inv) => {
                const isOverdue = (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") && new Date(inv.dueDate) < new Date() && Number(inv.balanceDue) > 0;
                const displayStatus = isOverdue ? "OVERDUE" : inv.status;
                const statusBadge = displayStatus === "PAID" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : displayStatus === "OVERDUE" ? "bg-rose-50 text-rose-700 border border-rose-200"
                  : displayStatus === "DRAFT" ? "bg-slate-100 text-slate-500 border border-slate-200"
                  : displayStatus === "VOID" ? "bg-slate-100 text-slate-400 border border-slate-200"
                  : "bg-blue-50 text-brand border border-blue-200";
                return (
                  <tr key={inv.id} className="hover:bg-[#F9F9FB] transition-colors cursor-pointer">
                    <td className="px-5 py-4 font-bold text-ink font-sans"><Link href={`/app/billing/invoices/${inv.id}`} className="hover:text-brand">{inv.invoiceNumber}</Link></td>
                    <td className="px-5 py-4 font-sans text-ink">{inv.client?.name ?? "Client Account"}</td>
                    <td className="px-5 py-4 text-ink-muted">{new Date(inv.issueDate).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-ink-muted">{new Date(inv.dueDate).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-ink font-semibold">${Number(inv.totalAmount).toFixed(2)}</td>
                    <td className="px-5 py-4 text-emerald-600">${Number(inv.paidAmount).toFixed(2)}</td>
                    <td className="px-5 py-4 text-brand font-semibold">${Number(inv.balanceDue).toFixed(2)}</td>
                    <td className="px-5 py-4 font-sans"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge}`}>{displayStatus}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
