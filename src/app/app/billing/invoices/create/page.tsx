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
          <h2 className="text-xl font-bold text-white">Generate Customer Invoice</h2>
          <p className="text-sm text-slate-400">
            Select unbilled rated shipment charges to group into a customer invoice.
          </p>
        </div>
        <Link
          href="/app/billing/invoices"
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          ← Back to Invoices
        </Link>
      </div>

      <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 space-y-6">
        <h3 className="text-base font-semibold text-white border-b border-slate-800 pb-3">
          Eligible Unbilled Charges ({unbilledCharges.length})
        </h3>

        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 w-10">Select</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Shipment #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 font-mono">Qty</th>
                <th className="px-4 py-3 font-mono">Net Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {unbilledCharges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No unbilled charges available for invoice generation.
                  </td>
                </tr>
              ) : (
                unbilledCharges.map((charge) => (
                  <tr key={charge.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" defaultChecked className="rounded border-slate-700 bg-slate-950 text-blue-500" />
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">{charge.description}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{charge.shipment.shipmentNumber}</td>
                    <td className="px-4 py-3 text-slate-400">{charge.shipment.client?.name ?? "Client Account"}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{Number(charge.quantity)}</td>
                    <td className="px-4 py-3 font-mono text-emerald-400 font-semibold">${Number(charge.netAmount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <div className="text-xs text-slate-400 font-mono">
            Selected Total: <span className="text-emerald-400 font-bold text-sm">${unbilledCharges.reduce((acc, c) => acc + Number(c.netAmount), 0).toFixed(2)}</span>
          </div>
          <Link
            href="/app/billing/invoices"
            className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm"
          >
            Generate Draft Invoice →
          </Link>
        </div>
      </div>
    </div>
  );
}
