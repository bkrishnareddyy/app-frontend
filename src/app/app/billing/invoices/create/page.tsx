import React from "react";
import Link from "next/link";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function CreateInvoicePage() {
  const unbilledCharges = await db.shipmentCharge.findMany({
    where: { status: "RATED", invoiceLineId: null },
    take: 50,
    include: {
      shipment: { select: { shipmentNumber: true, client: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Generate Customer Invoice</h2>
          <p className="text-sm text-ink-muted">
            Select unbilled rated shipment charges to group into a customer invoice.
          </p>
        </div>
        <Link
          href="/app/billing/invoices"
          className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
        >
          ← Back to Invoices
        </Link>
      </div>

      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <h3 className="text-base font-bold text-ink border-b border-[#E5E5EA] pb-3">
          Eligible Unbilled Charges ({unbilledCharges.length})
        </h3>

        <div className="rounded-xl border border-[#E5E5EA] overflow-hidden">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-4 py-3 w-10">Select</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Shipment #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 font-mono">Qty</th>
                <th className="px-4 py-3 font-mono">Net Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs">
              {unbilledCharges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-muted font-sans">
                    No unbilled charges available for invoice generation.
                  </td>
                </tr>
              ) : (
                unbilledCharges.map((charge) => (
                  <tr key={charge.id} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" defaultChecked className="rounded border-slate-300 text-brand" />
                    </td>
                    <td className="px-4 py-3 font-bold text-ink">{charge.description}</td>
                    <td className="px-4 py-3 font-mono text-ink">{charge.shipment.shipmentNumber}</td>
                    <td className="px-4 py-3 text-ink-muted">{charge.shipment.client?.name ?? "Client Account"}</td>
                    <td className="px-4 py-3 font-mono text-ink">{Number(charge.quantity)}</td>
                    <td className="px-4 py-3 font-mono text-emerald-600 font-semibold">${Number(charge.netAmount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#E5E5EA]">
          <div className="text-xs text-ink-muted font-mono">
            Selected Total: <span className="text-emerald-600 font-extrabold text-sm">${unbilledCharges.reduce((acc, c) => acc + Number(c.netAmount), 0).toFixed(2)}</span>
          </div>
          <Link
            href="/app/billing/invoices"
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm"
          >
            Generate Draft Invoice →
          </Link>
        </div>
      </div>
    </div>
  );
}
