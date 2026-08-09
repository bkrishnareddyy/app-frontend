"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, History, RotateCcw } from "lucide-react";
import {
  nextReviewIndex,
  pagesWithFields,
  REVIEW_REQUIRED_BELOW,
  type ReviewField,
} from "@/modules/documents/extractionReview";
import { displayPercent, displayText, NOT_PROVIDED } from "@/lib/honest";

interface DocumentReviewWorkspaceProps {
  documentId: string;
  fileName: string;
  docType: string;
  pageCount: number | null;
  /** Null when no file has been stored, so the viewer says so instead of framing nothing. */
  proxyUrl: string | null;
  shipmentNumber: string | null;
  initialFields: ReviewField[];
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; fieldName: string }
  | { kind: "saved"; fieldName: string }
  | { kind: "error"; fieldName: string; message: string };

export function DocumentReviewWorkspace({
  documentId,
  fileName,
  docType,
  pageCount,
  proxyUrl,
  shipmentNumber,
  initialFields,
}: DocumentReviewWorkspaceProps) {
  const [fields, setFields] = useState<ReviewField[]>(initialFields);
  const [selectedIndex, setSelectedIndex] = useState(initialFields.length > 0 ? 0 : -1);
  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = selectedIndex >= 0 ? fields[selectedIndex] ?? null : null;
  const reviewPages = useMemo(() => pagesWithFields(fields), [fields]);
  const needingReview = useMemo(() => fields.filter((f) => f.needsReview).length, [fields]);

  const selectIndex = useCallback((index: number) => {
    setSelectedIndex(index);
    setDraft(null);
    setSaveState({ kind: "idle" });
  }, []);

  // Keyboard navigation across the field list. Arrow keys move one field;
  // "n" jumps to the next field that still needs review, and reports honestly
  // when there is none rather than moving the cursor anyway.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (fields.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (selectedIndex + delta + fields.length) % fields.length;
      selectIndex(next);
      return;
    }

    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      const next = nextReviewIndex(fields, selectedIndex);
      if (next === -1) {
        setSaveState({
          kind: "error",
          fieldName: "",
          message: "No fields are flagged for review.",
        });
        return;
      }
      selectIndex(next);
    }
  };

  // Keep the selected row in view when the keyboard moves the selection.
  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedIndex < 0) return;
    const item = list.children[selectedIndex];
    if (item instanceof HTMLElement) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const save = async () => {
    if (selected === null || draft === null) return;

    setSaveState({ kind: "saving", fieldName: selected.fieldName });

    try {
      const res = await fetch(`/api/documents/${documentId}/extractions/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: selected.fieldName, value: draft }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setSaveState({
          kind: "error",
          fieldName: selected.fieldName,
          message: body?.error?.message ?? `Save failed (HTTP ${res.status}).`,
        });
        return;
      }

      const updated: ReviewField = body.field;
      setFields((current) =>
        current.map((f) => (f.fieldName === updated.fieldName ? updated : f))
      );
      setDraft(null);
      setSaveState({ kind: "saved", fieldName: updated.fieldName });
    } catch {
      setSaveState({
        kind: "error",
        fieldName: selected.fieldName,
        message: "The correction could not be sent. Check your connection and try again.",
      });
    }
  };

  const draftValue = draft ?? selected?.currentValue ?? "";
  const isDirty = draft !== null && selected !== null && draft !== selected.currentValue;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left: the document itself */}
      <section
        aria-labelledby="review-source-heading"
        className="bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs overflow-hidden"
      >
        <div className="p-4 border-b border-[#E5E5EA] space-y-1">
          <h2
            id="review-source-heading"
            className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-[#0071E3]" aria-hidden="true" />
            <span className="truncate">{displayText(fileName)}</span>
          </h2>
          <p className="text-sm text-[#6E6E73]">
            {docType === "AUTO_DETECT" ? "Type not detected" : displayText(docType)}
            {" \u00b7 "}
            {pageCount === null ? "Page count not recorded" : `${pageCount} pages`}
            {shipmentNumber !== null && ` \u00b7 ${shipmentNumber}`}
          </p>
          {selected !== null && (
            <p className="text-sm text-[#6E6E73]" aria-live="polite">
              {selected.pageNumber === null
                ? `No page recorded for ${selected.fieldName}`
                : `${selected.fieldName} was read on page ${selected.pageNumber}`}
              {selected.bbox === null
                ? ", location not recorded"
                : `, at ${Math.round(selected.bbox.x)}, ${Math.round(selected.bbox.y)}`}
            </p>
          )}
        </div>

        {proxyUrl === null ? (
          <p className="p-8 text-center text-sm text-[#6E6E73]">
            No file is stored for this document, so there is nothing to display.
          </p>
        ) : (
          <div className="relative">
            <iframe
              // The proxy resolves the storage location from the tenant's own record.
              src={
                selected?.pageNumber === null || selected === null
                  ? proxyUrl
                  : `${proxyUrl}#page=${selected.pageNumber}`
              }
              title={`Source document ${fileName}`}
              className="w-full h-[70vh] bg-[#F5F5F7]"
            />
            {selected?.bbox !== null && selected !== undefined && selected !== null && (
              // The stored box is in the extractor's coordinate space, which the
              // embedded viewer does not expose. Rather than draw a rectangle in
              // the wrong place, the coordinates are reported as text above.
              <p className="px-4 py-2 text-sm text-[#6E6E73] border-t border-[#E5E5EA]">
                Stored region: {Math.round(selected.bbox.width)} ×{" "}
                {Math.round(selected.bbox.height)} at ({Math.round(selected.bbox.x)},{" "}
                {Math.round(selected.bbox.y)}) on page{" "}
                {selected.pageNumber ?? "not recorded"}.
              </p>
            )}
          </div>
        )}

        {reviewPages.length > 0 && (
          <nav
            aria-label="Pages carrying extracted fields"
            className="flex flex-wrap items-center gap-2 p-4 border-t border-[#E5E5EA]"
          >
            <span className="text-sm text-[#6E6E73]">Pages with extracted fields:</span>
            {reviewPages.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => {
                  const index = fields.findIndex((f) => f.pageNumber === page);
                  if (index >= 0) selectIndex(index);
                }}
                className={`px-2.5 py-1 rounded-lg border text-sm font-semibold ${
                  selected?.pageNumber === page
                    ? "bg-[#0071E3] text-white border-[#0071E3]"
                    : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:bg-[#F5F5F7]"
                }`}
                aria-current={selected?.pageNumber === page ? "true" : undefined}
              >
                {page}
              </button>
            ))}
          </nav>
        )}
      </section>

      {/* Right: the extracted fields */}
      <section
        aria-labelledby="review-fields-heading"
        className="bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs"
      >
        <div className="p-4 border-b border-[#E5E5EA] space-y-1">
          <h2 id="review-fields-heading" className="text-sm font-bold text-[#1D1D1F]">
            Extracted fields ({fields.length})
          </h2>
          <p className="text-sm text-[#6E6E73]">
            {fields.length === 0
              ? "No fields have been extracted from this document yet."
              : `${needingReview} flagged for review \u00b7 model confidence below ${REVIEW_REQUIRED_BELOW}% or not scored`}
          </p>
          <p className="text-sm text-[#6E6E73]">
            Use the arrow keys to move between fields and “n” to jump to the next flagged
            field.
          </p>
        </div>

        {fields.length === 0 ? (
          <p className="p-8 text-center text-sm text-[#6E6E73]">
            Fields appear here once the document has been processed.
          </p>
        ) : (
          <ul
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-label="Extracted fields"
            aria-activedescendant={selected ? `field-${selected.fieldName}` : undefined}
            onKeyDown={onListKeyDown}
            className="max-h-[70vh] overflow-y-auto divide-y divide-[#E5E5EA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
          >
            {fields.map((field, index) => {
              const isSelected = index === selectedIndex;
              return (
                <li
                  key={field.fieldName}
                  id={`field-${field.fieldName}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectIndex(index)}
                  className={`p-4 cursor-pointer space-y-2 ${
                    isSelected ? "bg-blue-50/70" : "hover:bg-[#F5F5F7]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[#1D1D1F]">{field.fieldName}</span>
                    <span className="flex items-center gap-2 text-sm">
                      {field.corrected && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold">
                          <Check className="w-3 h-3" aria-hidden="true" />
                          Corrected
                        </span>
                      )}
                      {field.needsReview && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-900 font-semibold">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                          Review
                        </span>
                      )}
                      <span
                        className={
                          field.confidence === null
                            ? "text-[#86868B] font-semibold"
                            : field.confidence < REVIEW_REQUIRED_BELOW
                            ? "text-amber-700 font-semibold"
                            : "text-emerald-700 font-semibold"
                        }
                        title="Model confidence, not legal certainty"
                      >
                        {field.confidence === null
                          ? "Not scored"
                          : `Model ${displayPercent(field.confidence)}`}
                      </span>
                    </span>
                  </div>

                  <p className="text-sm text-[#1D1D1F] break-words">
                    {displayText(field.currentValue)}
                  </p>

                  <p className="text-sm text-[#6E6E73]">
                    {field.pageNumber === null
                      ? "Page not recorded"
                      : `Page ${field.pageNumber}`}
                    {" \u00b7 "}
                    {field.bbox === null ? "Location not recorded" : "Location recorded"}
                  </p>

                  {field.corrected && (
                    <p className="text-sm text-[#6E6E73]">
                      Extractor read: {displayText(field.originalValue, NOT_PROVIDED)}
                    </p>
                  )}

                  {isSelected && (
                    <div
                      className="space-y-2 pt-2 border-t border-[#E5E5EA]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label
                        htmlFor={`correct-${field.fieldName}`}
                        className="block text-sm font-semibold text-[#1D1D1F]"
                      >
                        Corrected value
                      </label>
                      <textarea
                        id={`correct-${field.fieldName}`}
                        value={draftValue}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm text-[#1D1D1F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={save}
                          disabled={!isDirty || saveState.kind === "saving"}
                          className="px-4 py-1.5 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] disabled:bg-[#C7C7CC] text-white text-sm font-semibold"
                        >
                          {saveState.kind === "saving" &&
                          saveState.fieldName === field.fieldName
                            ? "Saving\u2026"
                            : "Save correction"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(null);
                            setSaveState({ kind: "idle" });
                          }}
                          disabled={!isDirty}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-sm font-semibold text-[#1D1D1F] disabled:text-[#C7C7CC]"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryOpenFor((current) =>
                              current === field.fieldName ? null : field.fieldName
                            )
                          }
                          aria-expanded={historyOpenFor === field.fieldName}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-sm font-semibold text-[#1D1D1F]"
                        >
                          <History className="w-3.5 h-3.5" aria-hidden="true" />
                          History ({field.history.length})
                        </button>
                      </div>

                      <p className="text-sm" aria-live="polite">
                        {saveState.kind === "saved" &&
                          saveState.fieldName === field.fieldName && (
                            <span className="text-emerald-700 font-semibold">
                              Correction saved. The extractor&apos;s reading is retained.
                            </span>
                          )}
                        {saveState.kind === "error" &&
                          saveState.fieldName === field.fieldName && (
                            <span className="text-red-700 font-semibold">
                              {saveState.message}
                            </span>
                          )}
                        {saveState.kind === "error" && saveState.fieldName === "" && (
                          <span className="text-[#6E6E73]">{saveState.message}</span>
                        )}
                      </p>

                      {historyOpenFor === field.fieldName && (
                        <ol className="space-y-1 pt-1">
                          {field.history.map((rev) => (
                            <li key={rev.id} className="text-sm text-[#6E6E73]">
                              <span className="font-semibold text-[#1D1D1F]">{rev.value}</span>
                              {" \u2014 "}
                              {rev.isCorrection ? "reviewer correction" : rev.source}
                              {" \u00b7 "}
                              {rev.confidence === null
                                ? "not scored"
                                : `model ${rev.confidence}%`}
                              {" \u00b7 "}
                              <time dateTime={rev.createdAt}>
                                {new Date(rev.createdAt).toLocaleString()}
                              </time>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="p-4 border-t border-[#E5E5EA] text-sm text-[#6E6E73]">
          Approve, reject, and mark-unreadable are not available yet: the extraction record
          has no review-status column, so this screen does not offer buttons that would not
          persist anything.
        </p>
      </section>
    </div>
  );
}
