"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ExceptionQuickActionsProps {
  exceptionId: string;
  version: number;
  canWaive: boolean;
  onResolved: () => void;
}

export function ExceptionQuickActions({
  exceptionId,
  version,
  canWaive,
  onResolved,
}: ExceptionQuickActionsProps) {
  const router = useRouter();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [mode, setMode] = useState<null | "resolve" | "waive">(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError("A stated reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: currentVersion,
          status: mode === "waive" ? "WAIVED" : "RESOLVED",
          resolutionReason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? "Someone else changed this exception while you were working. Reload the page to see the current state."
            : data?.error?.message || data?.error || "The update failed."
        );
      }
      setCurrentVersion(data.exception?.version ?? currentVersion + 1);
      onResolved();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (mode) {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          autoFocus
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === "waive" ? "Why is this risk being accepted?" : "What was done to resolve this?"}
          className="w-full px-3 py-2 rounded-xl border border-border text-xs text-ink resize-none focus:outline-none focus:border-brand"
        />
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 rounded-xl bg-ink text-white text-xs font-semibold disabled:opacity-50"
          >
            {submitting ? "Saving…" : mode === "waive" ? "Confirm waive" : "Confirm resolve"}
          </button>
          <button
            type="button"
            onClick={() => { setMode(null); setReason(""); setError(null); }}
            className="text-xs text-ink-muted hover:text-ink font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mt-3">
      <button
        type="button"
        onClick={() => setMode("resolve")}
        className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-emerald-500 hover:text-emerald-700 transition-colors"
      >
        Resolve
      </button>
      {canWaive && (
        <button
          type="button"
          onClick={() => setMode("waive")}
          className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-amber-400 hover:text-amber-700 transition-colors"
        >
          Waive
        </button>
      )}
    </div>
  );
}
