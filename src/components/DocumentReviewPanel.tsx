"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Code, FileText, ExternalLink, Edit2, RotateCcw, MessageSquare, Sparkles } from "lucide-react";
import { decisionGroupLabel, reviewerLabel, editableFieldsFor, reviewCategory } from "@/modules/decisions/editableFields";

const NEUTRAL_BADGE = "text-[10px] font-bold px-2 py-1 rounded-lg bg-surface-muted border border-border text-ink-muted";

interface DecisionListItem {
  id: string;
  agentName?: string | null;
  proposedHtsCode?: string | null;
  currentHtsCode?: string | null;
  createdAt: string | Date;
}

/**
 * AgentDecision has no documentId/runId FK, so a re-run (reattach, manual
 * re-evaluate, reconciliation) leaves the old row sitting next to the new
 * one instead of replacing it -- collapse to one card per agent, keeping
 * whichever is most recent, so a stale decision never outlives its re-run.
 */
function latestPerAgent<T extends DecisionListItem>(decs: T[]): T[] {
  const byLabel = new Map<string, T>();
  for (const dec of decs) {
    const key = decisionGroupLabel(dec);
    const existing = byLabel.get(key);
    if (!existing || new Date(dec.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      byLabel.set(key, dec);
    }
  }
  return Array.from(byLabel.values());
}

function severityBadgeClass(severity: string): string {
  if (severity === "CRITICAL") return "text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 bg-red-100 text-red-900 border-red-300";
  if (severity === "HIGH") return "text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 bg-amber-100 text-amber-900 border-amber-300";
  return "text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 bg-surface-muted text-ink-muted border-border";
}

// The real gating sentinels agents write to proposedDescription when they
// refused to run because a prerequisite was missing -- distinct from an
// ordinary "Needs Review" judgment call, so this is a grounded signal for
// "blocked," not a guess.
const BLOCKED_SENTINELS = new Set(["BLOCKED_DEPENDENCY", "WAITING_FOR_EXTRACTION", "BLOCKED_MISSING_DESCRIPTION"]);

interface RollupDecision {
  status: string;
  proposedDescription?: string | null;
}

function RollupSummary({ decisions }: { decisions: RollupDecision[] }) {
  const total = decisions.length;
  if (total === 0) return null;

  const blocked = decisions.filter((d) => d.proposedDescription && BLOCKED_SENTINELS.has(d.proposedDescription)).length;
  const verified = decisions.filter((d) => d.status === "Approved").length;
  const review = total - verified - blocked;

  let summary: string | null = null;
  if (blocked > 0 && review > 0) {
    summary = `${blocked + review} issue${blocked + review === 1 ? "" : "s"} need attention before filing — ${blocked} blocked on missing data, ${review} flagged for review.`;
  } else if (blocked > 0) {
    summary = `${blocked} issue${blocked === 1 ? "" : "s"} blocked on missing data.`;
  } else if (review > 0) {
    summary = `${review} issue${review === 1 ? "" : "s"} flagged for review.`;
  }

  return (
    <div className="rounded-2xl bg-surface-muted border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-brand" />
        <span className="font-extrabold text-ink text-[13px]">AI review</span>
        <span className="ml-auto text-[11px] font-semibold text-ink-muted">{verified} of {total} checks passed</span>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-2">
          <p className="text-base font-extrabold text-emerald-900">{verified}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-emerald-700">Verified</p>
        </div>
        <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2">
          <p className="text-base font-extrabold text-amber-900">{review}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-amber-700">Review</p>
        </div>
        <div className="flex-1 rounded-xl bg-red-50 border border-red-200 px-2.5 py-2">
          <p className="text-base font-extrabold text-red-900">{blocked}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-red-700">Blocked</p>
        </div>
      </div>
      {summary && <p className="text-[11px] text-ink-muted leading-relaxed">{summary}</p>}
    </div>
  );
}

interface NarrativeRow {
  label: string;
  value: string | null;
}

interface NarrativeDecision {
  agentName?: string | null;
  proposedHtsCode?: string | null;
  currentHtsCode?: string | null;
  status: string;
  decisionSummary?: string | null;
  evidenceItems?: unknown;
}

interface ProductProfile {
  sku?: string | null;
  materialComposition?: string | null;
  essentialCharacter?: string | null;
  endUse?: string | null;
}

interface OriginQualification {
  countryOfOrigin?: string | null;
  ftaProgram?: string | null;
}

interface ComplianceFlag {
  severity: string;
  summary: string;
}

interface ValuationAdjustment {
  type: string;
  amount: number;
}

function SpecRows({ rows }: { rows: NarrativeRow[] }) {
  return (
    <div className="space-y-1">
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 text-[11px]">
            <span className="text-ink-muted shrink-0">{r.label}</span>
            <span className="text-ink font-semibold text-right">{r.value}</span>
          </div>
        ))}
    </div>
  );
}

/**
 * The Field Review card body for a NARRATIVE-category decision. Each agent
 * type gets a layout that surfaces its actual value (a dollar figure, a
 * country, a material spec) instead of a flat prose sentence -- falls back
 * to decisionSummary when a decision predates evidenceItems carrying this
 * structured data, or the shape doesn't match what's expected.
 */
function renderNarrativeBody(dec: NarrativeDecision, opts: { onViewKeyValues: () => void; kvCount: number }): React.ReactNode {
  const groupLabel = decisionGroupLabel(dec);
  const ev = (dec.evidenceItems && typeof dec.evidenceItems === "object" ? dec.evidenceItems : {}) as Record<string, unknown>;
  const fallback = <p className="text-[11px] text-ink-muted leading-relaxed">{dec.decisionSummary || "No summary available."}</p>;

  if (groupLabel === "Document Intelligence") {
    const primaryAgency = typeof ev.primaryAgency === "string" ? ev.primaryAgency : null;
    const hasCommercialInvoice = Boolean(ev.hasCommercialInvoice);
    const lineItemCount = typeof ev.lineItemCount === "number" ? ev.lineItemCount : null;
    const count = typeof ev.rawKeyValueCount === "number" ? ev.rawKeyValueCount : opts.kvCount;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {primaryAgency && <span className={NEUTRAL_BADGE}>{primaryAgency}</span>}
          <span className={NEUTRAL_BADGE}>{hasCommercialInvoice ? "Commercial invoice present" : "Commercial invoice missing"}</span>
          {lineItemCount !== null && (
            <span className={NEUTRAL_BADGE}>{lineItemCount} line item{lineItemCount === 1 ? "" : "s"}</span>
          )}
        </div>
        <button
          onClick={opts.onViewKeyValues}
          className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
        >
          View {count} extracted field{count === 1 ? "" : "s"} →
        </button>
      </div>
    );
  }

  if (groupLabel === "Product Intelligence") {
    const profiles = Array.isArray(ev.profiles) ? (ev.profiles as ProductProfile[]) : [];
    if (profiles.length === 0) return fallback;
    return (
      <div className="space-y-3">
        {profiles.map((p, i) => (
          <div key={i} className="space-y-1">
            {profiles.length > 1 && (
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{p.sku || `Line ${i + 1}`}</p>
            )}
            <SpecRows
              rows={[
                { label: "Material", value: p.materialComposition ?? null },
                { label: "Essential character", value: p.essentialCharacter ?? null },
                { label: "End use", value: p.endUse ?? null },
              ]}
            />
          </div>
        ))}
      </div>
    );
  }

  if (groupLabel === "Origin") {
    const quals = Array.isArray(ev.qualifications) ? (ev.qualifications as OriginQualification[]) : [];
    const primary = quals[0];
    if (!primary) return fallback;
    const ftaText =
      !primary.ftaProgram || primary.ftaProgram === "NONE" || primary.ftaProgram === "UNDETERMINED"
        ? "no FTA program qualified"
        : `${primary.ftaProgram} qualification assessed`;
    return (
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-extrabold text-ink">{primary.countryOfOrigin || "—"}</span>
        <span className="text-[11px] text-ink-muted">
          {ftaText}
          {quals.length > 1 ? ` across ${quals.length} line items` : " for this line"}
        </span>
      </div>
    );
  }

  if (groupLabel === "Valuation") {
    if (typeof ev.enteredCustomsValue !== "number") return fallback;
    const enteredCustomsValue = ev.enteredCustomsValue;
    const adjustments = Array.isArray(ev.adjustments) ? (ev.adjustments as ValuationAdjustment[]) : [];
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted">Entered customs value</p>
        <p className="text-2xl font-extrabold text-ink">
          ${enteredCustomsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className={NEUTRAL_BADGE}>Method 1 — transaction value</span>
          <span className={NEUTRAL_BADGE}>
            {adjustments.length > 0 ? `${adjustments.length} adjustment${adjustments.length === 1 ? "" : "s"} applied` : "No adjustments applied"}
          </span>
        </div>
      </div>
    );
  }

  if (groupLabel === "Compliance") {
    const flags = Array.isArray(ev.flags) ? (ev.flags as ComplianceFlag[]) : [];
    if (flags.length === 0) {
      return (
        <div className="flex items-center gap-1.5 text-[11px] text-ink">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>{dec.decisionSummary || "No compliance issues identified."}</span>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {flags.map((f, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[11px]">
            <span className={severityBadgeClass(f.severity)}>{f.severity}</span>
            <span className="text-ink">{f.summary}</span>
          </div>
        ))}
      </div>
    );
  }

  return fallback;
}

interface ExtractionPayload {
  extractedJson?: {
    keyValuePairs?: Record<string, unknown>;
    extractionStatus?: string;
  } | null;
  rawContent?: string | null;
}

type ReviewAction = "APPROVE" | "REJECT" | "RE_EVALUATE";

/**
 * An agent check rendered as a row in the Field Review tab.
 *
 * A structural superset of `DecisionLike` in `modules/decisions/editableFields`,
 * which is what `reviewCategory`, `decisionGroupLabel` and `editableFieldsFor`
 * consume, plus the fields this panel reads directly.
 */
/**
 * An agent check as this panel's props receive it.
 *
 * Deliberately a structural superset of the two narrower shapes used inside this
 * file -- `DecisionListItem` (which `latestPerAgent` needs `createdAt` for) and
 * `NarrativeDecision` (which needs `status`) -- so a decision handed in as a prop
 * satisfies both without a cast. `latestPerAgent` is generic, so it returns these
 * rows with their extra fields intact rather than narrowing them away.
 */
export interface ReviewDecision {
  id: string;
  agentName?: string | null;
  /** Required: the narrative renderer branches on it and the pill displays it. */
  status: string;
  /** Required: `latestPerAgent` keeps the most recent row per agent by this. */
  createdAt: string | Date;
  decisionSummary?: string | null;
  humanNotes?: string | null;
  currentHtsCode?: string | null;
  proposedHtsCode?: string | null;
  /** Prisma `Json`; its shape varies by agent, so it is narrowed where read. */
  evidenceItems?: unknown;
}

export interface DocumentReviewPanelProps {
  documentId: string;
  fileName: string;
  // Shown as a small label above the file name, e.g. "Commercial Invoice".
  // Omit to leave the header as just the name (no type line).
  docType?: string | null;
  shipmentNumber?: string | null;
  fileUrl?: string | null;
  proxyUrl?: string;
  // Agent checks that ran on this document. When provided, the panel opens
  // to a "Field Review" tab that presents each check as a plain field/value
  // row instead of the raw document -- brokers care about the resulting
  // data, not which agent produced it.
  decisions?: ReviewDecision[];
  notesByDecision?: Record<string, string>;
  onNotesChange?: (decisionId: string, value: string) => void;
  onReviewAction?: (decisionId: string, action: ReviewAction) => void | Promise<void>;
  actionLoadingId?: string | null;
  // Rendered next to the header title, e.g. an "Approve All" button when
  // embedded on a page that has bulk actions.
  headerRight?: React.ReactNode;
  // Present only when this panel is inside a modal dialog -- renders the X
  // button and lets the caller close the overlay. Omit when embedding this
  // panel directly on a page (no overlay to close).
  onClose?: () => void;
  // id placed on the subtitle line so a wrapping dialog can point
  // aria-labelledby at it. Not needed for inline (non-dialog) embedding.
  titleId?: string;
}

/** An absent status falls through to the same default as any other. */
function statusPillClass(status: string | null | undefined): string {
  if (status === "Approved") return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (status === "Rejected") return "bg-red-100 text-red-900 border-red-300";
  return "bg-amber-100 text-amber-900 border-amber-300";
}

export function DocumentReviewPanel({
  documentId,
  fileName,
  docType = null,
  shipmentNumber = null,
  proxyUrl,
  decisions = [],
  notesByDecision = {},
  onNotesChange,
  onReviewAction,
  actionLoadingId = null,
  headerRight,
  onClose,
  titleId,
}: DocumentReviewPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<ExtractionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const hasFieldReview = decisions.length > 0;
  const mechanicalDecisions = latestPerAgent(decisions.filter((dec) => reviewCategory(dec) === "MECHANICAL"));
  const reviewableDecisions = latestPerAgent(decisions.filter((dec) => reviewCategory(dec) !== "MECHANICAL"));

  // Field Review opens first when agent checks are available -- the whole
  // point is to lead with results, not the raw document.
  const [activeTab, setActiveTab] = useState<"FIELDS" | "DOC" | "KV" | "JSON">(hasFieldReview ? "FIELDS" : "DOC");

  // Document renaming state. This holds only the in-progress edit; the name
  // shown everywhere else comes straight from the fileName prop.
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);

  // Editing an agent-proposed field value (e.g. HTS code, exporter name).
  // Keyed as "<decisionId>::<fieldKey>" since a single decision can carry
  // more than one editable field (Document Intelligence, for example).
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingFieldValue, setEditingFieldValue] = useState("");
  const [savingFieldKey, setSavingFieldKey] = useState<string | null>(null);
  const [editFieldError, setEditFieldError] = useState<string | null>(null);

  // Missing fields (expected on the document, not extracted) prompt for a
  // value up front rather than requiring a click to "start editing" first --
  // there's nothing to display, only something to ask for. Keyed the same
  // way as editingField, but tracked separately since several missing
  // fields on the same decision can be filled in at once.
  const [missingFieldValues, setMissingFieldValues] = useState<Record<string, string>>({});
  const [savingMissingKey, setSavingMissingKey] = useState<string | null>(null);
  const [missingFieldErrors, setMissingFieldErrors] = useState<Record<string, string>>({});

  // Comment input is collapsed behind a button by default -- expanded on
  // click, or automatically for a decision that already has a note so
  // existing comments are never hidden behind an extra click.
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  // This panel can stay mounted across document selections when embedded
  // inline on a page (unlike a modal, which unmounts on close), so switching
  // documentId has to reset per-document UI state instead of relying on
  // remount.
  useEffect(() => {
    setActiveTab(hasFieldReview ? "FIELDS" : "DOC");
    setIsEditingName(false);
    setEditingNameValue(fileName);
    setEditingField(null);
    setEditingFieldValue("");
    setEditFieldError(null);
    setMissingFieldValues({});
    setSavingMissingKey(null);
    setMissingFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/extractions`, {
          signal: controller.signal,
        });
        const resData = await res.json();
        if (cancelled) return;
        setData(resData);
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          console.error("Error fetching raw extraction:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [documentId]);

  const runExtraction = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/extractions`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) {
        setExtractError(resData?.error?.message ?? "Extraction failed.");
        return;
      }
      setData(resData);
      router.refresh();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  const jsonString = data?.extractedJson
    ? JSON.stringify(data.extractedJson, null, 2)
    : JSON.stringify(
        {
          documentId,
          shipmentNumber,
          fileName,
          extractedData: "Extraction pending vision agent processing",
        },
        null,
        2
      );

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenameDocument = async () => {
    if (editingNameValue.trim() === "" || editingNameValue.trim() === fileName) {
      setIsEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fileName: editingNameValue.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to rename document");
      }

      setIsEditingName(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rename document");
      setEditingNameValue(fileName);
    } finally {
      setRenaming(false);
    }
  };

  const beginEditField = (decisionId: string, fieldKey: string, currentValue: string | null) => {
    setEditFieldError(null);
    setEditingField(`${decisionId}::${fieldKey}`);
    setEditingFieldValue(currentValue || "");
  };

  const cancelEditField = () => {
    setEditingField(null);
    setEditingFieldValue("");
    setEditFieldError(null);
  };

  const commitEditField = async (decisionId: string, fieldKey: string) => {
    const trimmedValue = editingFieldValue.trim();
    if (trimmedValue === "") return;
    const compositeKey = `${decisionId}::${fieldKey}`;
    setSavingFieldKey(compositeKey);
    setEditFieldError(null);
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, action: "EDIT_VALUE", fieldKey, value: trimmedValue }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to save edit");
      setEditingField(null);
      setEditingFieldValue("");
      router.refresh();
    } catch (err) {
      setEditFieldError(err instanceof Error ? err.message : "Failed to save edit");
    } finally {
      setSavingFieldKey(null);
    }
  };

  const commitMissingField = async (decisionId: string, fieldKey: string) => {
    const compositeKey = `${decisionId}::${fieldKey}`;
    const value = (missingFieldValues[compositeKey] || "").trim();
    if (value === "") return;
    setSavingMissingKey(compositeKey);
    setMissingFieldErrors((prev) => ({ ...prev, [compositeKey]: "" }));
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, action: "EDIT_VALUE", fieldKey, value }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to save");
      router.refresh();
    } catch (err) {
      setMissingFieldErrors((prev) => ({
        ...prev,
        [compositeKey]: err instanceof Error ? err.message : "Failed to save",
      }));
    } finally {
      setSavingMissingKey(null);
    }
  };

  // Checks both url and name rather than preferring whichever is present --
  // a proxy URL like "/api/documents/proxy?documentId=..." carries no
  // filename at all, so relying on it alone (ignoring `name`) mislabels
  // every locally-stored document as an unrecognized binary file even
  // though the real fileName has a perfectly good extension.
  const isImageFile = (url: string, name: string) => {
    const ext = `${url} ${name}`.toLowerCase();
    return ext.includes(".png") || ext.includes(".jpg") || ext.includes(".jpeg") || ext.includes(".webp");
  };

  const isPdfFile = (url: string, name: string) => {
    const ext = `${url} ${name}`.toLowerCase();
    return ext.includes(".pdf");
  };

  const kvPairs = data?.extractedJson?.keyValuePairs || {};
  const kvEntries = Object.entries(kvPairs);
  const isPending = data?.extractedJson?.extractionStatus === "PENDING_VISION_PROCESSING";

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3 shrink-0 gap-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-brand shrink-0">
            <Code className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {docType && (
              <p className="text-[10px] text-[#86868B] uppercase font-bold tracking-wide mb-0.5">{docType}</p>
            )}
            {isEditingName ? (
              <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editingNameValue}
                  onChange={(e) => setEditingNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameDocument();
                    if (e.key === "Escape") {
                      setIsEditingName(false);
                      setEditingNameValue(fileName);
                    }
                  }}
                  className="px-2.5 py-1 text-sm font-extrabold text-ink border border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white w-64"
                  disabled={renaming}
                  autoFocus
                />
                <button
                  onClick={handleRenameDocument}
                  disabled={renaming}
                  className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setEditingNameValue(fileName);
                  }}
                  disabled={renaming}
                  className="p-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <h3 className="text-base font-extrabold text-ink flex items-center space-x-2 group min-w-0">
                <span className="truncate">{fileName}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNameValue(fileName);
                    setIsEditingName(true);
                  }}
                  className="p-1 rounded hover:bg-surface-muted text-ink-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                  title="Rename Document"
                >
                  <Edit2 className="w-3.5 h-3.5 animate-in fade-in" />
                </button>
              </h3>
            )}
            <p id={titleId} className="text-xs text-ink-muted mt-0.5">
              {hasFieldReview ? (
                <>
                  {mechanicalDecisions.length + reviewableDecisions.length} agent checks
                  {shipmentNumber && (
                    <>
                      {" · "}
                      <span className="font-mono text-brand font-bold">{shipmentNumber}</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  Neutral OCR &amp; Raw Extraction Vault
                  {shipmentNumber && (
                    <>
                      {" • Shipment: "}
                      <span className="font-mono text-brand font-bold">{shipmentNumber}</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {headerRight}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tab Selection Bar */}
      <div className="flex items-center justify-between bg-surface-muted p-1 rounded-xl border border-border text-xs shrink-0">
        <div className="flex items-center space-x-1">
          {hasFieldReview && (
            <button
              onClick={() => setActiveTab("FIELDS")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTab === "FIELDS" ? "bg-white text-brand shadow-2xs" : "text-ink-muted hover:text-ink"
              }`}
            >
              Field Review ({mechanicalDecisions.length + reviewableDecisions.length})
            </button>
          )}
          <button
            onClick={() => setActiveTab("DOC")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "DOC" ? "bg-white text-brand shadow-2xs" : "text-ink-muted hover:text-ink"
            }`}
          >
            Document Preview
          </button>
          <button
            onClick={() => setActiveTab("KV")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "KV" ? "bg-white text-brand shadow-2xs" : "text-ink-muted hover:text-ink"
            }`}
          >
            Neutral Key-Value Pairs ({kvEntries.length})
          </button>
          <button
            onClick={() => setActiveTab("JSON")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "JSON" ? "bg-white text-brand shadow-2xs" : "text-ink-muted hover:text-ink"
            }`}
          >
            Raw Extraction JSON Blob
          </button>
        </div>

        {activeTab === "JSON" && (
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg bg-white border border-border hover:bg-surface-muted text-ink font-bold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-brand" />}
            <span>{copied ? "Copied!" : "Copy JSON"}</span>
          </button>
        )}
      </div>

      {/* Content Box */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs py-12">
            <span>Loading raw extraction data...</span>
          </div>
        ) : activeTab === "FIELDS" ? (
          <div className="flex-1 overflow-y-auto border border-border rounded-2xl p-4 bg-[#F9F9FB] space-y-2.5 text-xs">
            <RollupSummary decisions={[...mechanicalDecisions, ...reviewableDecisions]} />
            {reviewableDecisions.map((dec) => {
              const isBusy = actionLoadingId === dec.id;
              const groupLabel = reviewerLabel(dec);
              const category = reviewCategory(dec);
              const fields = category === "FIELDS" ? editableFieldsFor(dec) : [];

              return (
                <div key={dec.id} className="p-3.5 rounded-xl bg-white border border-border shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-ink text-[13px]">{groupLabel}</span>
                    <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${statusPillClass(dec.status)}`}>
                      {dec.status}
                    </span>
                  </div>

                  {category === "FIELDS" ? (
                    <div className="space-y-2">
                      {fields.map((f) => {
                        const compositeKey = `${dec.id}::${f.key}`;

                        if (f.status === "MISSING") {
                          const isSavingThis = savingMissingKey === compositeKey;
                          const missingError = missingFieldErrors[compositeKey];
                          return (
                            <div key={f.key} className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                              <p className="text-[10px] text-amber-800 font-bold uppercase tracking-wide">
                                {f.label} — not found, please provide
                              </p>
                              <div className="flex items-center space-x-1.5">
                                <input
                                  type="text"
                                  value={missingFieldValues[compositeKey] || ""}
                                  onChange={(e) =>
                                    setMissingFieldValues((prev) => ({ ...prev, [compositeKey]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitMissingField(dec.id, f.key);
                                  }}
                                  disabled={isSavingThis}
                                  placeholder={`Enter ${f.label}...`}
                                  className="flex-1 min-w-0 px-2 py-1 text-[12px] font-mono font-bold text-ink border border-amber-300 rounded-lg bg-white outline-none focus:border-brand"
                                />
                                <button
                                  onClick={() => commitMissingField(dec.id, f.key)}
                                  disabled={isSavingThis || !(missingFieldValues[compositeKey] || "").trim()}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg cursor-pointer shrink-0 transition-colors"
                                >
                                  {isSavingThis ? "Saving..." : "Save"}
                                </button>
                              </div>
                              {missingError && <p className="text-[10px] text-red-600">{missingError}</p>}
                            </div>
                          );
                        }

                        const isEditingThis = editingField === compositeKey;
                        const isSavingThis = savingFieldKey === compositeKey;

                        return (
                          <div key={f.key} className="group p-2.5 rounded-lg bg-surface-muted border border-border">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[10px] text-ink-muted font-bold uppercase tracking-wide">{f.label}</p>
                              {!isEditingThis && (
                                <button
                                  onClick={() => beginEditField(dec.id, f.key, f.value)}
                                  className="p-1 rounded hover:bg-white text-ink-muted hover:text-brand opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                                  title={`Edit ${f.label}`}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {isEditingThis ? (
                              <div className="space-y-1 mt-1">
                                <div className="flex items-center space-x-1.5">
                                  <input
                                    type="text"
                                    value={editingFieldValue}
                                    onChange={(e) => setEditingFieldValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitEditField(dec.id, f.key);
                                      if (e.key === "Escape") cancelEditField();
                                    }}
                                    disabled={isSavingThis}
                                    autoFocus
                                    className="flex-1 min-w-0 px-2 py-1 text-[12px] font-mono font-bold text-ink border border-brand rounded-lg bg-white outline-none"
                                  />
                                  <button
                                    onClick={() => commitEditField(dec.id, f.key)}
                                    disabled={isSavingThis}
                                    className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer disabled:opacity-50 shrink-0"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={cancelEditField}
                                    disabled={isSavingThis}
                                    className="p-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer disabled:opacity-50 shrink-0"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                {editFieldError && <p className="text-[10px] text-red-600">{editFieldError}</p>}
                              </div>
                            ) : (
                              <p className="font-mono font-extrabold text-ink text-[12px] break-words mt-0.5">{f.value}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    renderNarrativeBody(dec, { onViewKeyValues: () => setActiveTab("KV"), kvCount: kvEntries.length })
                  )}

                  {(() => {
                    const hasComment = Boolean((notesByDecision[dec.id] ?? dec.humanNotes ?? "").trim());
                    const isExpanded = expandedComments.has(dec.id) || hasComment;
                    if (!isExpanded) return null;
                    return (
                      <input
                        type="text"
                        value={notesByDecision[dec.id] ?? dec.humanNotes ?? ""}
                        onChange={(e) => onNotesChange?.(dec.id, e.target.value)}
                        placeholder="Comment..."
                        autoFocus={expandedComments.has(dec.id) && !hasComment}
                        className="w-full px-3 py-2 bg-surface-muted border border-border focus:border-brand focus:bg-surface rounded-lg text-[11px] text-ink transition-all outline-none font-medium"
                      />
                    );
                  })()}
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() =>
                        setExpandedComments((prev) => {
                          const next = new Set(prev);
                          if (next.has(dec.id)) {
                            next.delete(dec.id);
                          } else {
                            next.add(dec.id);
                          }
                          return next;
                        })
                      }
                      className="px-3 py-1.5 bg-surface border border-border hover:bg-surface-muted text-ink-muted text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer mr-auto"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Comment</span>
                    </button>
                    <button
                      onClick={() => onReviewAction?.(dec.id, "RE_EVALUATE")}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white border border-border hover:bg-surface-muted text-amber-700 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Re-evaluate</span>
                    </button>
                    <button
                      onClick={() => onReviewAction?.(dec.id, "REJECT")}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <X className="w-3 h-3" />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => onReviewAction?.(dec.id, "APPROVE")}
                      disabled={isBusy || dec.status === "Approved"}
                      className="px-3.5 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>{isBusy ? "Saving..." : "Approve"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
            {reviewableDecisions.length === 0 && mechanicalDecisions.length === 0 && (
              <div className="p-8 text-center text-ink-muted">No agent checks yet for this document.</div>
            )}

            {mechanicalDecisions.length > 0 && (
              <div className="p-3 rounded-xl bg-[#F0F0F2] border border-border space-y-1.5">
                <p className="text-[10px] font-bold uppercase text-ink-muted tracking-wide">
                  Automated processing ({mechanicalDecisions.length}) — nothing to review
                </p>
                <div className="space-y-1">
                  {mechanicalDecisions.map((dec) => (
                    <div key={dec.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5">
                      <span className="text-ink font-semibold truncate">{decisionGroupLabel(dec)}</span>
                      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${statusPillClass(dec.status)}`}>
                        {dec.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "DOC" ? (
          <div className="flex-1 overflow-y-auto bg-surface-muted rounded-2xl border border-border p-4 flex items-center justify-center min-h-[350px]">
            {proxyUrl ? (
              isImageFile(proxyUrl, fileName) ? (
                // next/image is deliberately not used: these are tenant documents
                // served through an authenticated proxy, and routing them via the
                // image optimizer would cache customs paperwork outside that path.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proxyUrl}
                  alt={fileName}
                  className="max-h-[55vh] rounded-xl border border-border shadow-md object-contain"
                />
              ) : isPdfFile(proxyUrl, fileName) ? (
                // A fixed vh height here previously overflowed shorter
                // containers (e.g. embedded on the shipment page at a fixed
                // pixel height) since an iframe has no intrinsic size to
                // shrink to. h-full defers to whatever height the container
                // -- modal or inline panel -- actually provides.
                <iframe
                  src={proxyUrl}
                  className="w-full h-full min-h-[350px] rounded-xl border border-border"
                  title={fileName}
                />
              ) : (
                <div className="text-center p-8 space-y-3">
                  <FileText className="w-12 h-12 text-brand mx-auto" />
                  <div>
                    <h4 className="font-extrabold text-ink text-sm">{fileName}</h4>
                    <p className="text-xs text-ink-muted mt-1">Binary trade file stored securely in Qubere Document Vault.</p>
                  </div>
                  <a
                    href={proxyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors"
                  >
                    <span>Open File in New Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )
            ) : (
              <div className="text-center p-8 space-y-3">
                <FileText className="w-12 h-12 text-ink-muted/50 mx-auto" />
                <div>
                  <h4 className="font-extrabold text-ink text-sm">{fileName}</h4>
                  <p className="text-xs text-ink-muted mt-1">Document preview is currently unavailable.</p>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "KV" ? (
          <div className="flex-1 overflow-y-auto border border-border rounded-2xl p-4 bg-[#F9F9FB] space-y-3 text-xs">
            {kvEntries.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {kvEntries.map(([k, v], idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-white border border-border space-y-0.5 shadow-2xs">
                    <p className="text-[11px] text-ink-muted font-bold uppercase">{k}</p>
                    <p className="font-extrabold text-ink break-words">
                      {v !== null && v !== undefined ? String(v) : (
                        <span className="italic font-normal text-amber-700">Not Present (Null)</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-ink-muted">
                <p className="font-bold text-ink">No key-value pairs extracted</p>
                {isPending ? (
                  <>
                    <p className="text-sm mt-1">This document has not been processed yet.</p>
                    <button
                      onClick={runExtraction}
                      disabled={extracting}
                      className="mt-4 px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      {extracting ? "Extracting..." : "Run extraction"}
                    </button>
                    {extractError && (
                      <p className="text-sm mt-2 text-red-600">{extractError}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm mt-1">
                    The document was processed but no fields were discovered. Raw content is
                    preserved in the JSON payload.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-[#1E1E1E] text-emerald-400 p-4 rounded-2xl font-mono text-xs shadow-inner leading-relaxed select-all">
            <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
