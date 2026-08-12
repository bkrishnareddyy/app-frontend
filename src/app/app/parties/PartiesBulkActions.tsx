"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClearSelection, useSelectedIds } from "@/components/table/BulkSelection";
import { downloadCsv } from "@/lib/csvExport";

export interface PartyExportRow {
  id: string;
  displayName: string;
  internalPartyCode: string | null;
  roles: string;
  reviewStatusLabel: string;
  statusLabel: string;
  updatedAt: string;
}

type ReviewAction = "START_REVIEW" | "APPROVE" | "REJECT";

interface BulkResult {
  action: ReviewAction;
  succeeded: number;
  failed: { label: string; message: string }[];
}

const HEADERS = ["Party", "Code", "Roles", "Review", "Status", "Updated"];

function toRow(party: PartyExportRow): string[] {
  return [party.displayName, party.internalPartyCode ?? "", party.roles, party.reviewStatusLabel, party.statusLabel, party.updatedAt];
}

async function reviewOne(id: string, action: ReviewAction): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/parties/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Request failed." };
  } catch {
    return { ok: false, message: "Network error." };
  }
}

/**
 * Unlike Products, parties have a review-transition endpoint, so bulk actions here
 * can also start review, approve, or reject — one request per selected party, since
 * there is no bulk-review endpoint. A party in the wrong review state fails on its own
 * without blocking the rest of the batch (`reviewParty` rejects invalid transitions).
 */
export function PartiesBulkBar({
  parties,
  canReview,
  canApprove,
}: {
  parties: readonly PartyExportRow[];
  canReview: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const selected = useSelectedIds();
  const clear = useClearSelection();
  const [running, setRunning] = useState<ReviewAction | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const count = selected.size;

  if (count === 0 && result === null) return null;

  const chosen = parties.filter((party) => selected.has(party.id));

  async function runAction(action: ReviewAction) {
    setRunning(action);
    setResult(null);
    let succeeded = 0;
    const failed: { label: string; message: string }[] = [];
    for (const party of chosen) {
      const outcome = await reviewOne(party.id, action);
      if (outcome.ok) succeeded += 1;
      else failed.push({ label: party.displayName, message: outcome.message });
    }
    setRunning(null);
    setResult({ action, succeeded, failed });
    clear();
    router.refresh();
  }

  return (
    <div className="fixed inset-x-0 bottom-6 flex justify-center px-4 z-20">
      <div className="flex flex-col gap-2 rounded-2xl bg-ink text-white shadow-lg px-5 py-3 max-w-2xl">
        {count > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold">
              {count} {count === 1 ? "party" : "parties"} selected
            </span>
            <button
              type="button"
              onClick={() => downloadCsv(`parties-export-${chosen.length}.csv`, HEADERS, chosen.map(toRow))}
              className="h-9 px-4 rounded-xl bg-white text-ink text-sm font-semibold"
            >
              Export CSV
            </button>
            {canReview && (
              <>
                <button
                  type="button"
                  disabled={running !== null}
                  onClick={() => runAction("START_REVIEW")}
                  className="h-9 px-4 rounded-xl border border-white/30 text-sm font-semibold disabled:opacity-50"
                >
                  {running === "START_REVIEW" ? "Starting review…" : "Start review"}
                </button>
                {canApprove && (
                  <button
                    type="button"
                    disabled={running !== null}
                    onClick={() => runAction("APPROVE")}
                    className="h-9 px-4 rounded-xl border border-white/30 text-sm font-semibold disabled:opacity-50"
                  >
                    {running === "APPROVE" ? "Approving…" : "Approve"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={running !== null}
                  onClick={() => runAction("REJECT")}
                  className="h-9 px-4 rounded-xl border border-white/30 text-sm font-semibold disabled:opacity-50"
                >
                  {running === "REJECT" ? "Rejecting…" : "Reject"}
                </button>
              </>
            )}
            <button type="button" onClick={clear} className="text-sm font-semibold text-white/70 hover:text-white">
              Clear
            </button>
          </div>
        )}
        {result !== null && (
          <div className="text-xs text-white/90 border-t border-white/20 pt-2">
            <p>
              {result.succeeded} succeeded
              {result.failed.length > 0 ? `, ${result.failed.length} failed` : ""}.
            </p>
            {result.failed.length > 0 && (
              <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                {result.failed.map((failure, index) => (
                  <li key={index}>
                    {failure.label}: {failure.message}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setResult(null)} className="mt-1 font-semibold text-white/70 hover:text-white">
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
