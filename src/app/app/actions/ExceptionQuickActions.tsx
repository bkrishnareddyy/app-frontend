"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ExceptionQuickActionsProps {
  exceptionId: string;
  version: number;
  canWaive: boolean;
  onResolved: () => void;
  documentId?: string | null;
}

export function ExceptionQuickActions({
  exceptionId,
  version,
  canWaive,
  onResolved,
  documentId,
}: ExceptionQuickActionsProps) {
  const router = useRouter();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [mode, setMode] = useState<null | "resolve" | "waive">(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [detaching, setDetaching] = useState(false);
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

  const handleReprocess = async () => {
    if (!documentId) return;
    setReprocessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "FULL_PAGE_OCR" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || data?.error || "Re-processing failed.");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReprocessing(false);
    }
  };

  const handleDetach = async () => {
    if (!documentId) return;
    setDetaching(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/detach`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to detach document.");
      }
      onResolved();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetaching(false);
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
    <div className="space-y-1.5 mt-3">
      {error && <p role="alert" className="text-xs text-red-600 font-medium">{error}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {documentId && (
          <button
            type="button"
            onClick={handleReprocess}
            disabled={reprocessing || detaching}
            className="px-3 py-1.5 rounded-xl border border-brand/30 bg-brand/5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-50 transition-colors"
          >
            {reprocessing ? "Re-running extraction…" : "Re-run Extraction"}
          </button>
        )}
        {documentId && (
          <button
            type="button"
            onClick={handleDetach}
            disabled={detaching || reprocessing}
            className="px-3 py-1.5 rounded-xl border border-red-200 bg-red-50/60 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {detaching ? "Detaching…" : "Detach Doc"}
          </button>
        )}
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
    </div>
  );
}
