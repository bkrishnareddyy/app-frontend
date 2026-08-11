"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Info, FileText, CheckCircle2, ChevronRight } from "lucide-react";
import { ExceptionResolutionModal } from "./ExceptionResolutionModal";
import { DocumentFieldReviewModal, DocumentFieldSummary } from "./DocumentFieldReviewModal";
import {
  isResolvableException,
  type DbExceptionItem,
  type ExceptionCard,
  type ResolvableException,
  type ShipmentLineItemRow,
} from "./workspaceTypes";

interface ExceptionsDrawerProps {
  shipmentId: string;
  exceptionItems: DbExceptionItem[];
  lineItems: ShipmentLineItemRow[];
  // Required document types not yet uploaded, computed by the page from the
  // live document list -- surfaced here as real action cards instead of
  // living only in a separate, disconnected "Document Set Summary" box.
  missingDocumentTypes?: string[];
  // What fields we expect from each processed document, and whether each
  // one was found/confirmed -- computed server-side in page.tsx from real
  // extraction + FieldApproval data. Drives the "Document Field Review"
  // cards below, so exceptions that all trace back to one document read as
  // one review task instead of a flat, ungrouped list.
  documentFieldSummaries?: DocumentFieldSummary[];
}

export function ExceptionsDrawer({
  shipmentId,
  exceptionItems,
  lineItems,
  missingDocumentTypes = [],
  documentFieldSummaries = [],
}: ExceptionsDrawerProps) {
  const [activeTab, setActiveTab] = useState<"ALL" | "MISSING" | "CONFLICTS" | "VALIDATION" | "WARNINGS">("ALL");
  const [selectedException, setSelectedException] = useState<ResolvableException | null>(null);
  const [reviewingDoc, setReviewingDoc] = useState<DocumentFieldSummary | null>(null);

  // Filter out exceptions that have been resolved
  const openExceptions = exceptionItems.filter(
    (ex) => ex.status !== "RESOLVED" && ex.status !== "Resolved"
  );

  // Map database exception items to UI objects
  const exceptions: ExceptionCard[] = openExceptions.map((dbEx) => {
    const descLower = dbEx.description.toLowerCase();
    const isHts = descLower.includes("hts");
    const isCo = descLower.includes("certificate of origin");
    const isCoo = descLower.includes("country of origin");
    const isQty = descLower.includes("quantity") || descLower.includes("pcs") || descLower.includes("mismatch");
    const isPoa = descLower.includes("poa") || descLower.includes("power of attorney");
    const isInvoiceMissing = descLower.includes("commercial invoice missing");
    const isPackingMissing = descLower.includes("packing list missing");

    let category = "VALIDATION";
    let title = dbEx.description.split(":")[0]?.trim() || "Compliance Exception";
    let desc = dbEx.description.split(":").slice(1).join(":")?.trim() || dbEx.description;
    let icon = <AlertCircle className="w-4 h-4 text-red-500" />;
    let actionText = "Resolve Exception →";
    let actionType = "DEFAULT";

    if (isInvoiceMissing) {
      category = "MISSING";
      title = "Commercial Invoice Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Invoice →";
      actionType = "UPLOAD";
    } else if (isPackingMissing) {
      category = "MISSING";
      title = "Packing List Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Packing List →";
      actionType = "UPLOAD";
    } else if (isHts) {
      category = "VALIDATION";
      title = "HTS Classification Review";
      icon = <AlertCircle className="w-4 h-4 text-red-500" />;
      actionText = "Review Classification →";
      actionType = "HTS";
    } else if (isCo) {
      category = "MISSING";
      title = "Certificate of Origin Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Document →";
      actionType = "UPLOAD";
    } else if (isCoo) {
      category = "MISSING";
      title = "Country of Origin Missing";
      icon = <Info className="w-4 h-4 text-blue-500" />;
      actionText = "Provide Origin →";
      actionType = "COO";
    } else if (isQty) {
      category = "CONFLICTS";
      title = "Quantity Mismatch";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Review Mismatch →";
      actionType = "MISMATCH";
    } else if (isPoa) {
      category = "CONFLICTS";
      title = "Importer POA Expired";
      icon = <AlertCircle className="w-4 h-4 text-red-500" />;
      actionText = "Renew POA Consent →";
      actionType = "POA";
    }

    // Compliance Audit's findings (embargo/UFLPA/ADD-CVD/PGA/missing HTS or
    // origin) are grounded in the real DB `category` column, not description
    // keywords -- their wording can coincidentally match one of the phrases
    // above (e.g. "missing an HTS classification" matching isHts) and land in
    // the wrong tab/action with a special mutation meant for a different
    // exception type. Override using the real column for this source only, so
    // the three original checks above are untouched.
    if (dbEx.sourceAgent === "Compliance Agent") {
      const complianceCategory: Record<string, string> = {
        COMPLIANCE: "WARNINGS",
        MISSING_DATA: "MISSING",
      };
      category = (dbEx.category && complianceCategory[dbEx.category]) || "WARNINGS";
      actionType = "DEFAULT";
      actionText = "Resolve Exception →";
      icon =
        dbEx.severity === "Critical" ? (
          <AlertCircle className="w-4 h-4 text-red-500" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        );
      title = dbEx.category === "MISSING_DATA" ? "Missing Compliance Data" : "Sanctions / Compliance Finding";
      desc = dbEx.description;
    }

    return {
      id: dbEx.id,
      dbId: dbEx.id,
      version: dbEx.version,
      category,
      title,
      desc,
      icon,
      actionText,
      actionType,
    };
  });

  // Missing required documents the page detected directly from the live
  // document list -- skip any type already represented by a real DB
  // exception above so the same gap isn't shown twice.
  const missingDocExceptions: ExceptionCard[] = missingDocumentTypes
    .filter((type) => !exceptions.some((ex) => ex.title.toLowerCase().includes(type.toLowerCase())))
    .map((type) => ({
      id: `missing-doc-${type}`,
      category: "MISSING",
      title: `${type} Missing`,
      desc: `Required for customs entry filing. Upload the ${type} to clear this requirement.`,
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      actionText: `Add ${type} →`,
      actionType: "UPLOAD_DIRECT",
    }));

  const allExceptions = [...exceptions, ...missingDocExceptions];

  const filtered = allExceptions.filter((ex) => {
    if (activeTab === "ALL") return true;
    return ex.category === activeTab;
  });

  const validationCount = allExceptions.filter((e) => e.category === "VALIDATION").length;
  const missingCount = allExceptions.filter((e) => e.category === "MISSING").length;
  const conflictsCount = allExceptions.filter((e) => e.category === "CONFLICTS").length;
  const warningsCount = allExceptions.filter((e) => e.category === "WARNINGS").length;
  const totalCount = allExceptions.length;

  return (
    <>
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 text-xs">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setActiveTab("ALL")}
              className={`pb-3 -mb-3 font-bold transition-all cursor-pointer ${
                activeTab === "ALL" ? "text-[#0071E3] border-b-2 border-[#0071E3]" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Exceptions ({totalCount})
            </button>
            <button
              onClick={() => setActiveTab("MISSING")}
              className={`pb-3 -mb-3 font-bold transition-all cursor-pointer ${
                activeTab === "MISSING" ? "text-[#0071E3] border-b-2 border-[#0071E3]" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Missing Data ({missingCount})
            </button>
            <button
              onClick={() => setActiveTab("CONFLICTS")}
              className={`pb-3 -mb-3 font-bold transition-all cursor-pointer ${
                activeTab === "CONFLICTS" ? "text-[#0071E3] border-b-2 border-[#0071E3]" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Conflicts ({conflictsCount})
            </button>
            <button
              onClick={() => setActiveTab("VALIDATION")}
              className={`pb-3 -mb-3 font-bold transition-all cursor-pointer ${
                activeTab === "VALIDATION" ? "text-[#0071E3] border-b-2 border-[#0071E3]" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Validation ({validationCount})
            </button>
            <button
              onClick={() => setActiveTab("WARNINGS")}
              className={`pb-3 -mb-3 font-bold transition-all cursor-pointer ${
                activeTab === "WARNINGS" ? "text-[#0071E3] border-b-2 border-[#0071E3]" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Warnings ({warningsCount})
            </button>
          </div>
          <Link
            href={`/app/decisions?shipmentId=${shipmentId}`}
            className="text-xs font-semibold text-[#0071E3] hover:underline"
          >
            View All Exceptions
          </Link>
        </div>

        {documentFieldSummaries.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#86868B]">Document Field Review</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {documentFieldSummaries.map((doc) => {
                const allConfirmed = doc.confirmedCount === doc.totalCount;
                return (
                  <button
                    key={doc.documentId}
                    onClick={() => setReviewingDoc(doc)}
                    className="text-left p-4 rounded-xl border border-[#E5E5EA] bg-[#F9F9FB] hover:border-[#0071E3] transition-all duration-200 flex items-center justify-between space-x-3 cursor-pointer"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                          allConfirmed ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-amber-50 border-amber-200 text-amber-600"
                        }`}
                      >
                        {allConfirmed ? <CheckCircle2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#1D1D1F] truncate">{doc.fileName}</p>
                        <p className="text-[10px] text-[#86868B]">
                          {doc.confirmedCount} of {doc.totalCount} fields confirmed
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#86868B] shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((ex) => (
            <div key={ex.id} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2 hover:border-[#0071E3] transition-all duration-200">
              <div className="flex items-start space-x-2 text-xs font-bold text-[#1D1D1F]">
                <span className="shrink-0">{ex.icon}</span>
                <span className="min-w-0 break-words">{ex.title}</span>
              </div>
              <p className="text-[11px] text-[#86868B] leading-relaxed">{ex.desc}</p>
              {ex.actionType === "UPLOAD_DIRECT" ? (
                <button
                  onClick={() => window.dispatchEvent(new Event("qubere:open-upload-modal"))}
                  className="text-xs font-semibold text-[#0071E3] hover:underline text-left pt-1 block w-full cursor-pointer"
                >
                  {ex.actionText}
                </button>
              ) : ex.actionType ? (
                <button
                  // Only a card backed by a real ExceptionItem row can be
                  // resolved -- the modal writes back to /api/exceptions/{dbId}
                  // with an expected version. Synthetic cards take the
                  // UPLOAD_DIRECT branch above, so this guard does not currently
                  // exclude anything reachable; it stops a future synthetic card
                  // from producing a request against `undefined`.
                  onClick={() => {
                    if (isResolvableException(ex)) setSelectedException(ex);
                  }}
                  className="text-xs font-semibold text-[#0071E3] hover:underline text-left pt-1 block w-full cursor-pointer"
                >
                  {ex.actionText}
                </button>
              ) : (
                <Link
                  href={ex.actionHref || "#"}
                  className="inline-block text-xs font-semibold text-[#0071E3] hover:underline pt-1"
                >
                  {ex.actionText}
                </Link>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-8 text-center text-[#86868B] text-xs">
              No exceptions found under this category.
            </div>
          )}
        </div>
      </div>

      <ExceptionResolutionModal
        isOpen={!!selectedException}
        onClose={() => setSelectedException(null)}
        exception={selectedException}
        shipmentId={shipmentId}
        lineItems={lineItems}
      />

      <DocumentFieldReviewModal
        isOpen={!!reviewingDoc}
        onClose={() => setReviewingDoc(null)}
        shipmentId={shipmentId}
        summary={reviewingDoc}
      />
    </>
  );
}
