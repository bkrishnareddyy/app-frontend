import React from "react";
import Link from "next/link";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function InvoicesPage() {
  const invoices = await db.invoice.findMany({
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
          <h2 className="text-xl font-bold text-white">Invoices & Accounts Receivable</h2>
          <p className="text-sm text-slate-400">
            Generate, approve, send customer invoices, and record incoming payments.
          </p>
        </div>
        <Link
          href="/app/billing/invoices/create"
          className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm"
        >
          + Create New Invoice
        </Link>
      </div>

      <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Invoice #</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Issue Date</th>
                <th className="px-5 py-3">Due Date</th>
                <th className="px-5 py-3">Total Amount</th>
                <th className="px-5 py-3">Paid Amount</th>
                <th className="px-5 py-3">Balance Due</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500 text-sm font-sans">
                    No invoices generated yet. Click "+ Create New Invoice" to convert unbilled charges.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4 font-semibold text-white font-sans">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-5 py-4 font-sans text-slate-300">
                      {inv.client?.name ?? "Client Account"}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {new Date(inv.issueDate).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-slate-200 font-semibold">
                      ${Number(inv.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-5 py-4 text-emerald-400">
                      ${Number(inv.paidAmount).toFixed(2)}
                    </td>
                    <td className="px-5 py-4 text-blue-400 font-semibold">
                      ${Number(inv.balanceDue).toFixed(2)}
                    </td>
                    <td className="px-5 py-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          inv.status === "PAID"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : inv.status === "DRAFT"
                            ? "bg-slate-800 text-slate-400 border border-slate-700"
                            : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
