import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createInvoiceAction } from "../../actions";

export const revalidate = 0;

export default async function CreateInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.invoice.manage"))) redirect("/app/billing/invoices");

  const params = await searchParams;
  const allEligibleCharges = await db.shipmentCharge.findMany({
    where: {
      accountId: ctx.accountId,
      status: "RATED",
      invoiceLineId: null,
      shipment: { accountId: ctx.accountId, clientId: { not: null } },
    },
    take: 500,
    include: {
      shipment: {
        select: {
          shipmentNumber: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const clients = Array.from(
    new Map(
      allEligibleCharges
        .filter((charge) => charge.shipment.client)
        .map((charge) => [charge.shipment.client!.id, charge.shipment.client!])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const selectedClientId = params.clientId && clients.some((c) => c.id === params.clientId)
    ? params.clientId
    : clients[0]?.id;

  const unbilledCharges = selectedClientId
    ? allEligibleCharges.filter((charge) => charge.shipment.clientId === selectedClientId).slice(0, 100)
    : [];

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Generate Customer Invoice</h2>
          <p className="text-sm text-ink-muted">
            Select one client and the eligible unbilled charges to include in a draft invoice.
          </p>
        </div>
        <Link
          href="/app/billing/invoices"
          className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
        >
          ← Back to Invoices
        </Link>
      </div>

      <form method="get" className="p-4 rounded-xl bg-white border border-[#E5E5EA] shadow-sm flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
            Client
          </label>
          <select
            name="clientId"
            defaultValue={selectedClientId}
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E5EA] text-sm text-ink"
          >
            {clients.length === 0 && <option value="">No clients with unbilled charges</option>}
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ink border border-slate-200">
          Load Charges
        </button>
      </form>

      <form action={createInvoiceAction} className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#E5E5EA] pb-4">
          <div>
            <h3 className="text-base font-bold text-ink">
              {selectedClient ? `${selectedClient.name} — Eligible Charges` : "Eligible Unbilled Charges"}
            </h3>
            <p className="text-xs text-ink-muted mt-1">{unbilledCharges.length} charges available</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Due Date</label>
            <input
              type="date"
              name="dueDate"
              required
              className="px-3 py-2 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink"
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E5EA] overflow-hidden">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-4 py-3 w-10">Select</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Shipment #</th>
                <th className="px-4 py-3 font-mono">Qty</th>
                <th className="px-4 py-3 font-mono">Net Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs">
              {unbilledCharges.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-muted font-sans">
                    No unbilled charges are available for this client.
                  </td>
                </tr>
              ) : (
                unbilledCharges.map((charge) => (
                  <tr key={charge.id} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        name="chargeIds"
                        value={charge.id}
                        defaultChecked
                        className="rounded border-slate-300 text-brand"
                      />
                    </td>
                    <td className="px-4 py-3 font-bold text-ink">{charge.description}</td>
                    <td className="px-4 py-3 font-mono text-ink">{charge.shipment.shipmentNumber}</td>
                    <td className="px-4 py-3 font-mono text-ink">{Number(charge.quantity)}</td>
                    <td className="px-4 py-3 font-mono text-emerald-600 font-semibold">${Number(charge.netAmount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Invoice Notes</label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Optional notes shown with this draft invoice"
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink"
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#E5E5EA]">
          <div className="text-xs text-ink-muted font-mono">
            Available Total: <span className="text-emerald-600 font-extrabold text-sm">${unbilledCharges.reduce((acc, c) => acc + Number(c.netAmount), 0).toFixed(2)}</span>
          </div>
          <button
            type="submit"
            disabled={unbilledCharges.length === 0}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm disabled:opacity-50"
          >
            Generate Draft Invoice →
          </button>
        </div>
      </form>
    </div>
  );
}
