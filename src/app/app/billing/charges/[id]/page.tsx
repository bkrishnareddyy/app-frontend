import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { adjustShipmentChargeAction } from "./actions";

export const revalidate = 0;

export default async function BillingChargePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const canAdjust = await hasPermission("billing.charge.adjust");
  const { id } = await params;

  const charge = await db.shipmentCharge.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      shipment: { select: { shipmentNumber: true, client: { select: { name: true } } } },
      usageEvent: { select: { eventCode: true, occurredAt: true, sourceFunction: true, sourceAgent: true, metadata: true } },
      rateRule: { select: { lineItemName: true, pricingModel: true, serviceCode: true } },
      rateCardVersion: { include: { rateCard: { select: { name: true } } } },
      adjustments: { orderBy: { createdAt: "desc" } },
      invoiceLine: { include: { invoice: { select: { invoiceNumber: true, status: true } } } },
    },
  });
  if (!charge) notFound();

  const isLocked = Boolean(charge.invoiceLineId) || charge.status === "INVOICED";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Charge Detail & Audit Trail</h2>
          <p className="text-sm text-ink-muted">{charge.shipment.shipmentNumber} • {charge.shipment.client?.name ?? "Client"}</p>
        </div>
        <Link href="/app/billing/usage" className="text-xs font-semibold text-ink-muted hover:text-ink">← Back to Usage Ledger</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Metric label="Gross" value={`$${Number(charge.grossAmount).toFixed(2)}`} />
        <Metric label="Discounts / Credits" value={`$${Number(charge.discountAmount).toFixed(2)}`} />
        <Metric label="Current Billable" value={`$${Number(charge.netAmount).toFixed(2)}`} />
        <Metric label="Status" value={charge.status} />
      </div>

      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Why this charge exists</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <Field label="Description" value={charge.description} />
          <Field label="Service Code" value={charge.rateRule?.serviceCode ?? "N/A"} />
          <Field label="Pricing Model" value={charge.rateRule?.pricingModel ?? "N/A"} />
          <Field label="Quantity × Unit Price" value={`${Number(charge.quantity)} × $${Number(charge.unitPrice).toFixed(2)}`} />
          <Field label="Rate Card" value={charge.rateCardVersion ? `${charge.rateCardVersion.rateCard.name} v${charge.rateCardVersion.version}` : "Manual / no rate card"} />
          <Field label="Usage Event" value={charge.usageEvent?.eventCode ?? "Manual charge"} />
          <Field label="Source Function" value={charge.usageEvent?.sourceFunction ?? "N/A"} />
          <Field label="Occurred" value={charge.usageEvent ? new Date(charge.usageEvent.occurredAt).toLocaleString() : "N/A"} />
        </dl>
        {charge.calculationTrace && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-brand">Calculation trace</summary>
            <pre className="mt-2 p-3 rounded-lg bg-[#F5F5F7] overflow-x-auto text-[11px]">{JSON.stringify(charge.calculationTrace, null, 2)}</pre>
          </details>
        )}
      </div>

      {canAdjust && (
        <form action={adjustShipmentChargeAction.bind(null, charge.id)} className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-ink">Add Discount / Credit / Waiver</h3>
            <p className="text-xs text-ink-muted mt-1">Adjustments are append-only and audited. Invoiced charges are locked.</p>
          </div>
          {isLocked ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">This charge is already invoiced and cannot be edited. Use an invoice credit/reversal workflow instead.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[.8fr_.8fr_2fr_auto] gap-3 items-end">
              <div><label className="text-[11px] font-semibold text-ink-muted">Type</label><select name="adjustmentType" className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-xs bg-white"><option value="DISCOUNT">Discount</option><option value="CREDIT">Credit</option><option value="WAIVER">Waiver</option></select></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Amount</label><input name="amount" type="number" min="0" step="0.01" defaultValue="0" className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-xs" /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Reason *</label><input name="reason" required placeholder="Contract concession, service recovery, etc." className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-xs" /></div>
              <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white">Apply</button>
            </div>
          )}
          <p className="text-[11px] text-ink-muted">Waivers and discounts above 10% require Billing Admin authority.</p>
        </form>
      )}

      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Adjustment History</h3>
        {charge.adjustments.length === 0 ? <div className="text-xs text-ink-muted">No adjustments recorded.</div> : (
          <div className="divide-y divide-[#E5E5EA]">
            {charge.adjustments.map((adjustment) => (
              <div key={adjustment.id} className="py-3 grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
                <div className="font-semibold">{adjustment.adjustmentType}</div>
                <div className="font-mono">${Number(adjustment.originalAmount).toFixed(2)} → ${Number(adjustment.newAmount).toFixed(2)}</div>
                <div className="sm:col-span-2 text-ink-muted">{adjustment.reason}</div>
                <div className="text-right text-ink-muted">{new Date(adjustment.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {charge.invoiceLine?.invoice && <div className="text-xs text-ink-muted">Invoice: {charge.invoiceLine.invoice.invoiceNumber} ({charge.invoiceLine.invoice.status})</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="p-4 rounded-xl bg-white border border-[#E5E5EA] shadow-sm"><div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">{label}</div><div className="text-lg font-bold text-ink mt-1">{value}</div></div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">{label}</dt><dd className="mt-1 text-ink font-mono">{value}</dd></div>;
}
