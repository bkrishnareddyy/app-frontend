"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { DocumentReviewPanel } from "@/components/DocumentReviewPanel";
import { LineItemsTable } from "./LineItemsTable";
import { documentViewUrl } from "@/lib/documentUrl";
import { numberOrNull } from "./workspaceTypes";
import type { ExtractedLineItem, ShipmentLineItemRow } from "./workspaceTypes";

interface WorkspaceDocument {
  id: string;
  docType: string;
  fileName: string;
  pageCount: number | null;
  confidence: number | null;
  status: string;
  fileUrl?: string | null;
  extractedJson?: string | null;
  createdAt: Date | string;
}

interface DocumentWorkspacePanelProps {
  shipmentId: string;
  shipmentNumber: string;
  documents: WorkspaceDocument[];
  originStatus: string;
  displayLineItems: ShipmentLineItemRow[];
  // Map entries, not a Map: a Map can't cross the server/client boundary.
  rawHtsConfidenceByLine: [number, { description: string; htsConfidence: number | null }][];
  lineItemCurrency: string | null;
  initialDocId?: string;
}

function pickDefaultDocId(documents: WorkspaceDocument[]): string | undefined {
  return (
    documents.find((d) => d.status === "Received") ||
    documents.find((d) => d.status === "Processed") ||
    documents.find((d) => d.status === "Review Required") ||
    documents[0]
  )?.id;
}

/**
 * Documents list + embedded viewer for a shipment's Operational Workspace tab.
 *
 * Document selection is local React state, not a `?docId=` URL param -- the
 * page above this is a large Server Component, and driving selection through
 * the URL made every click re-fetch and re-render the entire page (readiness
 * ribbon, exceptions, everything) just to swap which file is shown here.
 */
export function DocumentWorkspacePanel({
  shipmentId,
  shipmentNumber,
  documents,
  originStatus,
  displayLineItems,
  rawHtsConfidenceByLine,
  lineItemCurrency,
  initialDocId,
}: DocumentWorkspacePanelProps) {
  const [activeDocId, setActiveDocId] = useState<string | undefined>(
    () => initialDocId ?? pickDefaultDocId(documents)
  );

  const primaryDoc = documents.find((d) => d.id === activeDocId) || documents[0];

  const rawHtsConfidenceMap = useMemo(
    () => new Map(rawHtsConfidenceByLine),
    [rawHtsConfidenceByLine]
  );

  const selectDoc = (docId: string) => {
    setActiveDocId(docId);
    // Keeps the URL shareable/deep-linkable without going through the
    // router -- a router navigation here is exactly the full-page
    // re-render this component exists to avoid.
    const url = new URL(window.location.href);
    url.searchParams.set("docId", docId);
    window.history.replaceState(null, "", url);
  };

  const viewerData = useMemo(() => {
    if (!primaryDoc) return null;

    const proxyUrl = primaryDoc.fileUrl?.includes("vercel-storage.com")
      ? documentViewUrl(primaryDoc.id)
      : primaryDoc.fileUrl || "#";

    let docLineItems: ShipmentLineItemRow[] = [];
    // Set only when this document's extraction actually produced HTS-bearing
    // line items (a Bill of Lading or Packing List won't) -- null
    // averageConfidence means those lines exist but haven't been matched to
    // a classified persisted line yet.
    let docHtsScore: { averageConfidence: number | null; classifiedCount: number; totalCount: number } | null = null;

    if (primaryDoc.extractedJson) {
      try {
        const parsed = JSON.parse(primaryDoc.extractedJson);
        if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
          const extracted = parsed.lineItems as ExtractedLineItem[];

          // A document's stored extraction is often thinner than the
          // curated record built from it -- this invoice's JSON kept a
          // total for 57 of its 68 lines and a unit price for none, while
          // all 68 persisted rows carry both. Where a persisted row is
          // unambiguously the same line, its price is this document's
          // price and gets shown rather than a dash.
          const persistedByLine = new Map(displayLineItems.map((row) => [row.lineNumber, row] as const));
          const sameLine = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

          docLineItems = extracted.map((li, idx: number) => {
            const lineNumber = li.lineNumber || idx + 1;
            const description = li.description || "Product";

            // Matched on description as well as line number, so a shipment
            // carrying several invoices can never borrow a price from a
            // different document's line 1.
            const persisted = persistedByLine.get(lineNumber);
            const counterpart = persisted && sameLine(persisted.description, description) ? persisted : null;

            return {
              id: `extracted-${primaryDoc.id}-${idx}`,
              lineNumber,
              partNumber: li.sku || li.partNumber || "",
              description,
              quantity: Number(li.quantity || 0),
              // Null, never 0, when neither source has a price: "0" would
              // state the line was free of charge.
              unitPrice: numberOrNull(li.unitPrice) ?? counterpart?.unitPrice ?? null,
              totalValue:
                numberOrNull(li.totalAmount) ?? numberOrNull(li.totalValue) ?? counterpart?.totalValue ?? null,
              countryOfOrigin: li.countryOfOrigin || "",
              htsCode: li.htsCode || (li.sku && /^\d{4}/.test(li.sku) ? li.sku : ""),
              htsConfidence: 95,
            };
          });

          const classifiableLines = docLineItems.filter((li) => li.htsCode);
          if (classifiableLines.length > 0) {
            const realConfidences = classifiableLines
              .map((li) => {
                const raw = rawHtsConfidenceMap.get(li.lineNumber);
                return raw && sameLine(raw.description, li.description) ? raw.htsConfidence : null;
              })
              .filter((c): c is number => typeof c === "number");

            docHtsScore = {
              averageConfidence:
                realConfidences.length > 0
                  ? Math.round(realConfidences.reduce((a, b) => a + b, 0) / realConfidences.length)
                  : null,
              classifiedCount: realConfidences.length,
              totalCount: classifiableLines.length,
            };
          }
        }
      } catch {}
    }

    // Flag when a document's extracted products have nothing to do with the
    // shipment's own verified line items -- usually means the wrong file
    // got attached to this shipment, not that extraction is broken.
    const docHtsChapters = new Set(
      docLineItems.map((li) => (li.htsCode || "").replace(/\D/g, "").slice(0, 2)).filter(Boolean)
    );
    const shipmentHtsChapters = new Set(
      displayLineItems.map((li) => (li.htsCode || "").replace(/\D/g, "").slice(0, 2)).filter(Boolean)
    );
    const showMismatchWarning =
      docLineItems.length > 0 &&
      displayLineItems.length > 0 &&
      docHtsChapters.size > 0 &&
      shipmentHtsChapters.size > 0 &&
      ![...docHtsChapters].some((ch) => shipmentHtsChapters.has(ch));

    return { proxyUrl, docLineItems, docHtsScore, showMismatchWarning };
  }, [primaryDoc, displayLineItems, rawHtsConfidenceMap]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Documents Set Summary */}
      <div className="lg:col-span-4">
        <ShipmentDocumentsSection
          shipmentId={shipmentId}
          documents={documents}
          activeDocId={activeDocId}
          onSelectDoc={selectDoc}
          originStatus={originStatus}
        />
      </div>

      {/* Center Column: Embedded Document Viewer */}
      <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-border shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden min-h-[480px]">
        {primaryDoc && viewerData ? (
          <div className="flex flex-col justify-between h-full space-y-4">
            <div>
              {/* Document type, name, and tabbed preview / key-value / raw JSON */}
              <div className="h-[620px] flex flex-col border-b border-border pb-4 overflow-hidden">
                <DocumentReviewPanel
                  documentId={primaryDoc.id}
                  fileName={primaryDoc.fileName || "Trade Document"}
                  docType={!primaryDoc.docType || primaryDoc.docType === "AUTO_DETECT" ? "Commercial Invoice" : primaryDoc.docType}
                  fileUrl={primaryDoc.fileUrl}
                  proxyUrl={viewerData.proxyUrl}
                  shipmentNumber={shipmentNumber}
                  htsScore={viewerData.docHtsScore ?? undefined}
                />
              </div>

              {/* Document Metadata Details */}
              <div className="mt-4 p-4 rounded-xl bg-[#F9F9FB] border border-border space-y-3">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-border">
                  <span className="text-ink-muted">Document Status</span>
                  {primaryDoc.extractedJson ? (
                    <span className="font-bold text-emerald-600">Verified & Ingested (AI Vision Parsed)</span>
                  ) : (
                    <span className="font-bold text-amber-600 font-mono">Received (Pending Vision Processing)</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-ink-muted uppercase font-bold">Page Count</p>
                    <p className="font-mono text-ink">{primaryDoc.pageCount ? `${primaryDoc.pageCount} Pages` : "1 Page"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-muted uppercase font-bold">Uploaded Date</p>
                    <p className="text-ink">{new Date(primaryDoc.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {viewerData.showMismatchWarning && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start space-x-2 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">This document doesn&apos;t match the shipment&apos;s line items</p>
                    <p className="text-[11px] mt-0.5">
                      The products extracted here don&apos;t correspond to the shipment&apos;s verified cargo
                      {displayLineItems[0]?.description ? ` (${displayLineItems[0].description})` : ""}. It may be attached to the wrong shipment.
                    </p>
                  </div>
                </div>
              )}

              {/* Extracted Line Items for this Document */}
              <div id="extracted-line-items-section">
                <LineItemsTable shipmentId={shipmentId} initialLineItems={viewerData.docLineItems} currency={lineItemCurrency} />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-ink-muted pt-3 border-t border-border">
              <span>Vault Document ID: {primaryDoc.id.slice(0, 16)}...</span>
              <span>Qubere Document Vault</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12 text-xs">
            <FileText className="w-10 h-10 text-ink-muted opacity-50" />
            <div className="space-y-1">
              <h4 className="font-extrabold text-ink">No Trade Documents Attached</h4>
              <p className="text-ink-muted text-[11px]">Upload a Commercial Invoice, Bill of Lading, or Packing List to run vision extraction.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
