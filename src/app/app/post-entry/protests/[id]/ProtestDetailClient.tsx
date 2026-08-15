"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  Clock,
  Send,
  FileCheck,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface ProtestDetail {
  id: string;
  groundsCode: string;
  groundsNarrative: string;
  statuteCitation: string | null;
  rulingReference: string | null;
  claimAmount: number;
  interestClaimed: boolean;
  powerOfAttorneyVerified: boolean;
  poaExpiresAt: string | null;
  furtherReviewRequested: boolean;
  frpJustification: string | null;
  protestNumber: string | null;
  status: string;
  liquidationDate: string;
  protestDeadline: string;
  deemedDeniedAt: string | null;
  citAppealDeadline: string | null;
  filedAt: string | null;
  createdAt: string;
  protestEntries: Array<{
    id: string;
    entryNumber: string;
    liquidationDate: string;
    dutyAssessed: number;
    dutyContested: number;
  }>;
  Notes?: Array<{
    id: string;
    authorId: string;
    body: string;
    isInternal: boolean;
    createdAt: string;
  }>;
}

export function ProtestDetailClient({ protestId }: { protestId: string }) {
  const [protest, setProtest] = useState<ProtestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // FRP Modal state
  const [showFrpModal, setShowFrpModal] = useState(false);
  const [frpJustification, setFrpJustification] = useState("");

  // Notes state
  const [newNoteBody, setNewNoteBody] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  // Action state
  const [actionProcessing, setActionProcessing] = useState(false);

  const loadProtest = useCallback(() => {
    setLoading(true);
    fetch(`/api/protests/${protestId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.protest) {
          setProtest(d.protest);
        } else {
          setError(d.error || "Protest not found");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [protestId]);

  useEffect(() => {
    loadProtest();
  }, [loadProtest]);

  const handleMarkReady = async () => {
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/protests/${protestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY_FOR_FILING" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update status");
      loadProtest();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  const handleFileProtest = async () => {
    if (!confirm("Are you sure you want to file this Form 19 Protest with CBP? Filing is irrevocable.")) return;
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/protests/${protestId}/file`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to file protest");
      loadProtest();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  const handleRequestFrp = async () => {
    if (!frpJustification.trim() || frpJustification.length < 20) {
      alert("FRP justification must be at least 20 characters.");
      return;
    }
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/protests/${protestId}/frp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justification: frpJustification }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to request FRP");
      setShowFrpModal(false);
      loadProtest();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteBody.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/protests/${protestId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNoteBody, isInternal: true }),
      });
      if (res.ok) {
        setNewNoteBody("");
        loadProtest();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingNote(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-ink-muted">Loading Protest details...</div>;
  }

  if (error || !protest) {
    return (
      <div className="p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="font-bold text-ink">{error || "Protest not found"}</p>
        <Link href="/app/post-entry/protests" className="mt-4 inline-block text-brand text-sm font-medium">
          ← Back to Protests
        </Link>
      </div>
    );
  }

  // Day-granularity countdown display; being off by a render is harmless.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const daysLeft = Math.max(
    0,
    Math.floor((new Date(protest.protestDeadline).getTime() - nowMs) / (1000 * 60 * 60 * 24))
  );

  return (
    <div className="min-h-screen bg-surface-muted pb-12">
      {/* Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/app/post-entry/protests" className="hover:text-brand transition-colors">Protests</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">Protest #{protest.id.slice(-6).toUpperCase()}</span>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link
              href="/app/post-entry/protests"
              className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-ink tracking-tight">
                  Protest #{protest.id.slice(-6).toUpperCase()}
                </h1>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
                  {protest.status}
                </span>
                {protest.furtherReviewRequested && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> FRP Requested
                  </span>
                )}
              </div>
              <p className="text-sm text-ink-muted mt-0.5">
                Grounds: {protest.groundsCode} • Claim: {displayCurrency(protest.claimAmount)}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {protest.status === "DRAFT" && (
              <button
                onClick={handleMarkReady}
                disabled={actionProcessing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                <FileCheck className="w-4 h-4" /> Mark Ready for Filing
              </button>
            )}

            {protest.status === "READY_FOR_FILING" && (
              <button
                onClick={handleFileProtest}
                disabled={actionProcessing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Transmit & File (Form 19)
              </button>
            )}

            {!protest.furtherReviewRequested && ["DRAFT", "READY_FOR_FILING", "FILED"].includes(protest.status) && (
              <button
                onClick={() => setShowFrpModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-white text-amber-700 text-sm font-semibold hover:bg-amber-50 transition-colors"
              >
                <ShieldCheck className="w-4 h-4" /> Request FRP
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 pt-8 space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Contested Claim Amount</p>
            <p className="text-lg font-bold font-mono text-ink mt-1">{displayCurrency(protest.claimAmount)}</p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">POA Status</p>
            <p className={`text-sm font-bold mt-1.5 flex items-center gap-1 ${protest.powerOfAttorneyVerified ? "text-emerald-700" : "text-amber-700"}`}>
              <ShieldCheck className="w-4 h-4" />
              {protest.powerOfAttorneyVerified ? "Verified Active" : "Unverified"}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Statutory Filing Deadline</p>
            <p className="text-lg font-bold text-ink mt-1 flex items-center gap-1">
              <Clock className="w-4 h-4 text-ink-muted" />
              {daysLeft} days left
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Deemed Denial Window</p>
            <p className="text-sm font-medium text-ink mt-1.5">
              {protest.deemedDeniedAt ? new Date(protest.deemedDeniedAt).toLocaleDateString() : "Pending filing"}
            </p>
          </div>
        </div>

        {/* Covered Entries Table */}
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-ink mb-3">Covered Entry Summaries</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-muted border-b border-border text-xs uppercase font-semibold text-ink-muted">
                  <th className="px-4 py-2.5 text-left">Entry Number</th>
                  <th className="px-4 py-2.5 text-left">Liquidation Date</th>
                  <th className="px-4 py-2.5 text-left">Assessed Duty</th>
                  <th className="px-4 py-2.5 text-left">Contested Portion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {protest.protestEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-mono font-bold text-ink">{e.entryNumber}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{new Date(e.liquidationDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 font-mono">{displayCurrency(e.dutyAssessed)}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-emerald-700">{displayCurrency(e.dutyContested)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legal Narrative & Citations */}
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-ink">Grounds & Written Justification</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">Statute Citation</p>
              <p className="text-sm font-mono text-ink mt-0.5">{protest.statuteCitation || "None specified"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">CBP Ruling Reference</p>
              <p className="text-sm font-mono text-ink mt-0.5">{protest.rulingReference || "None specified"}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-ink-muted mb-1">Full Grounds Narrative</p>
            <div className="p-4 rounded-xl bg-surface-muted border border-border text-sm text-ink leading-relaxed whitespace-pre-wrap">
              {protest.groundsNarrative}
            </div>
          </div>

          {protest.frpJustification && (
            <div>
              <p className="text-xs font-semibold uppercase text-amber-800 mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Further Review of Protest (FRP) Justification
              </p>
              <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                {protest.frpJustification}
              </div>
            </div>
          )}
        </div>

        {/* Notes & Activity Log */}
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-brand" /> Notes & Activity Log
          </h2>

          <form onSubmit={handleAddNote} className="flex gap-2">
            <input
              type="text"
              placeholder="Add internal compliance note..."
              value={newNoteBody}
              onChange={(e) => setNewNoteBody(e.target.value)}
              className="flex-1 text-sm border border-border rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              type="submit"
              disabled={submittingNote}
              className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold shadow-xs hover:bg-brand/90"
            >
              Add Note
            </button>
          </form>

          <div className="space-y-2 pt-2">
            {protest.Notes && protest.Notes.length > 0 ? (
              protest.Notes.map((n) => (
                <div key={n.id} className="p-3 rounded-xl bg-surface-muted/50 border border-border text-xs">
                  <p className="text-ink leading-relaxed">{n.body}</p>
                  <p className="text-ink-muted mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-ink-muted italic">No internal notes logged yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* FRP Modal */}
      {showFrpModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-600" />
              Request Further Review of Protest (FRP)
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              FRP escalates the protest decision from the port director to CBP HQ. Required when the protest raises a novel legal question or conflicts with an existing ruling.
            </p>
            <textarea
              rows={4}
              placeholder="Explain why this protest merits Further Review by CBP Headquarters..."
              value={frpJustification}
              onChange={(e) => setFrpJustification(e.target.value)}
              className="w-full text-sm border border-border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFrpModal(false)}
                className="px-4 py-2 rounded-xl border border-border text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestFrp}
                disabled={actionProcessing}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
              >
                Submit FRP Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
