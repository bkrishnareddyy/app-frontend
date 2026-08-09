"use client";

import { useState } from "react";
import { Download, Send } from "lucide-react";

interface FilingActionsProps {
  filingId: string;
  filingStatus: string;
  /** True when the only wired transmission provider is a simulation. */
  isSimulatedTransmission: boolean;
  providerName: string;
}

type ActionState =
  | { kind: "idle" }
  | { kind: "busy"; action: "export" | "transmit" }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string };

export function FilingActions({
  filingId,
  filingStatus,
  isSimulatedTransmission,
  providerName,
}: FilingActionsProps) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);

  const busy = state.kind === "busy";

  const exportPackage = async () => {
    setState({ kind: "busy", action: "export" });
    try {
      const res = await fetch(`/api/filing/${filingId}/entry-summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          kind: "failed",
          message: body?.error?.message ?? `Export failed (HTTP ${res.status}).`,
        });
        return;
      }

      const blob = new Blob([JSON.stringify(body.entrySummary, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `entry-summary-${filingId}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setState({
        kind: "done",
        // The endpoint returns the stored 7501 field values, not a filled PDF.
        message: "Downloaded the stored entry summary fields as JSON. This is not a CBP-ready PDF.",
      });
    } catch {
      setState({ kind: "failed", message: "The entry summary could not be retrieved." });
    }
  };

  const transmit = async () => {
    setConfirming(false);
    setState({ kind: "busy", action: "transmit" });
    try {
      const res = await fetch(`/api/filing/${filingId}/transmit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          kind: "failed",
          message: body?.error?.message ?? `Transmission failed (HTTP ${res.status}).`,
        });
        return;
      }

      const provider = body?.transmission?.providerMetadata?.providerName ?? providerName;
      setState({
        kind: "done",
        message: `${body?.transmission?.status ?? "Recorded"} by ${provider}. Reload to see the response log.`,
      });
    } catch {
      setState({ kind: "failed", message: "The transmission request could not be sent." });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={exportPackage}
          disabled={busy}
          className="px-4 py-2 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] disabled:opacity-50 text-[#1D1D1F] text-sm font-semibold rounded-xl flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {state.kind === "busy" && state.action === "export"
              ? "Exporting…"
              : "Export entry summary (JSON)"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy || filingStatus === "Transmitted" || filingStatus === "Released"}
          className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {state.kind === "busy" && state.action === "transmit"
              ? "Transmitting…"
              : isSimulatedTransmission
              ? "Transmit (simulation)"
              : "Transmit to CBP"}
          </span>
        </button>
      </div>

      {isSimulatedTransmission && (
        <p className="text-sm text-amber-800 font-semibold">
          {providerName} is a simulation. Nothing is sent to CBP and no entry is filed.
        </p>
      )}

      {confirming && (
        <div className="p-3 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] text-sm space-y-2">
          <p className="text-[#1D1D1F]">
            {isSimulatedTransmission
              ? `This records a simulated response from ${providerName} against the filing. No entry is filed with CBP.`
              : `This transmits the entry to ${providerName}.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={transmit}
              className="px-4 py-1.5 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-4 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-sm font-semibold text-[#1D1D1F]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-sm" aria-live="polite">
        {state.kind === "done" && (
          <span className="text-emerald-800 font-semibold">{state.message}</span>
        )}
        {state.kind === "failed" && (
          <span role="alert" className="text-red-800 font-semibold">
            {state.message}
          </span>
        )}
      </p>
    </div>
  );
}
