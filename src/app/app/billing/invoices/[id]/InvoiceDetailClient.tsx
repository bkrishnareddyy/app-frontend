"use client";

import React, { useState, useTransition } from "react";
import {
  recordPaymentAction,
  submitInvoiceForApprovalAction,
  approveInvoiceAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from "./actions";

interface Props {
  invoice: {
    id: string;
    status: string;
    derivedStatus: string;
    balanceDue: number;
    invoiceNumber: string;
  };
  payments: Array<{
    id: string;
    amount: number;
    paymentMethod: string;
    referenceNo?: string | null;
    notes?: string | null;
    paymentDate: string;
  }>;
  canRecordPayment: boolean;
}

const PAYMENT_METHODS = ["ACH", "Wire", "Check", "Credit Card", "Other"];

export function InvoiceDetailClient({ invoice, payments, canRecordPayment }: Props) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handlePaymentSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    startTransition(async () => {
      setError(null);
      try {
        await recordPaymentAction(invoice.id, new FormData(form));
        form.reset();
        setShowPaymentForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record payment");
      }
    });
  };

  const handleLifecycle = (action: () => Promise<{ success: boolean }>) => {
    startTransition(async () => {
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  };

  const handleVoid = () => {
    if (!voidReason.trim()) { setError("Enter a reason for voiding this invoice"); return; }
    startTransition(async () => {
      setError(null);
      try {
        await voidInvoiceAction(invoice.id, voidReason);
        setShowVoidForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to void invoice");
      }
    });
  };

  const { status, balanceDue } = invoice;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs font-semibold text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200">{error}</div>}

      {/* Lifecycle actions */}
      <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Invoice Actions</h3>
        <div className="flex flex-wrap gap-2">
          {status === "DRAFT" && (
            <button onClick={() => handleLifecycle(() => submitInvoiceForApprovalAction(invoice.id))} disabled={isPending}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm disabled:opacity-50">
              Submit for Approval
            </button>
          )}
          {status === "PENDING_APPROVAL" && (
            <button onClick={() => handleLifecycle(() => approveInvoiceAction(invoice.id))} disabled={isPending}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm disabled:opacity-50">
              Approve
            </button>
          )}
          {status === "APPROVED" && (
            <button onClick={() => handleLifecycle(() => sendInvoiceAction(invoice.id))} disabled={isPending}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm disabled:opacity-50">
              Mark as Sent
            </button>
          )}
          {canRecordPayment && balanceDue > 0 && status !== "VOID" && (
            <button onClick={() => setShowPaymentForm((v) => !v)}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white transition-colors shadow-sm">
              Record Payment
            </button>
          )}
          {status !== "VOID" && status !== "PAID" && (
            <button onClick={() => setShowVoidForm((v) => !v)}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
              Void Invoice
            </button>
          )}
        </div>

        {/* Void form */}
        {showVoidForm && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-3">
            <p className="text-xs font-semibold text-rose-800">Voiding this invoice will unlock all associated charges for re-invoicing. This cannot be undone if the invoice has been paid.</p>
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason for voiding (required)"
              className="w-full text-xs border border-rose-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400 bg-white"
            />
            <div className="flex gap-2">
              <button onClick={handleVoid} disabled={isPending || !voidReason.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50">
                Confirm Void
              </button>
              <button onClick={() => { setShowVoidForm(false); setVoidReason(""); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink">Cancel</button>
            </div>
          </div>
        )}

        {/* Payment form */}
        {showPaymentForm && (
          <form onSubmit={handlePaymentSubmit} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
            <h4 className="text-sm font-bold text-ink">Record Payment — Balance Due ${balanceDue.toFixed(2)}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Amount *</label>
                <input name="amount" type="number" min="0.01" step="0.01" max={balanceDue} required
                  placeholder={`0.00 (max ${balanceDue.toFixed(2)})`}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Payment Method *</label>
                <select name="paymentMethod" required className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand bg-white">
                  <option value="">Select method</option>
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Reference No.</label>
                <input name="referenceNo" type="text" placeholder="Check #, wire ref, etc."
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Notes</label>
                <input name="notes" type="text" placeholder="Optional notes"
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50">
                {isPending ? "Recording..." : "Record Payment"}
              </button>
              <button type="button" onClick={() => setShowPaymentForm(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink">Cancel</button>
            </div>
          </form>
        )}
      </div>

      {/* Payment history */}
      <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Payment History</h3>
        {payments.length === 0 ? (
          <p className="text-xs text-ink-muted">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E5E5EA]">
                <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Date</th>
                <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Method</th>
                <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Reference</th>
                <th className="text-right py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-[#F5F5F7]">
                  <td className="py-2 px-3 text-xs text-ink-muted">{p.paymentDate}</td>
                  <td className="py-2 px-3 text-xs font-semibold text-ink">{p.paymentMethod}</td>
                  <td className="py-2 px-3 text-xs font-mono text-ink-muted">{p.referenceNo ?? "—"}</td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-emerald-700">${p.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
