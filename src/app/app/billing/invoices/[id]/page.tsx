import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { InvoiceDetailClient } from "./InvoiceDetailClient";

export const revalidate = 0;

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-brand border-blue-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_PAID: "bg-teal-50 text-teal-700 border-teal-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OVERDUE: "bg-rose-50 text-rose-700 border-rose-200",
  VOID: "bg-slate-100 text-slate-400 border-slate-200",
  DISPUTED: "bg-orange-50 text-orange-700 border-orange-200",
  CREDITED: "bg-purple-50 text-purple-700 border-purple-200",
};

function deriveStatus(inv: { status: string; dueDate: Date | string; balanceDue: unknown }) {
  if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
    if (new Date(inv.dueDate) < new Date() && Number(inv.balanceDue) > 0) {
      return "OVERDUE";
    }
  }
  return inv.status;
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.invoice.manage"))) redirect("/app/billing");

  const { id } = await params;
  const canRecordPayment = await hasPermission("billing.payment.record");

  const invoice = await db.invoice.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      payments: { orderBy: { paymentDate: "desc" } },
      lines: {
        include: {
          shipment: { select: { id: true, shipmentNumber: true } },
          charges: {
            include: {
              usageEvent: { select: { id: true, eventCode: true, occurredAt: true, sourceAgent: true, sourceFunction: true } },
            },
          },
        },
      },
    },
  });

  if (!invoice) notFound();

  const derivedStatus = deriveStatus(invoice);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[derivedStatus] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
              {derivedStatus}
            </span>
            <span className="text-xs text-ink-muted font-mono">{invoice.invoiceNumber}</span>
          </div>
          <h2 className="text-xl font-bold text-ink">Invoice — {invoice.client?.name ?? invoice.importer?.name ?? "Customer"}</h2>
          <p className="text-sm text-ink-muted">
            Issued {new Date(invoice.issueDate).toLocaleDateString()} · Due {new Date(invoice.dueDate).toLocaleDateString()}
            {invoice.importer && ` · ${invoice.importer.name}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Export buttons */}
          <a href={`/api/billing/invoices/${id}/export?format=pdf`} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">PDF</a>
          <a href={`/api/billing/invoices/${id}/export?format=csv`}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">CSV</a>
          <a href={`/api/billing/invoices/${id}/export?format=xlsx`}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">XLSX</a>
          <Link href="/app/billing/invoices" className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors">← Back</Link>
        </div>
      </div>

      {/* Totals summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Subtotal", value: `$${Number(invoice.subtotal).toFixed(2)}`, muted: true },
          { label: "Total Amount", value: `$${Number(invoice.totalAmount).toFixed(2)}`, muted: false },
          { label: "Paid", value: `$${Number(invoice.paidAmount).toFixed(2)}`, emerald: true },
          { label: "Balance Due", value: `$${Number(invoice.balanceDue).toFixed(2)}`, brand: true },
        ].map(({ label, value, muted, emerald, brand }) => (
          <div key={label} className="p-4 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm">
            <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">{label}</div>
            <div className={`text-xl font-bold mt-1 ${emerald ? "text-emerald-600" : brand ? "text-brand" : muted ? "text-ink-muted" : "text-ink"}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Invoice lines with charge drill-down */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Invoice Lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E5E5EA]">
                <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Description</th>
                <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Shipment</th>
                <th className="text-right py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Qty</th>
                <th className="text-right py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Unit Price</th>
                <th className="text-right py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <React.Fragment key={line.id}>
                  <tr className="border-b border-[#F5F5F7]">
                    <td className="py-2 px-3 font-semibold text-ink">{line.description}</td>
                    <td className="py-2 px-3 text-xs text-ink-muted">
                      {line.shipment ? (
                        <Link href={`/app/shipments/${line.shipment.id}`} className="hover:text-brand">
                          {line.shipment.shipmentNumber}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right text-xs font-mono text-ink">{Number(line.quantity).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-xs font-mono text-ink">${Number(line.unitPrice).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-xs font-semibold font-mono text-ink">${Number(line.amount).toFixed(2)}</td>
                  </tr>
                  {/* Charge drill-down rows */}
                  {line.charges.map((charge) => (
                    <tr key={charge.id} className="bg-[#F9F9FB] text-[11px] border-b border-[#F5F5F7]">
                      <td className="py-1.5 px-6 text-ink-muted" colSpan={2}>
                        {charge.usageEvent ? (
                          <span>
                            Usage event:{" "}
                            <span className="font-mono text-ink">{charge.usageEvent.eventCode}</span>
                            {charge.usageEvent.sourceAgent && ` via ${charge.usageEvent.sourceAgent}`}
                            {" · "}{new Date(charge.usageEvent.occurredAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-ink-muted">No usage event trace</span>
                        )}
                      </td>
                      <td colSpan={3} className="py-1.5 px-3 text-right text-ink-muted font-mono">
                        Gross ${Number(charge.grossAmount).toFixed(2)} · Net ${Number(charge.netAmount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#E5E5EA]">
                <td colSpan={4} className="py-3 px-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide">Total</td>
                <td className="py-3 px-3 text-right text-sm font-bold text-ink">${Number(invoice.totalAmount).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Payment history + payment form */}
      <InvoiceDetailClient
        invoice={{
          id: invoice.id,
          status: invoice.status,
          derivedStatus,
          balanceDue: Number(invoice.balanceDue),
          invoiceNumber: invoice.invoiceNumber,
        }}
        payments={invoice.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentMethod: p.paymentMethod,
          referenceNo: p.referenceNo,
          notes: p.notes,
          paymentDate: new Date(p.paymentDate).toLocaleDateString(),
        }))}
        canRecordPayment={canRecordPayment}
      />
    </div>
  );
}
