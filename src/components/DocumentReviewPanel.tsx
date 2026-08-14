"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Code, FileText, ExternalLink, Edit2, RotateCcw, MessageSquare, Sparkles, MapPin, MapPinOff } from "lucide-react";
import { decisionGroupLabel, reviewerLabel, editableFieldsFor, reviewCategory } from "@/modules/decisions/editableFields";
import { triageDecision } from "@/modules/decisions/decisionState";
import { type ReviewField, nextReviewIndex } from "@/modules/documents/extractionReview";
import { PdfCanvas, type PdfCanvasBbox } from "@/components/PdfCanvas";

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

type RollupCategory = "VERIFIED" | "REVIEW" | "BLOCKED";

interface RollupDecision {
  id: string;
  status: string;
  triageState?: string | null;
  proposedDescription?: string | null;
}

function classifyDecision(d: { status: string; triageState?: string | null; proposedDescription?: string | null }): RollupCategory {
  const triage = triageDecision(d);
  if (triage === "blocked") return "BLOCKED";
  if (triage === "verified") return "VERIFIED";
  return "REVIEW";
}

// Fixed ordering used both to sort the check list and to rank which stat
// box's first match a click should jump to -- worst first, so the thing
// most likely to need action is what you land on.
const CATEGORY_PRIORITY: Record<RollupCategory, number> = { BLOCKED: 0, REVIEW: 1, VERIFIED: 2 };

function RollupSummary({
  decisions,
  onSelectCategory,
}: {
  decisions: RollupDecision[];
  onSelectCategory?: (category: RollupCategory) => void;
}) {
  const total = decisions.length;
  if (total === 0) return null;

  const blocked = decisions.filter((d) => classifyDecision(d) === "BLOCKED").length;
  const verified = decisions.filter((d) => classifyDecision(d) === "VERIFIED").length;
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
        <button
          type="button"
          onClick={() => onSelectCategory?.("VERIFIED")}
          className="flex-1 rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-left hover:bg-emerald-100 transition-colors cursor-pointer"
        >
          <p className="text-base font-extrabold text-emerald-900">{verified}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-emerald-700">Verified</p>
        </button>
        <button
          type="button"
          onClick={() => onSelectCategory?.("REVIEW")}
          className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2 text-left hover:bg-amber-100 transition-colors cursor-pointer"
        >
          <p className="text-base font-extrabold text-amber-900">{review}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-amber-700">Review</p>
        </button>
        <button
          type="button"
          onClick={() => onSelectCategory?.("BLOCKED")}
          className="flex-1 rounded-xl bg-red-50 border border-red-200 px-2.5 py-2 text-left hover:bg-red-100 transition-colors cursor-pointer"
        >
          <p className="text-base font-extrabold text-red-900">{blocked}</p>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-red-700">Blocked</p>
        </button>
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

interface ExtractionFieldRow {
  fieldName?: string;
  value?: string;
  pageNumber?: number | null;
  confidence?: number | null;
  bbox?: { x: number; y: number; width: number; height: number } | null;
}

interface ExtractionPayload {
  extractedJson?: Record<string, unknown> | null;
  rawContent?: string | null;
  extractionFields?: Array<ExtractionFieldRow>;
  // C-3: Grouped, bbox-parsed review fields returned by the updated GET endpoint.
  reviewFields?: ReviewField[];
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
  triageState?: string | null;
  proposedDescription?: string | null;
  /** Required: `latestPerAgent` keeps the most recent row per agent by this. */
  createdAt: string | Date;
  decisionSummary?: string | null;
  humanNotes?: string | null;
  currentHtsCode?: string | null;
  proposedHtsCode?: string | null;
  /** Prisma `Json`; its shape varies by agent, so it is narrowed where read. */
  evidenceItems?: unknown;
  valueAtRisk?: number | null;
  totalValue?: number | null;
  autoApproved?: boolean | null;
  updatedAt?: string | Date | null;
  autoApprovalPolicy?: string | null;
}

export interface DocumentHtsScore {
  // null when this document's HTS-bearing lines haven't been matched to a
  // classified persisted line item yet (classifiedCount will be 0).
  averageConfidence: number | null;
  classifiedCount: number;
  totalCount: number;
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
  // Present only when this document's extraction produced HTS-bearing line
  // items -- a Bill of Lading or Packing List has none, so the badge next to
  // the tab bar is omitted rather than showing a score for codes that were
  // never expected on this document.
  htsScore?: DocumentHtsScore;
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
  htsScore,
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
  // Worst-first (Blocked, then Review, then Verified) so the checks most
  // likely to need action surface at the top of the list.
  const reviewableDecisions = latestPerAgent(decisions.filter((dec) => reviewCategory(dec) !== "MECHANICAL")).sort(
    (a, b) => CATEGORY_PRIORITY[classifyDecision(a)] - CATEGORY_PRIORITY[classifyDecision(b)]
  );

  // Jumps to the first check card in the clicked rollup category. Mechanical
  // checks render in their own collapsed block with no per-card scroll
  // target, so a click only ever needs to consider reviewableDecisions.
  function scrollToCategory(category: RollupCategory) {
    const target = reviewableDecisions.find((dec) => classifyDecision(dec) === category);
    if (!target) return;
    document.getElementById(`decision-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Document tab opens first so clicking a document name surfaces the actual PDF viewer
  const [activeTab, setActiveTab] = useState<"FIELDS" | "DOC" | "KV" | "JSON">("DOC");

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

  // Click-to-provenance: which page is loaded in the PDF canvas, and which
  // field is currently highlighted (null = no highlight).
  const [pdfPage, setPdfPage] = useState(1);
  const [activeProvenance, setActiveProvenance] = useState<{
    name: string;
    page: number | null;
    bbox: PdfCanvasBbox | null;
  } | null>(null);

  // D-3: Index of the focused ReviewField for keyboard navigation.
  // -1 means no field is focused.
  const [activeFieldIndex, setActiveFieldIndex] = useState(-1);
  const fieldListRef = useRef<HTMLDivElement>(null);

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
    setPdfPage(1);
    setActiveProvenance(null);
    setActiveFieldIndex(-1);
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

  const parsedExtractedJson = useMemo(() => {
    if (!data?.extractedJson) return null;
    if (typeof data.extractedJson === "string") {
      try {
        return JSON.parse(data.extractedJson) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return data.extractedJson as Record<string, unknown>;
  }, [data?.extractedJson]);

  const kvEntries = useMemo(() => {
    const map = new Map<string, string>();

    // 1. From database extractionFields array
    if (Array.isArray(data?.extractionFields)) {
      for (const field of data.extractionFields) {
        if (field.fieldName && field.value) {
          map.set(field.fieldName, String(field.value));
        }
      }
    }

    // 2. From extractedJson.keyValuePairs
    const kv = parsedExtractedJson?.keyValuePairs;
    if (kv && typeof kv === "object") {
      for (const [k, v] of Object.entries(kv as Record<string, unknown>)) {
        if (k && v !== null && v !== undefined && String(v).trim()) {
          map.set(k, String(v));
        }
      }
    }

    // 3. From extractedJson.tradeMetadata
    const tm = parsedExtractedJson?.tradeMetadata;
    if (tm && typeof tm === "object") {
      for (const [k, v] of Object.entries(tm as Record<string, unknown>)) {
        if (k && v !== null && v !== undefined && String(v).trim()) {
          map.set(k, String(v));
        }
      }
    }

    // 4. Fallback if top-level parsedExtractedJson itself contains primitive pairs
    if (map.size === 0 && parsedExtractedJson && typeof parsedExtractedJson === "object") {
      for (const [k, v] of Object.entries(parsedExtractedJson)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          map.set(k, String(v));
        }
      }
    }

    return Array.from(map.entries());
  }, [data?.extractionFields, parsedExtractedJson]);

  // Index of field→provenance metadata. Only the most-recently-written row per
  // field is kept (agents overwrite on re-run; newest row wins).
  const provenanceMap = useMemo(() => {
    const map = new Map<string, { page: number | null; confidence: number | null; bbox: { x: number; y: number; width: number; height: number } | null }>();
    if (!Array.isArray(data?.extractionFields)) return map;
    for (const field of data.extractionFields) {
      if (!field.fieldName) continue;
      const page = field.pageNumber ?? null;
      const bbox = field.bbox && typeof field.bbox === "object" &&
        "x" in field.bbox && "y" in field.bbox &&
        "width" in field.bbox && "height" in field.bbox
        ? (field.bbox as { x: number; y: number; width: number; height: number })
        : null;
      // Later rows in the array are more recent; always overwrite.
      map.set(field.fieldName, { page, confidence: field.confidence ?? null, bbox });
    }
    return map;
  }, [data?.extractionFields]);

  function jumpToField(name: string) {
    const prov = provenanceMap.get(name);
    if (!prov) return;
    setActiveProvenance({ name, page: prov.page, bbox: prov.bbox });
    if (prov.page) setPdfPage(prov.page);
    setActiveTab("DOC");
  }

  // Jump to a ReviewField by index in the right-pane field list.
  const jumpToReviewField = useCallback(
    (index: number) => {
      const fields = data?.reviewFields ?? [];
      if (fields.length === 0) return;
      const clamped = ((index % fields.length) + fields.length) % fields.length;
      const field = fields[clamped];
      setActiveFieldIndex(clamped);
      if (field.bbox) {
        setActiveProvenance({ name: field.fieldName, page: field.pageNumber, bbox: field.bbox });
        if (field.pageNumber) setPdfPage(field.pageNumber);
      } else {
        setActiveProvenance({ name: field.fieldName, page: field.pageNumber, bbox: null });
      }
      // Scroll the field row into view in the right pane.
      const row = fieldListRef.current?.querySelector<HTMLElement>(`[data-field-index="${clamped}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [data?.reviewFields]
  );

  // D-3: n = next review field, p = previous review field (wrapping).
  useEffect(() => {
    if (activeTab !== "DOC") return;
    const fields = data?.reviewFields ?? [];
    if (fields.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      // Ignore when the user is typing in an input or textarea.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "n") {
        e.preventDefault();
        const next = nextReviewIndex(fields, activeFieldIndex);
        if (next !== -1) jumpToReviewField(next);
        else jumpToReviewField((activeFieldIndex + 1) % fields.length);
      } else if (e.key === "p") {
        e.preventDefault();
        const prev = (activeFieldIndex - 1 + fields.length) % fields.length;
        jumpToReviewField(prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, data?.reviewFields, activeFieldIndex, jumpToReviewField]);

  const isPending = parsedExtractedJson?.extractionStatus === "PENDING_VISION_PROCESSING";

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
                  {shipmentNumber && (
                    <span className="font-mono text-brand font-bold">{shipmentNumber}</span>
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
            Extracted Facts ({kvEntries.length})
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

        <div className="flex items-center space-x-2 shrink-0">
          {htsScore && (
            <span
              title={
                htsScore.classifiedCount < htsScore.totalCount
                  ? `${htsScore.classifiedCount} of ${htsScore.totalCount} HTS-bearing line items matched to a classified record`
                  : `Average classification confidence across ${htsScore.totalCount} HTS-bearing line item${htsScore.totalCount === 1 ? "" : "s"}`
              }
              className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center space-x-1.5 border ${
                htsScore.averageConfidence === null
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : htsScore.averageConfidence >= 90
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : htsScore.averageConfidence >= 80
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              <span className="uppercase tracking-wide text-[10px] opacity-80">HS Score</span>
              <span>
                {htsScore.averageConfidence === null ? "Not Classified" : `${htsScore.averageConfidence}%`}
              </span>
            </span>
          )}
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
      </div>

      {/* Content Box */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs py-12">
            <span>Loading raw extraction data...</span>
          </div>
        ) : activeTab === "FIELDS" ? (
          <div className="flex-1 overflow-y-auto border border-border rounded-2xl p-4 bg-[#F9F9FB] space-y-2.5 text-xs">
            <RollupSummary decisions={[...mechanicalDecisions, ...reviewableDecisions]} onSelectCategory={scrollToCategory} />
            {reviewableDecisions.map((dec) => {
              const isBusy = actionLoadingId === dec.id;
              const groupLabel = reviewerLabel(dec);
              const category = reviewCategory(dec);
              const fields = category === "FIELDS" ? editableFieldsFor(dec) : [];

              return (
                <div id={`decision-${dec.id}`} key={dec.id} className="p-3.5 rounded-xl bg-white border border-border shadow-2xs space-y-2.5">
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

            {(() => {
              // "Mechanical" means no field to correct, not "can't fail" --
              // Document Intake and Filing Readiness write status "Needs
              // Review" when the underlying check actually failed (e.g. not
              // ready for transmission). A passing mechanical check has
              // nothing to tell the broker, so it's not rendered at all;
              // only the ones that actually failed are worth a line.
              const failingMechanical = mechanicalDecisions.filter((dec) => dec.status !== "Approved");
              if (failingMechanical.length === 0) return null;
              return (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase text-amber-800 tracking-wide">
                    Automated processing — {failingMechanical.length} needs attention
                  </p>
                  <div className="space-y-1">
                    {failingMechanical.map((dec) => (
                      <div key={dec.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5">
                        <span className="text-ink font-semibold truncate">{decisionGroupLabel(dec)}</span>
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${statusPillClass(dec.status)}`}>
                          {dec.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : activeTab === "DOC" ? (
          <div className="flex-1 w-full h-full min-h-[480px] rounded-2xl border border-border bg-[#212328] flex flex-col overflow-hidden shadow-inner">
            {proxyUrl ? (
              isImageFile(proxyUrl, fileName) ? (
                <div className="flex-1 p-4 flex items-center justify-center overflow-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proxyUrl}
                    alt={fileName}
                    className="max-h-[65vh] rounded-xl border border-border shadow-md object-contain"
                  />
                </div>
              ) : isPdfFile(proxyUrl, fileName) ? (
                (() => {
                  const reviewFields = data?.reviewFields ?? [];
                  return (
                    <div className="flex-1 w-full h-full flex flex-col overflow-hidden">
                      {/* PDF Action Bar */}
                      <div className="bg-[#18191c] border-b border-white/10 px-4 py-2 flex items-center justify-between text-white shrink-0">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <FileText className="w-4 h-4 text-brand shrink-0" />
                          <span className="text-xs font-bold truncate text-slate-100">{fileName}</span>
                          {pdfPage > 1 && (
                            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-brand/30 text-brand-light shrink-0">
                              p.{pdfPage}
                            </span>
                          )}
                          {reviewFields.length > 0 && (
                            <span className="text-[10px] text-slate-400 hidden sm:inline">
                              n/p to navigate fields
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          {pdfPage > 1 && (
                            <button
                              onClick={() => { setPdfPage(1); setActiveProvenance(null); setActiveFieldIndex(-1); }}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                              title="Back to page 1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reset</span>
                            </button>
                          )}
                          <a
                            href={proxyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                            title="Open full document in new tab"
                          >
                            <span>Open Full View</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>

                      {/* D-2: Split pane — PdfCanvas (left) + extracted field list (right). */}
                      <div className="flex-1 flex min-h-0 overflow-hidden">
                        {/* Left: PDF canvas with bbox highlight */}
                        <div className="flex-1 min-w-0 overflow-hidden relative">
                          {activeProvenance && (
                            <div className="absolute top-0 left-0 right-0 bg-amber-900/80 border-b border-amber-600/40 px-3 py-1.5 flex items-center justify-between gap-2 z-10 shrink-0">
                              <div className="flex items-center gap-2 min-w-0 text-xs">
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-300 font-bold text-[10px] uppercase shrink-0">
                                  Source
                                </span>
                                <span className="font-semibold text-amber-200 truncate">{activeProvenance.name}</span>
                                {activeProvenance.page && (
                                  <span className="text-amber-400 shrink-0">p.{activeProvenance.page}</span>
                                )}
                                {/* D-4: degrade gracefully when no bbox was recorded */}
                                {!activeProvenance.bbox && (
                                  <span className="text-amber-500 text-[10px] shrink-0 italic">location not recorded</span>
                                )}
                              </div>
                              <button
                                onClick={() => { setActiveProvenance(null); setActiveFieldIndex(-1); }}
                                className="text-amber-400 hover:text-amber-200 transition-colors cursor-pointer shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <PdfCanvas
                            url={proxyUrl}
                            page={pdfPage}
                            bbox={activeProvenance?.bbox ?? null}
                            className="w-full h-full"
                          />
                        </div>

                        {/* Right: extracted field list with "view source" buttons */}
                        {reviewFields.length > 0 && (
                          <div
                            ref={fieldListRef}
                            className="w-72 shrink-0 border-l border-white/10 overflow-y-auto bg-[#1a1b1f] flex flex-col text-xs"
                          >
                            <div className="px-3 py-2 border-b border-white/10 shrink-0">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Extracted Fields
                              </p>
                            </div>
                            <div className="flex-1 divide-y divide-white/5">
                              {reviewFields.map((field, idx) => {
                                const isActive = activeFieldIndex === idx;
                                const hasLocation = field.pageNumber !== null || field.bbox !== null;
                                return (
                                  <div
                                    key={field.fieldName}
                                    data-field-index={idx}
                                    className={`px-3 py-2.5 transition-colors ${
                                      isActive
                                        ? "bg-amber-900/25 border-l-2 border-amber-500"
                                        : "hover:bg-white/5 border-l-2 border-transparent"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 truncate">
                                          {field.fieldName}
                                        </p>
                                        <p
                                          className={`font-mono font-semibold break-words mt-0.5 ${
                                            field.corrected
                                              ? "text-brand-light"
                                              : field.needsReview
                                              ? "text-amber-300"
                                              : "text-slate-200"
                                          }`}
                                        >
                                          {field.currentValue}
                                        </p>
                                      </div>
                                      {/* D-4: view source / location not recorded */}
                                      {hasLocation ? (
                                        <button
                                          onClick={() => jumpToReviewField(idx)}
                                          title={
                                            field.bbox
                                              ? `Jump to page ${field.pageNumber ?? "?"} and highlight`
                                              : `Jump to page ${field.pageNumber ?? "?"}`
                                          }
                                          className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer"
                                        >
                                          <MapPin className="w-2.5 h-2.5" />
                                          {field.pageNumber !== null ? `p.${field.pageNumber}` : ""}
                                        </button>
                                      ) : (
                                        <span
                                          title="Location not recorded by extraction pipeline"
                                          className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-slate-600"
                                        >
                                          <MapPinOff className="w-2.5 h-2.5" />
                                        </span>
                                      )}
                                    </div>
                                    {field.confidence !== null && (
                                      <p className="text-[10px] text-slate-600 mt-0.5">
                                        {field.confidence}% confidence
                                        {field.corrected && " · corrected"}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex-1 text-center p-8 space-y-3 flex flex-col items-center justify-center">
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
                {kvEntries.map(([k, v], idx) => {
                  const prov = provenanceMap.get(k);
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-white border border-border space-y-0.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-ink-muted font-bold uppercase truncate">{k}</p>
                        {prov?.page && (
                          <button
                            onClick={() => jumpToField(k)}
                            title={`Extracted from page ${prov.page}${prov.confidence != null ? ` · ${prov.confidence}% confidence` : ""}`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer shrink-0"
                          >
                            p.{prov.page}
                            {prov.confidence != null && (
                              <span className="text-amber-500 font-normal">{prov.confidence}%</span>
                            )}
                          </button>
                        )}
                      </div>
                      <p className="font-extrabold text-ink break-words">
                        {v !== null && v !== undefined ? String(v) : (
                          <span className="italic font-normal text-amber-700">Not Present (Null)</span>
                        )}
                      </p>
                    </div>
                  );
                })}
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
