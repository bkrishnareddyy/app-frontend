"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Search,
  ExternalLink,
  RefreshCw,
  Plus,
  Eye,
  X,
  FileCheck2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { SortableHeaderButton } from "@/components/table/SortableHeaderButton";
import Link from "next/link";
import { documentViewUrl } from "@/lib/documentUrl";
import { displayDate, displayNumber, displayPercent, NOT_CALCULATED } from "@/lib/honest";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useDialogFocus } from "@/lib/useDialogFocus";
import type {
  DocumentSortColumn,
  SortDirection,
} from "@/modules/documents/documentQuery";

interface DocumentRow {
  id: string;
  fileName: string;
  docType: string;
  status: string;
  pageCount: number | null;
  confidence: number | null;
  createdAt: string;
  shipmentId: string;
  shipmentNumber: string | null;
  extractedFieldCount: number;
}

interface DocumentsClientProps {
  accountName: string;
}

const STATUS_STYLE: Record<string, string> = {
  Received: "bg-[#F5F5F7] text-[#1D1D1F] border-[#E5E5EA]",
  "Review Required": "bg-amber-50 text-amber-700 border-amber-200",
  Missing: "bg-red-50 text-red-700 border-red-200",
};

function isImageFile(name: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function isPdfFile(name: string) {
  return /\.pdf$/i.test(name);
}

export function DocumentsClient({ accountName }: DocumentsClientProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("");
  const [sort, setSort] = useState<DocumentSortColumn>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const previewRef = useDialogFocus<HTMLDivElement>(previewDoc !== null, () => setPreviewDoc(null));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { t } = useLanguage();

  const [reloadToken, setReloadToken] = useState(0);
  const fetchDocuments = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          sort,
          dir: direction,
        });
        if (search) params.set("search", search);
        if (docType) params.set("docType", docType);

        const res = await fetch(`/api/documents?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        setDocuments(data.documents ?? []);
        setTotal(data.total ?? 0);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "Could not load documents.");
        setDocuments([]);
        setTotal(0);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [page, pageSize, search, docType, sort, direction, reloadToken]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const applySort = (column: DocumentSortColumn, nextDirection: SortDirection) => {
    setSort(column);
    setDirection(nextDirection);
    setPage(1);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-xs">
        <div>
          <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">{t.documents.title}</h1>
          <p className="text-xs text-[#86868B] mt-0.5">
            {t.documents.subtitle} <strong className="text-[#1D1D1F]">{accountName}</strong>
          </p>
        </div>

        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t.documents.uploadButton}</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
          <input
            type="search"
            aria-label={t.documents.searchPlaceholder}
            placeholder={t.documents.searchPlaceholder}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] transition-colors"
          />
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
          <select
            aria-label={t.documents.allTypes}
            value={docType}
            onChange={(e) => {
              setDocType(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
          >
            <option value="">{t.documents.allTypes}</option>
            <option value="Commercial Invoice">Commercial Invoice</option>
            <option value="Packing List">Packing List</option>
            <option value="Bill of Lading">Bill of Lading</option>
            <option value="Certificate of Origin">Certificate of Origin</option>
          </select>

          <button
            onClick={fetchDocuments}
            disabled={isLoading}
            aria-label="Refresh document list"
            className="p-2 rounded-xl border border-[#E5E5EA] bg-white hover:bg-[#F5F5F7] text-[#1D1D1F] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#0071E3]" : ""}`} />
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {loadError}
        </div>
      )}

      <div className="bg-white rounded-3xl border border-[#E5E5EA] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">
              <tr>
                <SortableHeaderButton
                  column="fileName"
                  label={t.documents.colName}
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                <SortableHeaderButton
                  column="docType"
                  label={t.documents.colType}
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                <SortableHeaderButton
                  column="shipmentNumber"
                  label={t.documents.colShipment}
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                <SortableHeaderButton
                  column="status"
                  label={t.documents.colStatus}
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                {/* Extraction is a field count plus a model score; only the score is a column. */}
                <SortableHeaderButton
                  column="confidence"
                  label="Extraction"
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                <SortableHeaderButton
                  column="createdAt"
                  label={t.documents.colDate}
                  sort={sort}
                  direction={direction}
                  onSort={applySort}
                />
                <th scope="col" className="py-3 px-3 xl:px-4 whitespace-nowrap">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#86868B]">
                    <FileText className="w-8 h-8 mx-auto text-[#86868B]/40 mb-2" />
                    <p className="font-semibold text-sm text-[#1D1D1F]">
                      {isLoading ? "Loading documents…" : "No documents match this view"}
                    </p>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[#F5F5F7]/50 transition-colors">
                    <td className="py-3.5 px-3 xl:px-4 font-semibold text-[#1D1D1F]">
                      <button
                        onClick={() => setPreviewDoc(doc)}
                        className="flex items-center space-x-2.5 hover:text-[#0071E3] transition-colors text-left group cursor-pointer max-w-full"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className="truncate max-w-[16rem] group-hover:underline">{doc.fileName}</span>
                        <Eye className="w-3.5 h-3.5 shrink-0 text-[#86868B] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </td>

                    <td className="py-3.5 px-3 xl:px-4 font-medium text-[#86868B]">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F] whitespace-nowrap">
                        {doc.docType === "AUTO_DETECT" ? "Type not detected" : doc.docType}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 xl:px-4 font-mono text-xs text-[#0071E3] whitespace-nowrap">
                      {doc.shipmentNumber ? (
                        <Link href={`/app/shipments/${doc.shipmentId}`} className="hover:underline">
                          {doc.shipmentNumber}
                        </Link>
                      ) : (
                        <span className="text-[#86868B]">{NOT_CALCULATED}</span>
                      )}
                    </td>

                    <td className="py-3.5 px-3 xl:px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${
                          STATUS_STYLE[doc.status] ?? "bg-[#F5F5F7] text-[#1D1D1F] border-[#E5E5EA]"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 xl:px-4 text-[#86868B] whitespace-nowrap">
                      {doc.extractedFieldCount > 0
                        ? `${doc.extractedFieldCount} fields \u00b7 model ${displayPercent(doc.confidence)}`
                        : "Not extracted"}
                    </td>

                    <td className="py-3.5 px-3 xl:px-4 text-[#86868B] whitespace-nowrap">{displayDate(doc.createdAt)}</td>

                    <td className="py-3.5 px-3 xl:px-4 whitespace-nowrap">
                      {doc.extractedFieldCount > 0 ? (
                        <Link
                          href={`/app/documents/${doc.id}/review`}
                          className="font-semibold text-[#0071E3] hover:underline"
                        >
                          Review fields
                        </Link>
                      ) : (
                        <span className="text-[#86868B]">No fields to review</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-3 xl:px-4 py-3 border-t border-[#E5E5EA] text-xs text-[#86868B]">
          <span>
            {total === 0 ? "No documents" : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              aria-label="Previous page"
              className="p-1.5 rounded-lg border border-[#E5E5EA] disabled:opacity-40 hover:bg-[#F5F5F7] cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              aria-label="Next page"
              className="p-1.5 rounded-lg border border-[#E5E5EA] disabled:opacity-40 hover:bg-[#F5F5F7] cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div
            ref={previewRef}
            role="dialog"
            aria-modal="true"
            aria-label={previewDoc.fileName}
            tabIndex={-1}
            className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-4xl w-full p-6 space-y-5 flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-extrabold text-[#1D1D1F] truncate">{previewDoc.fileName}</h2>
                  <p className="text-xs text-[#86868B]">
                    {previewDoc.shipmentNumber ? (
                      <span className="font-mono text-[#0071E3] font-semibold">{previewDoc.shipmentNumber}</span>
                    ) : (
                      NOT_CALCULATED
                    )}{" "}
                    · {displayDate(previewDoc.createdAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                aria-label="Close preview"
                className="p-2 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F5F5F7] p-3 rounded-2xl border border-[#E5E5EA] text-xs">
              <div className="min-w-0">
                <dt className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Document type</dt>
                <dd className="font-semibold text-[#1D1D1F] mt-0.5 truncate">{previewDoc.docType}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Status</dt>
                <dd className="font-semibold text-[#1D1D1F] mt-0.5 truncate">{previewDoc.status}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Pages</dt>
                <dd className="font-semibold text-[#1D1D1F] mt-0.5">{displayNumber(previewDoc.pageCount)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Model confidence</dt>
                <dd className="font-semibold text-[#1D1D1F] mt-0.5">{displayPercent(previewDoc.confidence)}</dd>
              </div>
            </dl>

            <div className="flex-1 overflow-y-auto min-h-[350px] bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] p-4 flex items-center justify-center">
              {isImageFile(previewDoc.fileName) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={documentViewUrl(previewDoc.id)}
                  alt={previewDoc.fileName}
                  className="max-h-[55vh] rounded-xl border border-[#E5E5EA] shadow-md object-contain"
                />
              ) : isPdfFile(previewDoc.fileName) ? (
                <iframe
                  src={documentViewUrl(previewDoc.id)}
                  className="w-full h-[55vh] rounded-xl border border-[#E5E5EA]"
                  title={previewDoc.fileName}
                />
              ) : (
                <div className="text-center p-8 space-y-3">
                  <FileCheck2 className="w-12 h-12 text-[#0071E3] mx-auto" />
                  <p className="text-xs text-[#86868B]">
                    This file type cannot be previewed in the browser.
                  </p>
                  <a
                    href={documentViewUrl(previewDoc.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#0071E3] text-white text-xs font-semibold hover:bg-[#0077ED] transition-colors"
                  >
                    <span>Open file in a new tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[#E5E5EA] pt-4">
              <span className="text-xs text-[#86868B] font-mono">{previewDoc.id}</span>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="px-4 py-2 rounded-xl border border-[#E5E5EA] hover:bg-[#F5F5F7] text-xs font-semibold text-[#1D1D1F] transition-colors cursor-pointer"
                >
                  Close
                </button>
                <a
                  href={documentViewUrl(previewDoc.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                >
                  <span>Open in new tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={fetchDocuments}
      />
    </div>
  );
}
