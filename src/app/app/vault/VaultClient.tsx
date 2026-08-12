"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Sparkles,
  LayoutGrid,
  List as ListIcon,
  FileText,
  Ship,
  BadgeCheck,
  ClipboardList,
  FileCheck2,
  ChevronLeft,
  ChevronRight,
  ArchiveX,
  Trash2,
} from "lucide-react";
import { SYSTEM_DOCUMENT_TYPES } from "@/modules/intake/documentTypeCatalog";
import { documentViewUrl } from "@/lib/documentUrl";
import { RawExtractionModal } from "@/components/RawExtractionModal";

interface VaultDocument {
  id: string;
  fileName: string;
  docType: string;
  status: string;
  createdAt: string;
  shipmentId: string | null;
  shipmentNumber: string | null;
  clientId: string | null;
  clientName: string | null;
  shipmentStatus: string | null;
  shipmentDeleted: boolean;
}

interface ClientOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 12;
const RETENTION_YEARS = 5;

const DOC_TYPE_LABELS = new Map(SYSTEM_DOCUMENT_TYPES.map((t) => [t.code, t.name]));
function docTypeLabel(code: string): string {
  return DOC_TYPE_LABELS.get(code) ?? code;
}

// A small subset of the ~150-code catalog worth parsing plain-English search
// terms into: the document types brokers actually search for by name.
const TYPE_KEYWORDS: Array<{ code: string; match: string[] }> = [
  { code: "COMMERCIAL_INVOICE", match: ["invoice", "invoices"] },
  { code: "OCEAN_BILL_OF_LADING", match: ["bol", "bill of lading", "b/l"] },
  { code: "GENERAL_CERTIFICATE_OF_ORIGIN", match: ["coo", "certificate of origin", "certificate", "certificates"] },
  { code: "PACKING_LIST", match: ["packing list", "packing"] },
  { code: "CBP_FORM_7501_ENTRY_SUMMARY", match: ["7501", "entry summary"] },
];

const MONTHS: Array<{ n: number; names: string[] }> = [
  { n: 0, names: ["january", "jan"] },
  { n: 1, names: ["february", "feb"] },
  { n: 2, names: ["march", "mar"] },
  { n: 3, names: ["april", "apr"] },
  { n: 4, names: ["may"] },
  { n: 5, names: ["june", "jun"] },
  { n: 6, names: ["july", "jul"] },
  { n: 7, names: ["august", "aug"] },
  { n: 8, names: ["september", "sept", "sep"] },
  { n: 9, names: ["october", "oct"] },
  { n: 10, names: ["november", "nov"] },
  { n: 11, names: ["december", "dec"] },
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STOPWORDS = new Set([
  "a", "an", "the", "that", "this", "was", "for", "of", "in", "on", "around", "about",
  "looking", "im", "i'm", "i", "need", "find", "show", "me", "from", "documents", "document",
  "doc", "docs", "with", "and", "or", "to", "please", "search", "old", "was",
]);

interface ParsedQuery {
  docType: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  dateLabel: string | null;
  clientToken: string | null;
  textToken: string | null;
}

function parseVaultQuery(raw: string, clientNames: string[]): ParsedQuery {
  const text = ` ${raw.toLowerCase().trim()} `;
  const today = new Date();

  let bestClient: string | null = null;
  let bestLen = -1;
  clientNames.forEach((name) => {
    const firstWord = name.toLowerCase().replace(/[^a-z0-9' ]/g, "").split(" ")[0];
    if (firstWord.length > 2 && text.includes(` ${firstWord}`) && firstWord.length > bestLen) {
      bestClient = firstWord;
      bestLen = firstWord.length;
    }
  });

  let docType: string | null = null;
  for (const t of TYPE_KEYWORDS) {
    if (t.match.some((m) => text.includes(m))) {
      docType = t.code;
      break;
    }
  }

  let foundMonth: number | null = null;
  for (const m of MONTHS) {
    if (m.names.some((nm) => new RegExp(`\\b${nm}\\b`).test(text))) {
      foundMonth = m.n;
      break;
    }
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const explicitYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  let relYear: number | null = null;
  if (/\blast year\b/.test(text)) relYear = today.getFullYear() - 1;
  else if (/\bthis year\b/.test(text)) relYear = today.getFullYear();
  else if (/\bnext year\b/.test(text)) relYear = today.getFullYear() + 1;

  const resolvedYear = explicitYear || relYear;

  let dateFrom: Date | null = null;
  let dateTo: Date | null = null;
  let dateLabel: string | null = null;

  if (foundMonth !== null && resolvedYear) {
    dateFrom = new Date(resolvedYear, foundMonth, 1);
    dateTo = new Date(resolvedYear, foundMonth + 1, 0);
    dateLabel = `${MONTH_SHORT[foundMonth]} ${resolvedYear}`;
  } else if (resolvedYear && foundMonth === null) {
    dateFrom = new Date(resolvedYear, 0, 1);
    dateTo = new Date(resolvedYear, 11, 31);
    dateLabel = String(resolvedYear);
  } else if (/\blast 30 days\b|\bpast 30 days\b/.test(text)) {
    dateTo = new Date(today);
    dateFrom = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    dateLabel = "Last 30 days";
  } else if (/\blast 90 days\b|\bpast 90 days\b/.test(text)) {
    dateTo = new Date(today);
    dateFrom = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
    dateLabel = "Last 90 days";
  }

  const consumed = new Set<string>();
  if (bestClient) consumed.add(bestClient);
  if (docType) {
    TYPE_KEYWORDS.find((t) => t.code === docType)!.match.forEach((m) => {
      m.split(" ").forEach((w) => consumed.add(w));
    });
  }
  MONTHS.forEach((m) => m.names.forEach((nm) => consumed.add(nm)));
  ["last", "this", "next", "year", "years", "30", "90", "days"].forEach((w) => consumed.add(w));
  if (explicitYear) consumed.add(String(explicitYear));

  const tokens = raw.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
  const leftover = tokens.filter((w) => !STOPWORDS.has(w) && !consumed.has(w) && w.length > 2);

  return {
    docType,
    dateFrom,
    dateTo,
    dateLabel,
    clientToken: bestClient,
    textToken: leftover.length ? leftover.join(" ") : null,
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function retentionLabel(doc: VaultDocument): string {
  const d = new Date(doc.createdAt);
  const until = new Date(d.getFullYear() + RETENTION_YEARS, d.getMonth(), d.getDate());
  return `Retention until ${MONTH_SHORT[until.getMonth()]} ${until.getFullYear()}`;
}

function archiveReason(doc: VaultDocument): string {
  if (doc.shipmentDeleted) return "Shipment deleted";
  return doc.shipmentStatus ? `Shipment ${doc.shipmentStatus.toLowerCase()}` : "Archived";
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  COMMERCIAL_INVOICE: <FileText className="w-4 h-4" />,
  OCEAN_BILL_OF_LADING: <Ship className="w-4 h-4" />,
  GENERAL_CERTIFICATE_OF_ORIGIN: <BadgeCheck className="w-4 h-4" />,
  PACKING_LIST: <ClipboardList className="w-4 h-4" />,
  CBP_FORM_7501_ENTRY_SUMMARY: <FileCheck2 className="w-4 h-4" />,
};
function docIcon(code: string) {
  return TYPE_ICON[code] ?? <FileText className="w-4 h-4" />;
}

export function VaultClient() {
  const [rawQuery, setRawQuery] = useState("");
  const [parsed, setParsed] = useState<ParsedQuery>({
    docType: null,
    dateFrom: null,
    dateTo: null,
    dateLabel: null,
    clientToken: null,
    textToken: null,
  });
  const [selectedClientId, setSelectedClientId] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState<VaultDocument | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => (res.ok ? res.json() : { clients: [] }))
      .then((data) => setClients((data.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
  }, []);

  const clientNames = useMemo(() => clients.map((c) => c.name), [clients]);

  // Debounced NL parse: re-derive structured filters from the typed text.
  useEffect(() => {
    if (!rawQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParsed({ docType: null, dateFrom: null, dateTo: null, dateLabel: null, clientToken: null, textToken: null });
      setPage(1);
      return;
    }
    const timer = setTimeout(() => {
      setParsed(parseVaultQuery(rawQuery, clientNames));
      setPage(1);
    }, 380);
    return () => clearTimeout(timer);
  }, [rawQuery, clientNames]);

  useEffect(() => {
    // Sets the loading flag synchronously so the spinner shows on the same paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set("scope", "archive");
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    params.set("sort", "createdAt");
    params.set("dir", "desc");
    if (parsed.docType) params.set("docType", parsed.docType);
    if (parsed.dateFrom) params.set("from", parsed.dateFrom.toISOString());
    if (parsed.dateTo) params.set("to", parsed.dateTo.toISOString());
    if (selectedClientId) params.set("clientId", selectedClientId);
    const searchText = [parsed.clientToken, parsed.textToken].filter(Boolean).join(" ");
    if (searchText) params.set("search", searchText);

    fetch(`/api/documents?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { documents: [], total: 0 }))
      .then((data) => {
        setDocuments(data.documents ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        setDocuments([]);
        setTotal(0);
      })
      .finally(() => setIsLoading(false));
  }, [parsed, selectedClientId, page]);

  const hasFilters = Boolean(
    parsed.docType || parsed.dateFrom || parsed.clientToken || parsed.textToken || selectedClientId
  );

  const runExample = (q: string) => setRawQuery(q);

  const clearAll = () => {
    setRawQuery("");
    setParsed({ docType: null, dateFrom: null, dateTo: null, dateLabel: null, clientToken: null, textToken: null });
    setSelectedClientId("");
    setPage(1);
  };

  const removeChip = (kind: "client" | "type" | "date" | "text") => {
    setParsed((prev) => ({
      ...prev,
      ...(kind === "client" ? { clientToken: null } : {}),
      ...(kind === "type" ? { docType: null } : {}),
      ...(kind === "date" ? { dateFrom: null, dateTo: null, dateLabel: null } : {}),
      ...(kind === "text" ? { textToken: null } : {}),
    }));
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
        <span>Account</span>
        <span>›</span>
        <span className="text-ink font-medium">Document Vault</span>
      </div>

      <div className="flex items-center justify-between gap-4 bg-white px-5 py-3.5 rounded-2xl border border-border shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center text-white shrink-0">
            <ArchiveX className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-ink tracking-tight">Document Vault</h1>
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                Compliance archive
              </span>
            </div>
            <p className="text-[11.5px] text-ink-muted truncate">
              Closed-shipment records, kept for compliance — separate from{" "}
              <Link href="/app/documents" className="text-brand hover:underline">
                active Trade Documents
              </Link>
            </p>
          </div>
        </div>
        <Link
          href="/app/documents"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border bg-white text-ink text-xs font-semibold hover:bg-surface-muted transition-colors shrink-0"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Active Documents
        </Link>
      </div>

      <div className="bg-white border border-border rounded-3xl p-6 sm:p-7 shadow-sm">
        <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-brand mb-2.5">
          <Sparkles className="w-3 h-3" />
          Plain-english search
        </div>
        <h2 className="text-lg sm:text-xl font-extrabold text-ink tracking-tight mb-1.5">
          Find any old document the way you&apos;d describe it.
        </h2>
        <p className="text-xs text-ink-muted mb-5 max-w-2xl">
          Pulling a record from a shipment filed a while back? Skip the filenames and shipment IDs — describe it
          like you would to a colleague: a client, a rough date, what it was for.
        </p>

        <div className="flex items-center gap-2.5 bg-surface-muted border-[1.5px] border-border focus-within:border-brand rounded-2xl pl-4 pr-1.5 py-1.5 transition-colors">
          <Search className="w-4 h-4 text-ink-muted shrink-0" />
          <input
            type="text"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Try: an invoice that was for Sears around September last year"
            className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-ink-faint py-2.5"
          />
          {rawQuery && (
            <button
              onClick={clearAll}
              className="w-6 h-6 rounded-full bg-border/70 hover:bg-border flex items-center justify-center text-ink-muted shrink-0 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {!rawQuery && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-dashed border-border">
            <span className="text-[11px] text-ink-faint mr-1">Try:</span>
            {[
              "an invoice that was for sears around sept of last year",
              "certificates of origin",
              "invoices from last year",
            ].map((q) => (
              <button
                key={q}
                onClick={() => runExample(q)}
                className="text-[11.5px] font-medium text-ink-muted bg-surface-muted border border-border rounded-full px-3 py-1.5 hover:bg-brand/10 hover:text-brand hover:border-transparent transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-dashed border-border">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
              <Sparkles className="w-2.5 h-2.5" />
              Understood as
            </span>
            {parsed.clientToken && (
              <Chip label="client" value={parsed.clientToken} onRemove={() => removeChip("client")} />
            )}
            {parsed.docType && (
              <Chip label="type" value={docTypeLabel(parsed.docType)} onRemove={() => removeChip("type")} />
            )}
            {parsed.dateLabel && <Chip label="date" value={parsed.dateLabel} onRemove={() => removeChip("date")} />}
            {parsed.textToken && (
              <Chip label="matches" value={`"${parsed.textToken}"`} onRemove={() => removeChip("text")} />
            )}
            <button onClick={clearAll} className="text-[11px] text-ink-muted underline hover:text-ink cursor-pointer ml-1">
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            value={parsed.docType ?? ""}
            onChange={(e) => {
              setParsed((prev) => ({ ...prev, docType: e.target.value || null }));
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand cursor-pointer font-medium"
          >
            <option value="">All types</option>
            {TYPE_KEYWORDS.map((t) => (
              <option key={t.code} value={t.code}>
                {docTypeLabel(t.code)}
              </option>
            ))}
          </select>

          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand cursor-pointer font-medium"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            {isLoading ? "Searching…" : `${total} document${total === 1 ? "" : "s"}`}
          </span>
          <div className="flex items-center bg-surface-muted border border-border rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                viewMode === "grid" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                viewMode === "list" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              List
            </button>
          </div>
        </div>
      </div>

      {!isLoading && documents.length === 0 ? (
        <div className="bg-white border border-dashed border-border rounded-3xl py-16 text-center">
          <Trash2 className="w-8 h-8 mx-auto text-ink-faint mb-2.5" />
          <h3 className="text-sm font-bold text-ink mb-1">No archived documents match that search</h3>
          <p className="text-xs text-ink-muted">
            Try removing a filter, widening the date range, or check{" "}
            <Link href="/app/documents" className="text-brand hover:underline">
              Active Documents
            </Link>{" "}
            if the shipment is still open.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => setPreviewDoc(doc)}
              className="text-left bg-white border border-border rounded-2xl p-4 shadow-xs hover:shadow-sm hover:border-border-strong hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col gap-2.5"
            >
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-[10px] bg-brand/10 text-brand flex items-center justify-center shrink-0">
                  {docIcon(doc.docType)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink truncate" title={doc.fileName}>
                    {doc.fileName}
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{docTypeLabel(doc.docType)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {doc.clientName && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand/10 text-brand">
                    {doc.clientName}
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-surface-muted text-ink-muted border border-border">
                  {archiveReason(doc)}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-ink-muted pt-2 border-t border-border">
                <span className="font-mono text-brand font-semibold">{doc.shipmentNumber ?? "—"}</span>
                <span>{fmtDate(doc.createdAt)}</span>
              </div>
              <p className="text-[10.5px] text-ink-faint">{retentionLabel(doc)}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-border rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-ink">
              <thead className="bg-surface-muted border-b border-border text-[10.5px] font-bold text-ink-muted uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-5">Document</th>
                  <th className="py-3 px-5">Type</th>
                  <th className="py-3 px-5">Client</th>
                  <th className="py-3 px-5">Shipment</th>
                  <th className="py-3 px-5">Date</th>
                  <th className="py-3 px-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    onClick={() => setPreviewDoc(doc)}
                    className="hover:bg-surface-muted/60 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-5 font-semibold text-ink">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                          {docIcon(doc.docType)}
                        </span>
                        <span className="truncate max-w-xs">{doc.fileName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-ink-muted">{docTypeLabel(doc.docType)}</td>
                    <td className="py-3 px-5">{doc.clientName ?? <span className="text-ink-muted">—</span>}</td>
                    <td className="py-3 px-5 font-mono text-[11px] text-brand">{doc.shipmentNumber ?? "—"}</td>
                    <td className="py-3 px-5 text-ink-muted">{fmtDate(doc.createdAt)}</td>
                    <td className="py-3 px-5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-surface-muted text-ink-muted border border-border">
                        {archiveReason(doc)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <nav className="flex flex-wrap items-center justify-between gap-3 px-1" aria-label="Document vault pagination">
        <p className="text-xs text-ink-muted">
          {total === 0 ? "No documents" : `${firstRow}–${lastRow} of ${total} documents`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>

      {previewDoc && (
        <RawExtractionModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentId={previewDoc.id}
          fileName={previewDoc.fileName}
          docType={docTypeLabel(previewDoc.docType)}
          shipmentNumber={previewDoc.shipmentNumber}
          proxyUrl={documentViewUrl(previewDoc.id)}
        />
      )}
    </div>
  );
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-brand/10 text-brand rounded-full pl-3 pr-1.5 py-1.5 text-xs font-semibold">
      <span className="opacity-70 font-medium">{label}:</span>
      {value}
      <button
        onClick={onRemove}
        className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10 cursor-pointer"
        title="Remove filter"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}
