import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayCurrency, displayDate, displayText } from "@/lib/honest";
import { filingStages, type FilingStageState } from "@/modules/filings/filingStateMachine";
import Link from "next/link";
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  Send,
  Building2,
  DollarSign,
  AlertCircle,
  ChevronRight,
  Download,
  Info,
} from "lucide-react";

const CLEARED_STATUSES = new Set(["Accepted", "Released", "Closed", "BrokerApproved"]);
const BLOCKED_STATUSES = new Set(["ValidationFailed", "Rejected", "CustomsHold", "Cancelled"]);

function statusPill(status: string | null | undefined): string {
  if (status && CLEARED_STATUSES.has(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status && BLOCKED_STATUSES.has(status)) return "bg-red-50 text-red-700 border-red-200";
  return "bg-surface-muted text-[#6E6E73] border-border";
}

const STAGE_STYLES: Record<FilingStageState, string> = {
  complete: "border-emerald-500 bg-emerald-50 text-emerald-800",
  current: "border-brand bg-blue-50 text-blue-900 font-bold",
  blocked: "border-red-300 bg-red-50 text-red-800",
  pending: "border-border bg-surface-muted text-ink-muted",
};

const STAGE_STATE_LABELS: Record<FilingStageState, string> = {
  complete: "Completed",
  current: "In progress",
  blocked: "Blocked",
  pending: "Pending",
};

export default async function CustomsFilingPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  const param = (value: string | string[] | undefined) =>
    typeof value === "string" ? value.trim() || null : Array.isArray(value) ? value[0] ?? null : null;
  const filingId = param(searchParams.filingId);
  const shipmentId = param(searchParams.shipmentId);

  const filing = await db.customsFiling.findFirst({
    where: {
      accountId: context.accountId,
      ...(filingId ? { id: filingId } : shipmentId ? { shipmentId } : {}),
    },
    include: {
      shipment: { include: { documents: true } },
      responses: { orderBy: { receivedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  // A deep link that resolves to nothing has to say so. Falling through to the
  // newest filing would render a different entry under the requested one's URL.
  if ((filingId || shipmentId) && !filing) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <AlertCircle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-ink">Filing not found</h1>
        <p className="text-sm text-ink-muted">
          {filingId
            ? "The filing this link points to is not in this account. It may have been removed."
            : "No customs filing has been created for that shipment yet."}
        </p>
        <Link href="/app/filing" className="inline-block text-sm font-semibold text-brand">
          Open the most recent filing
        </Link>
      </div>
    );
  }

  const dutyBreakdown =
    (filing?.dutyBreakdown as { feeName: string; amount: number; rate: string }[] | null) ?? [];

  const stages = filingStages(filing?.filingStatus ?? "");
  // Only the stages CustomsFiling actually timestamps get a date; the rest show none
  // rather than borrowing a neighbouring stage's time.
  const stageDates: Record<string, Date | null> = {
    prepare: filing?.createdAt ?? null,
    review: null,
    transmit: filing?.submittedAt ?? null,
    clearance: filing?.releasedAt ?? null,
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Customs Filing & Response Center</h1>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Automated ABI entry summary filing and real-time CBP response tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Export 7501 Package — disabled until QPR-001 Gate 2: requires real provider + broker approval */}
          <button
            disabled
            title="Export 7501 Package requires a validated filing with real CBP data. Coming in Gate 2."
            className="px-4 py-2 bg-white border border-border text-ink-muted text-xs font-semibold rounded-xl shadow-2xs flex items-center space-x-1.5 whitespace-nowrap opacity-50 cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export 7501 Package</span>
          </button>
          {/* Transmit to CBP — disabled until QPR-001 Gate 2: requires real ABI/ACE provider */}
          <button
            disabled
            title="CBP transmission requires a real ABI/ACE provider configured in production. Coming in Gate 2."
            className="px-5 py-2 bg-brand text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 whitespace-nowrap opacity-40 cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Transmit to CBP (ABI)</span>
          </button>
        </div>
      </div>

      {/* 4-Step Timeline Stepper */}
      <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Customs Filing Timeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          {stages.map((stage, index) => {
            const at = stageDates[stage.key];
            return (
              <div key={stage.key} className={`p-4 rounded-xl border ${STAGE_STYLES[stage.state]} space-y-1`}>
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-sm">Step {index + 1}</span>
                  <span className="text-[10px] uppercase font-bold">{STAGE_STATE_LABELS[stage.state]}</span>
                </div>
                <p className="font-bold text-ink">{stage.label}</p>
                {at ? <p className="text-[10px] text-ink-muted">{displayDate(at)}</p> : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Filing Summary & Duty Breakdown (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">
                  Entry Summary: {displayText(filing?.entryNumber)}
                </h3>
                <p className="text-xs text-ink-muted">Filing Authority: {displayText(filing?.authority)}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${statusPill(filing?.filingStatus)}`}>
                Status: {displayText(filing?.filingStatus)}
              </span>
            </div>

            {/* Entry Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div><p className="text-ink-muted">Entry Type</p><p className="font-bold text-ink">{displayText(filing?.entryType)}</p></div>
              <div><p className="text-ink-muted">Filing Method</p><p className="font-bold text-ink">{displayText(filing?.filingType)}</p></div>
              <div><p className="text-ink-muted">Payment Status</p><p className={`font-bold ${filing?.paymentStatus === "Paid" ? "text-emerald-600" : "text-ink"}`}>{displayText(filing?.paymentStatus)}</p></div>
              <div><p className="text-ink-muted">Entered Value</p><p className="font-bold text-ink">{displayCurrency(filing?.totalValue?.toString())}</p></div>
            </div>

            {/* Duty & Tax Breakdown Table (DYNAMIC FROM DATABASE) */}
            <div className="space-y-3 pt-3 border-t border-border">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Duty & Tax Breakdown</h4>

              {dutyBreakdown.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  No duty or fee lines have been calculated for this entry yet.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="pb-2">Duty Fee Item</th>
                      <th className="pb-2">Calculation Rate</th>
                      <th className="pb-2 text-right">Amount (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dutyBreakdown.map((duty: { feeName: string; amount: number; rate: string }, idx: number) => (
                      <tr key={idx} className="hover:bg-surface-muted">
                        <td className="py-2.5 font-semibold text-ink">{duty.feeName}</td>
                        <td className="py-2.5 text-ink-muted">{duty.rate}</td>
                        <td className="py-2.5 text-right font-bold text-ink">
                          {displayCurrency(duty.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="flex justify-end pt-3 border-t border-border text-xs space-y-1 text-right">
                <div>
                  <p className="text-ink-muted">Total Duties: <span className="font-bold text-ink">{displayCurrency(filing?.totalDuties?.toString())}</span></p>
                  <p className="text-ink-muted">Total Taxes: <span className="font-bold text-ink">{displayCurrency(filing?.totalTaxes?.toString())}</span></p>
                  <p className="font-extrabold text-sm text-brand mt-1">Total Due: {displayCurrency(filing?.totalAmount?.toString())}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: CBP Responses Feed (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink">CBP Responses Feed</h3>
              <span className="text-xs text-ink-muted">Live Customs ABI Feed</span>
            </div>

            <div className="space-y-3">
              {(filing?.responses || []).map((resp) => (
                <div key={resp.id} className="p-3.5 rounded-xl bg-surface-muted border border-border space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">{resp.title}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        resp.code === "ACK"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : resp.code === "RELE"
                          ? "bg-blue-50 text-brand border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {resp.code}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted">{resp.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
