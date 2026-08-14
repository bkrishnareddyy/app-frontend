"use client";

import { Fragment, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, Gavel, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type RateReviewType = "SECTION_301_RATE" | "SECTION_301_EXCLUSION" | "ADCVD_COMPANY_RATE";

interface RateReviewItem {
  type: RateReviewType;
  id: string;
  headline: string;
  citation: string | null;
  evidenceText: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<RateReviewType, string> = {
  SECTION_301_RATE: "Section 301 Rate",
  SECTION_301_EXCLUSION: "Section 301 Exclusion",
  ADCVD_COMPANY_RATE: "AD/CVD Company Rate",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rowKey(item: Pick<RateReviewItem, "type" | "id">) {
  return `${item.type}:${item.id}`;
}

export function RateReviewPanel() {
  const [items, setItems] = useState<RateReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/platform-admin/rate-review");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to load pending rate reviews");
      setItems(data.items ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load pending rate reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchItems();
  }, []);

  const handleReview = async (item: RateReviewItem, action: "APPROVE" | "REJECT") => {
    const key = rowKey(item);
    setReviewingKey(key);
    setMessage(null);
    try {
      const res = await fetch(`/api/platform-admin/rate-review/${item.type}/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Failed to ${action.toLowerCase()} this item`);

      setItems((prev) => prev.filter((i) => rowKey(i) !== key));
      setMessage({
        type: "success",
        text: `${action === "APPROVE" ? "Approved" : "Rejected"} ${TYPE_LABEL[item.type]}: ${item.headline}`,
      });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error occurred." });
    } finally {
      setReviewingKey(null);
    }
  };

  const byType = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Summary stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
          <div className="flex items-center space-x-2 text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
            <Gavel className="w-3.5 h-3.5" />
            <span>Total Pending</span>
          </div>
          <p className="text-lg font-extrabold text-ink">{items.length}</p>
          <p className="text-[10px] text-ink-muted mt-1">Nothing here affects a duty calculation until approved.</p>
        </div>
        {(["SECTION_301_RATE", "SECTION_301_EXCLUSION", "ADCVD_COMPANY_RATE"] as const).map((type) => (
          <div key={type} className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
            <div className="flex items-center space-x-2 text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
              <span>{TYPE_LABEL[type]}</span>
            </div>
            <p className="text-lg font-extrabold text-ink">{byType[type] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
            <Gavel className="w-5 h-5 text-amber-600" />
            <span>Pending Rate Review ({items.length})</span>
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">
            LLM/scraper-extracted Section 301 and AD/CVD rates. Each row is a distinct legal/financial claim —
            review its citation before approving.
          </p>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span>Loading pending reviews…</span>
          </div>
        ) : loadError ? (
          <div className="p-10 text-center space-y-3">
            <AlertCircle className="w-6 h-6 text-red-500 mx-auto" />
            <p className="text-sm text-red-700">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={fetchItems}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-ink">
              <thead className="bg-surface-muted border-b border-border text-xs uppercase font-bold text-ink-muted">
                <tr>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Item</th>
                  <th className="px-6 py-4">Citation</th>
                  <th className="px-6 py-4">Staged</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => {
                  const key = rowKey(item);
                  const isReviewing = reviewingKey === key;
                  const isExpanded = expandedKey === key;
                  return (
                    <Fragment key={key}>
                      <tr className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <Badge variant="info" className="normal-case">
                            {TYPE_LABEL[item.type]}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold">{item.headline}</div>
                          {item.evidenceText && (
                            <button
                              onClick={() => setExpandedKey(isExpanded ? null : key)}
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline"
                            >
                              <FileText className="w-3 h-3" />
                              <span>{isExpanded ? "Hide evidence" : "View evidence"}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-ink-muted max-w-xs">{item.citation ?? "—"}</td>
                        <td className="px-6 py-4 text-xs text-ink-muted">{formatDateTime(item.createdAt)}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={isReviewing}
                              onClick={() => handleReview(item, "APPROVE")}
                              className="rounded-full py-1.5 shadow-2xs gap-1.5"
                            >
                              {isReviewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>Approve</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={isReviewing}
                              onClick={() => handleReview(item, "REJECT")}
                              className="rounded-full py-1.5 shadow-2xs gap-1.5"
                            >
                              <span>Reject</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && item.evidenceText && (
                        <tr className="bg-surface-muted">
                          <td colSpan={5} className="px-6 py-4">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                              Source text
                            </div>
                            <p className="text-xs text-ink whitespace-pre-wrap font-mono">{item.evidenceText}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-ink-muted">
                      Nothing pending review.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
