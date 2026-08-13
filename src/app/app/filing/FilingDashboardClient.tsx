"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Search, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Input";
import { displayCurrency, displayDate, displayText } from "@/lib/honest";
import { FILING_STATUSES } from "@/modules/filings/filingStateMachine";
import { PAGE_SIZE_DEFAULT, pageWindow } from "@/modules/tables/tableQuery";

export interface FilingRow {
  id: string;
  entryNumber: string;
  importer: string | null;
  country: string | null;
  filingType: string;
  filingStatus: string;
  totalValue: number | null;
  /** ISO string, or null when never transmitted. */
  filedDate: string | null;
  /** ISO string. */
  lastUpdated: string;
}

const CLEARED_STATUSES = new Set(["Accepted", "Released", "Closed", "BrokerApproved"]);
const BLOCKED_STATUSES = new Set(["ValidationFailed", "Rejected", "CustomsHold", "Cancelled"]);

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  if (CLEARED_STATUSES.has(status)) return "success";
  if (BLOCKED_STATUSES.has(status)) return "danger";
  if (status === "Transmitted" || status === "TransmissionPending" || status === "CancellationRequested") return "info";
  return "neutral";
}

export function FilingDashboardClient({ initialFilings }: { initialFilings: FilingRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = PAGE_SIZE_DEFAULT;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialFilings.filter((f) => {
      if (statusFilter !== "all" && f.filingStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        f.entryNumber.toLowerCase().includes(q) ||
        (f.importer ?? "").toLowerCase().includes(q) ||
        (f.country ?? "").toLowerCase().includes(q) ||
        f.filingType.toLowerCase().includes(q)
      );
    });
  }, [initialFilings, search, statusFilter]);

  const window_ = pageWindow(filtered.length, pageSize, page);
  const pageRows = filtered.slice(window_.start, window_.end);

  const openFiling = (id: string) => router.push(`/app/filing/${id}`);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Customs Filing & Response Center</h1>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            {filtered.length} of {initialFilings.length} filing{initialFilings.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search entry #, importer, country..."
              className="pl-9 w-64"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-44"
          >
            <option value="all">All statuses</option>
            {FILING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-ink-muted bg-surface-muted">
                <th className="py-3 px-4 font-bold">Entry Number</th>
                <th className="py-3 px-4 font-bold">Importer</th>
                <th className="py-3 px-4 font-bold">Country</th>
                <th className="py-3 px-4 font-bold">Filing Type</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold text-right">Total Value</th>
                <th className="py-3 px-4 font-bold">Filed Date</th>
                <th className="py-3 px-4 font-bold">Last Updated</th>
                <th className="py-3 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-ink-muted">
                    No filings match this search.
                  </td>
                </tr>
              ) : (
                pageRows.map((f) => (
                  <tr
                    key={f.id}
                    onDoubleClick={() => openFiling(f.id)}
                    className="hover:bg-surface-muted cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-ink">{f.entryNumber}</td>
                    <td className="py-3 px-4 text-ink">{displayText(f.importer)}</td>
                    <td className="py-3 px-4 text-ink">{displayText(f.country)}</td>
                    <td className="py-3 px-4 text-ink-muted">{f.filingType}</td>
                    <td className="py-3 px-4">
                      <Badge variant={statusBadgeVariant(f.filingStatus)}>{f.filingStatus}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-ink">
                      {displayCurrency(f.totalValue)}
                    </td>
                    <td className="py-3 px-4 text-ink-muted">{displayDate(f.filedDate)}</td>
                    <td className="py-3 px-4 text-ink-muted">{displayDate(f.lastUpdated)}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFiling(f.id);
                        }}
                        aria-label={`View filing ${f.entryNumber}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white hover:bg-surface-muted text-ink font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-ink-muted">
            <span>
              Showing {window_.firstRow}-{window_.lastRow} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={window_.page <= 1}
                className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-surface-muted"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>
                Page {window_.page} of {window_.pages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(window_.pages, p + 1))}
                disabled={window_.page >= window_.pages}
                className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-surface-muted"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
