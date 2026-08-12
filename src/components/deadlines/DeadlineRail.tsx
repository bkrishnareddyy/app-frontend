/**
 * Deadline rail — rendered on the shipment detail page.
 *
 * Shows every ComplianceDeadline for the shipment, its clock, status, and
 * provenance (anchor event + rule + CFR citation). Satisfy/waive actions
 * will be added in a follow-up; for now the rail is read-only.
 *
 * Design rules respected:
 * - Estimates are labeled with "~" and muted styling.
 * - "Unknown anchor" items are surfaced, not hidden.
 * - Score is never shown; the clock and dollar figure explain.
 */

import { db } from "@/lib/db";
import { DeadlineStatus } from "@prisma/client";
import { AlertCircle, CheckCircle2, Clock, XCircle, MinusCircle } from "lucide-react";
import { CountdownChip } from "./CountdownChip";

interface DeadlineRailProps {
  shipmentId: string;
  /** Passed from the page to avoid a second DB round-trip for anchor labels. */
  transportMode?: string | null;
}

const DEADLINE_LABELS: Record<string, string> = {
  ISF_10_2: "ISF",
  ENTRY_FILING: "Entry Filing",
  ENTRY_SUMMARY: "Entry Summary",
  DUTY_PAYMENT: "Duty Payment",
  LAST_FREE_DAY: "Last Free Day",
};

const ANCHOR_LABELS: Record<string, string> = {
  LADING: "Lading date",
  ARRIVAL: "Arrival date",
  RELEASE: "Release date",
  ENTRY: "Entry date",
  LIQUIDATION: "Liquidation date",
  CBP_NOTICE: "CBP notice date",
  CARRIER_TERMS: "Carrier terms",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  OPEN: <Clock className="w-3.5 h-3.5 text-ink-muted" />,
  SATISFIED: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  MISSED: <XCircle className="w-3.5 h-3.5 text-red-500" />,
  WAIVED: <MinusCircle className="w-3.5 h-3.5 text-ink-muted" />,
  NOT_APPLICABLE: <MinusCircle className="w-3.5 h-3.5 text-ink-muted" />,
};

export async function DeadlineRail({ shipmentId }: DeadlineRailProps) {
  const deadlines = await db.complianceDeadline.findMany({
    where: { shipmentId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  if (deadlines.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted px-1 py-2">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>No deadlines computed yet. Deadlines are calculated once an anchor date (lading, arrival, or release) is on file.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deadlines.map((d) => {
        const label = DEADLINE_LABELS[d.type] ?? d.type.replace(/_/g, " ");
        const anchorLabel = ANCHOR_LABELS[d.anchorEvent] ?? d.anchorEvent;
        const isOpen = d.status === DeadlineStatus.OPEN;
        const isMissed = d.status === DeadlineStatus.MISSED;

        return (
          <div
            key={d.id}
            className="flex items-start justify-between gap-3 py-2 border-b border-surface-muted last:border-0"
          >
            <div className="flex items-start gap-2 min-w-0">
              <span className="mt-0.5 shrink-0">{STATUS_ICON[d.status] ?? STATUS_ICON.OPEN}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${isMissed ? "text-red-600" : "text-ink"}`}>
                    {label}
                  </span>
                  {d.deadlineClass === "COMMERCIAL" && (
                    <span className="text-[10px] text-ink-muted border border-border px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                      Commercial
                    </span>
                  )}
                  {d.estimated && (
                    <span className="text-[10px] text-amber-600 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded-full">
                      Estimated
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {anchorLabel}
                  {d.anchorAt ? ` · ${new Date(d.anchorAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : " · not on file"}
                  {" · "}
                  <span className="font-mono text-[10px]">{d.ruleCitation}</span>
                </p>
                {d.penaltyBasis && (
                  <p className="text-[11px] text-ink-muted">{d.penaltyBasis}</p>
                )}
              </div>
            </div>

            <div className="shrink-0">
              {isOpen && d.dueAt ? (
                <CountdownChip
                  label={label}
                  dueAt={new Date(d.dueAt)}
                  estimated={d.estimated}
                  exposureUsd={d.penaltyEstimate != null ? Number(d.penaltyEstimate) : null}
                />
              ) : (
                <span className="text-[11px] text-ink-muted tabular-nums">
                  {d.status === DeadlineStatus.SATISFIED && d.satisfiedAt
                    ? `Satisfied ${new Date(d.satisfiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : d.status === DeadlineStatus.MISSED && d.dueAt
                    ? `Missed ${new Date(d.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : d.status === DeadlineStatus.WAIVED
                    ? "Waived"
                    : d.dueAt
                    ? new Date(d.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
