"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  Save,
  RotateCcw,
  XCircle,
  FileText,
  Truck,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Plus,
  Download,
  FolderArchive,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { displayCurrency, displayDate, displayText } from "@/lib/honest";
import { filingStages, type FilingStageState } from "@/modules/filings/filingStateMachine";
import { getFilingConfig, formatCurrencyAmount } from "@/lib/filing/countryConfig";
import DynamicFormRenderer from "./DynamicFormRenderer";

interface FilingProps {
  id: string;
  entryNumber: string;
  localReferenceNumber: string | null; // User-provided local reference (defaults to entryNumber)
  registrationNumber: string | null; // User-provided registration number
  entryType: string | null; // Multi-country migration: now nullable (legacy field)
  filingType: string;
  filingStatus: string;
  paymentStatus: string;
  authority: string | null; // Multi-country migration: now nullable (legacy field)
  country: string | null; // Multi-country support
  procedureCode?: string | null; // Procedure code for standalone filings
  messageName?: string | null; // Message name for standalone filings
  totalValue: number | null;
  totalDuties: number | null;
  totalTaxes: number | null;
  totalAmount: number | null;
  dutyBreakdown: { feeName: string; amount: number; rate: string }[];
  declarationDraft?: any | null; // For standalone filings, the saved declaration data
  submittedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShipmentProps {
  id: string;
  shipmentNumber: string;
  importerName: string;
  destinationCountry: string | null;
  countryOfExport: string | null;
  portOfEntry: string | null;
  carrierName: string | null;
  incoterm: string | null;
  entryType: string | null;
}

interface LineItemProps {
  id: string;
  lineNumber: number;
  partNumber: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  countryOfOrigin: string;
  htsCode: string;
  htsConfidence: number | null;
  status: string;
}

interface DocumentProps {
  id: string;
  fileName: string;
  docType: string;
  status: string;
  fileUrl: string | null;
  confidence: number | null;
}

interface ResponseProps {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  receivedAt: string;
}

interface MessageProps {
  id: string;
  messageId: string;
  messageName: string;
  direction: string;
  status: string | null;
  correlationId: string | null;
  priorMessageId: string | null;
  createdAt: string;
  envelope: object;
}

interface AuditLogProps {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  details: Record<string, unknown> | null;
}

interface FilingDetailClientProps {
  filing: FilingProps;
  shipment: ShipmentProps | null; // Now nullable for standalone filings
  lineItems: LineItemProps[];
  documents: DocumentProps[];
  responses: ResponseProps[];
  messages: MessageProps[];
  auditLogs?: AuditLogProps[];
  allowUpdates: boolean;
  canValidate: boolean;
  canApprove: boolean;
  canTransmit: boolean;
  canResubmit: boolean;
  /** Dynamic list from FilingChildActionRule -- e.g. ["CANCEL"]. Render generically; adding an action is a registry entry, not a new prop. */
  childActions: string[];
}

const CLEARED_STATUSES = new Set(["Accepted", "Released", "Closed", "BrokerApproved"]);
const BLOCKED_STATUSES = new Set(["ValidationFailed", "Rejected", "CustomsHold", "Cancelled"]);

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  if (CLEARED_STATUSES.has(status)) return "success";
  if (BLOCKED_STATUSES.has(status)) return "danger";
  if (status === "Transmitted" || status === "TransmissionPending" || status === "CancellationRequested") return "info";
  return "neutral";
}

/**
 * Registry for child actions returned by FilingChildActionRule. Adding a new
 * action (AMEND, INVALIDATE) is a new entry here plus seed-data rows -- the
 * render loop and the server-side resolver never change.
 */
interface ChildActionDefinition {
  label: string;
  icon: typeof XCircle;
  variant: "danger" | "secondary" | "primary";
  confirmTitle: string;
  confirmBody: string;
  confirmLabel: string;
  endpoint: string;
  /** Key in the route's JSON response holding { status, mockResponseApplied, ... }. */
  responseKey: string;
  successMessage: string;
  /** The FilingMessageActionCatalog code (e.g. "CANCELLATION") -- distinct from
   *  this registry's own UI action code (e.g. "CANCEL") -- used to fetch the
   *  resolved FilingActionDataRequirement fields for this filing's context. */
  messageAction: string;
}

const CHILD_ACTION_REGISTRY: Record<string, ChildActionDefinition> = {
  CANCEL: {
    label: "Cancel Filing",
    icon: XCircle,
    variant: "danger",
    confirmTitle: "Cancel this filing?",
    confirmBody:
      "This sends a cancellation message referencing the last declaration transmitted for this entry. The status moves to Cancellation Requested immediately, then to Cancelled once the response confirms it.",
    confirmLabel: "Send Cancellation",
    endpoint: "cancel",
    responseKey: "cancellation",
    successMessage: "Cancellation requested.",
    messageAction: "CANCELLATION",
  },
};

/**
 * Mirrors ActionDataFieldEntry (src/lib/canonicalMessaging/actionDataRequirements.ts)
 * as a local, client-safe type -- that module imports @/lib/db and can't be
 * imported into a client component.
 */
interface ActionFieldEntry {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "date" | "grid";
  required: boolean;
  source: string;
  helpText?: string;
  columns?: ActionFieldEntry[];
}

/** Recursive editor for a "grid"-type action field's rows -- add/remove rows, and a nested grid renders itself again for a column that's itself a grid. */
function ActionFieldGridEditor({
  columns,
  rows,
  onChange,
}: {
  columns: ActionFieldEntry[];
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
}) {
  function blankRow(): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const c of columns) row[c.key] = c.type === "boolean" ? false : c.type === "grid" ? [] : "";
    return row;
  }
  function updateRow(i: number, patch: Record<string, unknown>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-2 bg-surface-muted/40">
      {rows.length === 0 && <p className="text-xs text-ink-muted px-1 py-1">No rows yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-border bg-white p-2 space-y-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label="Remove row"
              className="p-1 rounded hover:bg-red-50 text-red-600"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          {columns.map((c) => (
            <div key={c.key} className="space-y-1">
              <label className="text-[11px] font-bold text-ink-muted">
                {c.label}
                {c.required && " *"}
              </label>
              {c.type === "grid" ? (
                <ActionFieldGridEditor
                  columns={c.columns ?? []}
                  rows={(r[c.key] as Record<string, unknown>[] | undefined) ?? []}
                  onChange={(nested) => updateRow(i, { [c.key]: nested })}
                />
              ) : c.type === "boolean" ? (
                <select
                  value={r[c.key] ? "true" : "false"}
                  onChange={(e) => updateRow(i, { [c.key]: e.target.value === "true" })}
                  className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs"
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : (
                <Input value={String(r[c.key] ?? "")} onChange={(e) => updateRow(i, { [c.key]: e.target.value })} className="text-xs" />
              )}
            </div>
          ))}
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, blankRow()])} className="w-full justify-center">
        <Plus className="w-3.5 h-3.5" />
        Add Row
      </Button>
    </div>
  );
}

/**
 * Renders only the "prompt"-sourced fields a resolved action requires --
 * "shipment.<path>" fields are resolved automatically server-side and never
 * shown here. Nothing in this component is specific to CANCEL/AMENDMENT or
 * to any country; it's driven entirely by whatever FilingActionDataRequirement
 * resolved for this filing's (country, procedure, messageName, action).
 */
function ActionFieldPrompts({
  fields,
  values,
  onChange,
}: {
  fields: ActionFieldEntry[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const promptFields = fields.filter((f) => f.source === "prompt");
  if (promptFields.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-border pt-3 mt-1">
      {promptFields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label className="text-xs font-bold text-ink-muted">
            {f.label}
            {f.required && " *"}
          </label>
          {f.type === "boolean" ? (
            <select
              value={values[f.key] ? "true" : "false"}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value === "true" })}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm"
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          ) : f.type === "grid" ? (
            <ActionFieldGridEditor
              columns={f.columns ?? []}
              rows={(values[f.key] as Record<string, unknown>[] | undefined) ?? []}
              onChange={(rows) => onChange({ ...values, [f.key]: rows })}
            />
          ) : (
            <Input
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              value={String(values[f.key] ?? "")}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
          )}
          {f.helpText && <p className="text-[11px] text-ink-muted">{f.helpText}</p>}
        </div>
      ))}
    </div>
  );
}

const STAGE_STYLES: Record<FilingStageState, string> = {
  complete: "border-emerald-500 bg-emerald-50 text-emerald-800",
  current: "border-brand bg-blue-50 text-blue-900 font-bold",
  blocked: "border-red-300 bg-red-50 text-red-800",
  pending: "border-border bg-surface-muted text-ink-muted",
};

const STAGE_STATE_LABELS: Record<FilingStageState, string> = {
  complete: "Completed",
  current: "In progress",
  blocked: "Blocked",
  pending: "Pending",
};

type LineItemEdit = { htsCode: string; countryOfOrigin: string };

type Tab = "overview" | "declaration" | "response" | "form7501" | "psc";

function messageActionLabel(m: MessageProps): string {
  if (m.direction !== "OUTBOUND") return "Response";
  const name = m.messageName.replace(/^CUSTOMS_DECLARATION_/, "");
  return name
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function messageEnvelopeParts(m: MessageProps): { header: Record<string, unknown>; data: Record<string, unknown> } {
  const env = (m.envelope ?? {}) as { header?: Record<string, unknown>; data?: Record<string, unknown> };
  return { header: env.header ?? {}, data: env.data ?? {} };
}

function humanizeExtensionKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Renders whatever shape FilingActionDataRequirement's resolved extensions
 * happen to be for this action/context -- scalars, and grids nested to any
 * depth (e.g. GoodsItem rows each containing a Packages grid) -- without the
 * renderer needing to know that shape in advance.
 */
function ExtensionValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-muted">—</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-ink">{value ? "Yes" : "No"}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-muted">—</span>;
    if (value.every((v) => v === null || typeof v !== "object")) {
      return <span className="text-ink">{value.map((v) => String(v)).join(", ")}</span>;
    }
    const rowKeys = Array.from(
      new Set(value.flatMap((row) => (row && typeof row === "object" ? Object.keys(row as object) : [])))
    );
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[360px]">
          <thead>
            <tr className="text-left text-[9px] font-bold uppercase text-ink-muted border-b border-border">
              {rowKeys.map((k) => (
                <th key={k} className="px-2 py-1.5">{humanizeExtensionKey(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i} className="border-b border-border/60 align-top">
                {rowKeys.map((k) => (
                  <td key={k} className="px-2 py-1.5">
                    <ExtensionValue value={(row as Record<string, unknown>)?.[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-ink-muted">—</span>;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-ink-muted">{humanizeExtensionKey(k)}:</span> <ExtensionValue value={v} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-ink">{String(value)}</span>;
}

function ExtensionFieldsView({ extensions }: { extensions: Record<string, unknown> }) {
  const entries = Object.entries(extensions);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-extrabold text-ink uppercase tracking-wider">Additional Fields</h4>
      <div className="space-y-3 text-xs p-3 rounded-xl bg-surface-muted border border-border">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-1">
            <div className="font-bold text-ink">{humanizeExtensionKey(key)}</div>
            <ExtensionValue value={value} />
          </div>
        ))}
      </div>
    </div>
  );
}

// No customs-authority native-format (EDIFACT/XML/etc.) generator exists in this
// codebase yet -- every message stays canonical JSON end to end. This renders a
// readable, clearly-labeled preview derived from the canonical envelope so the
// "Customs File" action has something honest to show until a real per-authority
// generator is built.
function renderCustomsFileStub(m: MessageProps): string {
  const { header, data } = messageEnvelopeParts(m);
  const lines: string[] = [];
  lines.push(`UNH+${String(header.messageId ?? "")}+${String(header.messageName ?? "")}`);
  lines.push(`AUTHORITY+${String(header.authority ?? header.country ?? "")}`);
  lines.push(`PROCEDURE+${String(header.procedure ?? "")}`);
  lines.push(`DTM+${String(header.dateTime ?? "")}`);
  if (header.correlationId) lines.push(`RFF+${String(header.correlationId)}`);
  const declaration = data.declaration as Record<string, unknown> | undefined;
  if (declaration) {
    lines.push(`ENT+${String(declaration.declarationId ?? "")}+${String(declaration.entryType ?? "")}`);
    const lineItems = (declaration.lineItems as Array<Record<string, unknown>> | undefined) ?? [];
    lineItems.forEach((li) => {
      lines.push(`LIN+${String(li.lineNumber ?? "")}+${String(li.hsCode6 ?? "")}+${String(li.totalValue ?? "")}`);
    });
  }
  if (data.status) {
    lines.push(`STA+${String(data.status)}`);
    if (data.authorityReference) lines.push(`RFF+${String(data.authorityReference)}`);
  }
  lines.push("UNT");
  return lines.join("\n");
}

function errorFromResponse(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error?: { message?: string } | string }).error;
    if (typeof err === "string") return err;
    if (err && typeof err.message === "string") return err.message;
  }
  return fallback;
}

export function FilingDetailClient({
  filing,
  shipment,
  lineItems,
  documents,
  responses,
  messages,
  auditLogs = [],
  allowUpdates,
  canValidate,
  canApprove,
  canTransmit,
  canResubmit,
  childActions,
}: FilingDetailClientProps) {
  const router = useRouter();
  
  // Get country-specific configuration for multi-country support
  const country = filing.country || shipment?.destinationCountry || "US";
  const config = getFilingConfig(country);
  
  type Tab = "overview" | "declaration" | "response" | "form7501" | "psc";
  const [tab, setTab] = useState<Tab>("overview");
  const [edits, setEdits] = useState<Record<string, LineItemEdit>>(() =>
    Object.fromEntries((lineItems || []).map((li) => [li.id, { htsCode: li.htsCode, countryOfOrigin: li.countryOfOrigin }]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationBlockers, setValidationBlockers] = useState<Array<{ field: string; rule: string; message: string }>>([]);
  const [form7501Data, setForm7501Data] = useState<Record<string, unknown> | null>(null);
  const [form7501Loading, setForm7501Loading] = useState(false);
  const [form7501Error, setForm7501Error] = useState<string | null>(null);
  const [provenanceDetail, setProvenanceDetail] = useState<Record<string, unknown> | null>(null);
  /** Action code (e.g. "CANCEL") pending confirmation, or null when no modal is open. */
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [messageView, setMessageView] = useState<{ message: MessageProps; mode: "structured" | "json" | "file" } | null>(null);
  const [actionFields, setActionFields] = useState<ActionFieldEntry[] | null>(null);
  const [actionFieldsLoading, setActionFieldsLoading] = useState(false);
  const [promptedValues, setPromptedValues] = useState<Record<string, unknown>>({});

  // Local Reference and Registration Number state
  const [localReferenceNumber, setLocalReferenceNumber] = useState<string>(
    filing.localReferenceNumber || filing.entryNumber
  );
  const [registrationNumber, setRegistrationNumber] = useState<string>(
    filing.registrationNumber || ''
  );

  // Declaration form state - initialize from saved draft if available
  const [declarationData, setDeclarationData] = useState<Record<string, any>>(() => {
    console.log('🔍 Initializing declarationData, filing.declarationDraft:', filing.declarationDraft);
    if (filing.declarationDraft) {
      // Check if data is wrapped in ImportDeclaration/ExportDeclaration
      if (filing.declarationDraft.ImportDeclaration) {
        console.log('✅ Unwrapping ImportDeclaration:', filing.declarationDraft.ImportDeclaration);
        return filing.declarationDraft.ImportDeclaration;
      } else if (filing.declarationDraft.ExportDeclaration) {
        console.log('✅ Unwrapping ExportDeclaration:', filing.declarationDraft.ExportDeclaration);
        return filing.declarationDraft.ExportDeclaration;
      }
      // Otherwise return as-is
      console.log('⚠️ No wrapper found, returning as-is');
      return filing.declarationDraft;
    }
    // Default empty structure for new filings
    console.log('⚠️ No declarationDraft, using defaults');
    return {
      declarationId: '',
      entryType: '',
      importer: { name: '', country: '', taxId: '' },
      exporter: { name: '', country: '', taxId: '' },
      filer: { name: '', country: '', taxId: '' },
      transport: { mode: '', carrierName: '', vessel: '', portOfEntry: '', arrivalDate: '' },
      currency: '',
      incoterm: '',
      valuation: { method: '', totalValue: 0 },
      totals: { customsValue: 0, dutyAmount: 0, feesAmount: 0 },
      compliance: { screeningCleared: false, licensesRequired: '' },
      evidence: { classificationRationale: '', originCriterion: '', sourceDocumentIds: '' },
    };
  });

  useEffect(() => {
    if (!confirmAction) {
      setActionFields(null);
      setPromptedValues({});
      return;
    }
    const def = CHILD_ACTION_REGISTRY[confirmAction];
    if (!def) return;
    let cancelled = false;
    setActionFieldsLoading(true);
    fetch(`/api/filing/${filing.id}/action-fields?action=${encodeURIComponent(def.messageAction)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setActionFields(data?.fields ?? []);
      })
      .catch(() => {
        if (!cancelled) setActionFields([]);
      })
      .finally(() => {
        if (!cancelled) setActionFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmAction, filing.id]);

  // Load existing declaration data
  useEffect(() => {
    async function loadDeclaration() {
      try {
        const res = await fetch(`/api/filing/${filing.id}/declaration`);
        if (res.ok) {
          const data = await res.json();
          if (data.declarationData) {
            setDeclarationData(data.declarationData);
          }
        }
      } catch (err) {
        console.error('Failed to load declaration data:', err);
      }
    }
    loadDeclaration();
  }, [filing.id]);

  const stages = filingStages(filing.filingStatus);
  const stageDates: Record<string, string | null> = {
    prepare: filing.createdAt,
    review: null,
    transmit: filing.submittedAt,
    clearance: filing.releasedAt,
  };

  const changedLineItems = useMemo(
    () =>
      (lineItems || [])
        .filter((li) => edits[li.id] && (edits[li.id].htsCode !== li.htsCode || edits[li.id].countryOfOrigin !== li.countryOfOrigin))
        .map((li) => ({ id: li.id, htsCode: edits[li.id].htsCode, countryOfOrigin: edits[li.id].countryOfOrigin })),
    [lineItems, edits]
  );

  const latestOutbound = [...messages].reverse().find((m) => m.direction === "OUTBOUND") ?? null;
  const latestInbound = [...messages].reverse().find((m) => m.direction === "INBOUND") ?? null;
  const declaration = latestOutbound
    ? (latestOutbound.envelope as { data?: { declaration?: Record<string, unknown> } }).data?.declaration
    : null;
  const inboundData = latestInbound
    ? (latestInbound.envelope as { data?: { authorityReference?: string; humanMessage?: string } }).data
    : null;

  async function saveLineItemEdits(): Promise<boolean> {
    if (changedLineItems.length === 0) return true;
    const res = await fetch(`/api/shipments/${shipment?.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineItems: changedLineItems }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(errorFromResponse(data, "Saving declaration corrections failed."));
    }
    return true;
  }

  async function handleSave() {
    setBusy("save");
    setError(null);
    setSuccess(null);
    try {
      await saveLineItemEdits();
      setSuccess("Declaration corrections saved.");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    setBusy("validate");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/filing/${filing.id}/validate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Validation failed."));
      const blockers: Array<{ field: string; rule: string; message: string }> = data?.validation?.blockers ?? [];
      setValidationBlockers(blockers);
      setSuccess(
        data?.validation?.valid
          ? "Validation passed — ready for broker review."
          : `Validation failed: ${blockers[0]?.message ?? "see blockers below."}`
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadForm7501() {
    setForm7501Loading(true);
    setForm7501Error(null);
    try {
      const res = await fetch(`/api/filing/${filing.id}/entry-summary`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Failed to load 7501 data."));
      setForm7501Data(data?.form7501 ?? null);
    } catch (err: unknown) {
      setForm7501Error(err instanceof Error ? err.message : String(err));
    } finally {
      setForm7501Loading(false);
    }
  }

  async function handleApprove() {
    setBusy("approve");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/filing/${filing.id}/approve`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Approval failed."));
      setSuccess("Filing approved for transmission.");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleTransmit() {
    // Validate local reference number is provided
    if (!localReferenceNumber || localReferenceNumber.trim() === '') {
      setError('Local Reference Number is required for transmission');
      return;
    }

    setBusy("transmit");
    setError(null);
    setSuccess(null);
    try {
      // First save local reference and registration numbers
      const refRes = await fetch(`/api/filing/${filing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          localReferenceNumber,
          registrationNumber 
        }),
      });
      if (!refRes.ok) {
        const refData = await refRes.json();
        throw new Error(refData.error?.message || refData.error || 'Failed to save reference numbers');
      }

      // Then transmit
      const res = await fetch(`/api/filing/${filing.id}/transmit`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Transmit failed."));
      setSuccess(
        data?.transmission?.mockResponseApplied
          ? `Filing transmitted. A simulated ${filing.authority} response has been received — see the Response tab.`
          : `Filing transmitted. The ${filing.authority} response will appear here once received.`
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDeclarationDraft() {
    // Validate local reference number is provided
    if (!localReferenceNumber || localReferenceNumber.trim() === '') {
      setError('Local Reference Number is required');
      return;
    }

    setBusy("saveDraft");
    setError(null);
    setSuccess(null);
    try {
      // First save local reference and registration numbers
      const refRes = await fetch(`/api/filing/${filing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          localReferenceNumber,
          registrationNumber 
        }),
      });
      if (!refRes.ok) {
        const refData = await refRes.json();
        throw new Error(refData.error?.message || refData.error || 'Failed to save reference numbers');
      }

      // Then save declaration data
      const res = await fetch(`/api/filing/${filing.id}/declaration`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declarationData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Failed to save draft');
      setSuccess('Declaration draft saved successfully!');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Helper to update nested declaration data
  function updateDeclarationField(path: string, value: any) {
    setDeclarationData((prev) => {
      const keys = path.split('.');
      const newData = { ...prev };
      let current: any = newData;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newData;
    });
  }

  function handleGenerateAuditRoom() {
    setSuccess("Downloading Focused Assessment Audit Room binder (.zip)...");
    window.open(`/api/audit/room/${filing.id}?format=zip`, "_blank");
  }

  function handleExportFilingZip() {
    setSuccess("Downloading complete Filing package (.zip)...");
    window.open(`/api/filing/${filing.id}/export`, "_blank");
  }

  function handleDownload7501Pdf() {
    setSuccess("Downloading CBP Form 7501 PDF...");
    window.open(`/api/filing/${filing.id}/entry-summary?format=pdf`, "_blank");
  }

  function handleDownload7501Zip() {
    setSuccess("Downloading CBP Form 7501 Package (.zip)...");
    window.open(`/api/filing/${filing.id}/entry-summary?format=zip`, "_blank");
  }

  async function handleSaveAndResubmit() {
    setBusy("resubmit");
    setError(null);
    setSuccess(null);
    try {
      await saveLineItemEdits();
      const res = await fetch(`/api/filing/${filing.id}/resubmit`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Resubmit failed."));
      setSuccess(
        data?.resubmission?.mockResponseApplied
          ? `Corrections saved, filing resubmitted, and a simulated ${filing.authority} response has been received.`
          : "Corrections saved and filing resubmitted."
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleChildAction(action: string) {
    const def = CHILD_ACTION_REGISTRY[action];
    if (!def) return;
    setBusy(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/filing/${filing.id}/${def.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptedValues }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, `${def.label} failed.`));
      const result = data?.[def.responseKey];
      setSuccess(
        result?.mockResponseApplied ? `${def.successMessage} Response received — see the Response tab.` : def.successMessage
      );
      setConfirmAction(null);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <Link href="/app/filing" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
        <ArrowLeft className="w-3.5 h-3.5" />
        All Filings
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">{filing.localReferenceNumber || filing.entryNumber}</h1>
            <Badge variant={statusBadgeVariant(filing.filingStatus)}>{filing.filingStatus}</Badge>
          </div>
          <p className="text-xs text-ink-muted">
            {shipment ? (
              <>
                {displayText(shipment.importerName)} &middot; {displayText(shipment.destinationCountry)} &middot;{" "}
                {filing.filingType}
              </>
            ) : (
              <>
                {filing.country} &middot; {filing.procedureCode} &middot; {filing.messageName} &middot; {filing.filingType}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canValidate && (
            <Button variant="secondary" onClick={handleValidate} loading={busy === "validate"} disabled={busy !== null}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Run Pre-Filing Validation
            </Button>
          )}
          {canApprove && (
            <Button onClick={handleApprove} loading={busy === "approve"} disabled={busy !== null}>
              <ShieldCheck className="w-3.5 h-3.5" />
              Approve for Transmission
            </Button>
          )}
          <span
            title={
              !canTransmit
                ? `Filing cannot be transmitted in current status (${filing.filingStatus}). Pre-filing validation or broker approval required.`
                : validationBlockers.length > 0
                ? `Cannot transmit: ${validationBlockers.map((b) => b.message).join("; ")}`
                : "Transmit entry to Customs authority"
            }
          >
            <Button
              onClick={handleTransmit}
              loading={busy === "transmit"}
              disabled={!canTransmit || busy !== null || validationBlockers.length > 0}
            >
              <Send className="w-3.5 h-3.5" />
              Transmit to Customs
            </Button>
          </span>
          {allowUpdates && (
            <Button
              variant="secondary"
              onClick={handleSave}
              loading={busy === "save"}
              disabled={busy !== null || changedLineItems.length === 0}
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </Button>
          )}
          {allowUpdates && canResubmit && (
            <Button onClick={handleSaveAndResubmit} loading={busy === "resubmit"} disabled={busy !== null}>
              <RotateCcw className="w-3.5 h-3.5" />
              Save & Resubmit
            </Button>
          )}
          <Button variant="secondary" onClick={handleExportFilingZip} disabled={busy !== null}>
            <FolderArchive className="w-3.5 h-3.5 text-brand" />
            Export Filing ZIP
          </Button>
          <Button variant="secondary" onClick={handleGenerateAuditRoom} disabled={busy !== null}>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Audit Room Binder ZIP
          </Button>
          {(childActions || []).map((action) => {
            const def = CHILD_ACTION_REGISTRY[action];
            if (!def) return null;
            const Icon = def.icon;
            return (
              <Button key={action} variant={def.variant} onClick={() => setConfirmAction(action)} disabled={busy !== null}>
                <Icon className="w-3.5 h-3.5" />
                {def.label}
              </Button>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {success}
        </p>
      )}

      {validationBlockers.length > 0 && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Filing blocked — resolve before transmitting</p>
          <ul className="space-y-1">
            {validationBlockers.map((b) => (
              <li key={b.rule} className="text-xs text-amber-900 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-600" />
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filing Information - Always visible above tabs */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-xs font-bold text-ink mb-3">Filing Information</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-ink-muted font-bold">Country</span>
            <p className="text-ink font-mono">{filing.country || "—"}</p>
          </div>
          <div>
            <span className="text-ink-muted font-bold">Procedure Code</span>
            <p className="text-ink font-mono">{filing.procedureCode || "—"}</p>
          </div>
          <div>
            <span className="text-ink-muted font-bold">Message Name</span>
            <p className="text-ink font-mono">{filing.messageName || "—"}</p>
          </div>
        </div>
      </div>

      {/* Local Reference Number and Registration Number */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="localReferenceNumber" className="text-xs font-bold text-ink">
              Local Reference Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="localReferenceNumber"
              type="text"
              value={localReferenceNumber}
              onChange={(e) => setLocalReferenceNumber(e.target.value)}
              placeholder="Enter local reference number"
              className="mt-1"
              disabled={filing.filingStatus === "Transmitted" || filing.filingStatus === "Accepted"}
            />
            <p className="text-xs text-ink-muted mt-1">
              Defaults to entry number. Required for save and transmit.
            </p>
          </div>
          <div>
            <Label htmlFor="registrationNumber" className="text-xs font-bold text-ink">
              Registration Number
            </Label>
            <Input
              id="registrationNumber"
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="Enter registration number"
              className="mt-1"
              disabled={filing.filingStatus === "Transmitted" || filing.filingStatus === "Accepted"}
            />
            <p className="text-xs text-ink-muted mt-1">
              Optional registration or license number.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-border shadow-2xs w-fit">
        {(
          [
            ["overview", "Overview"],
            ["declaration", "Declaration"],
            ["response", "Response"],
            config.showForm7501 && ["form7501", config.formPreviewLabel || "7501 Preview"],
            config.showPSC && ["psc", config.postCorrectionLabel || "Post-Summary Correction"],
          ].filter(Boolean) as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              if (key === "form7501" && !form7501Data && !form7501Loading) loadForm7501();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tab === key ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Customs Filing Timeline & Audit Log</h2>
            {auditLogs && auditLogs.length > 0 ? (
              <div className="space-y-3">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between p-3 rounded-xl border border-border bg-surface-muted text-xs">
                    <div className="space-y-0.5">
                      <p className="font-bold text-ink">{log.action}</p>
                      <p className="text-[11px] text-ink-muted">
                        Actor: <span className="font-semibold text-ink">{log.actor}</span>
                        {log.details && typeof log.details === "object" && "notes" in log.details ? ` — ${String(log.details.notes)}` : null}
                      </p>
                    </div>
                    <span className="text-[10px] font-medium text-ink-muted shrink-0">{displayDate(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
                {(stages || []).map((stage, index) => {
                  const at = stageDates[stage.key];
                  return (
                    <div key={stage.key} className={`p-4 rounded-xl border ${STAGE_STYLES[stage.state]} space-y-1`}>
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-sm">Step {index + 1}</span>
                        <span className="text-[10px] uppercase font-bold">{STAGE_STATE_LABELS[stage.state]}</span>
                      </div>
                      <p className="font-bold text-ink">{stage.label}</p>
                      {at ? <p className="text-[10px] text-ink-muted">{displayDate(at)}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Card className="space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">{config.entrySummaryLabel}</h3>
                <p className="text-xs text-ink-muted">Filing Authority: {displayText(filing.authority) || config.authorityName}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-ink-muted">{config.entryTypeLabel}</p>
                <p className="font-bold text-ink">{displayText(filing.entryType)}</p>
              </div>
              <div>
                <p className="text-ink-muted">Filing Method</p>
                <p className="font-bold text-ink">{displayText(filing.filingType)}</p>
              </div>
              <div>
                <p className="text-ink-muted">Payment Status</p>
                <p className={`font-bold ${filing.paymentStatus === "Paid" ? "text-emerald-600" : "text-ink"}`}>
                  {displayText(filing.paymentStatus)}
                </p>
              </div>
              <div>
                <p className="text-ink-muted">Entered Value</p>
                <p className="font-bold text-ink">{formatCurrencyAmount(filing.totalValue, config.currency)}</p>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-border">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Duty & Tax Breakdown</h4>
              {!filing.dutyBreakdown || !Array.isArray(filing.dutyBreakdown) || filing.dutyBreakdown.length === 0 ? (
                <p className="text-xs text-ink-muted">No duty or fee lines have been calculated for this entry yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="pb-2">Duty Fee Item</th>
                      <th className="pb-2">Calculation Rate</th>
                      <th className="pb-2 text-right">Amount ({config.currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filing.dutyBreakdown.map((duty, idx) => (
                      <tr key={idx} className="hover:bg-surface-muted">
                        <td className="py-2.5 font-semibold text-ink">{duty.feeName}</td>
                        <td className="py-2.5 text-ink-muted">{duty.rate}</td>
                        <td className="py-2.5 text-right font-bold text-ink">{formatCurrencyAmount(duty.amount, config.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex justify-end pt-3 border-t border-border text-xs text-right">
                <div>
                  <p className="text-ink-muted">
                    Total Duties: <span className="font-bold text-ink">{formatCurrencyAmount(filing.totalDuties, config.currency)}</span>
                  </p>
                  <p className="text-ink-muted">
                    Total Taxes: <span className="font-bold text-ink">{formatCurrencyAmount(filing.totalTaxes, config.currency)}</span>
                  </p>
                  <p className="font-extrabold text-sm text-brand mt-1">Total Due: {formatCurrencyAmount(filing.totalAmount, config.currency)}</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "declaration" && (
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Declaration Details</h3>
                <Badge variant="info">Draft</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleSaveDeclarationDraft}>
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
            </div>

            {/* Dynamic Form Renderer */}
            {filing.country && filing.procedureCode && filing.messageName ? (
              <DynamicFormRenderer
                country={filing.country}
                procedureCode={filing.procedureCode}
                messageName={filing.messageName}
                messageType="request"
                data={declarationData}
                onChange={updateDeclarationField}
                readOnly={false}
              />
            ) : (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs text-yellow-800">
                  Unable to load declaration form. Missing country, procedure code, or message name.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "response" && (
        <div className="space-y-6">
          <Card className="space-y-4">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Latest Status</h3>
            {responses.length === 0 ? (
              <p className="text-xs text-ink-muted">No response has been received from customs yet.</p>
            ) : (
              <div className="p-4 rounded-xl bg-surface-muted border border-border space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink">{responses[0].title}</span>
                  <Badge variant={statusBadgeVariant(responses[0].status) ?? "neutral"}>{responses[0].code}</Badge>
                </div>
                <p className="text-ink-muted">{responses[0].description}</p>
                {inboundData?.authorityReference && (
                  <p className="text-ink-muted">
                    Authority Reference: <span className="font-mono text-ink">{inboundData.authorityReference}</span>
                  </p>
                )}
                <p className="text-[10px] text-ink-muted">Received {displayDate(responses[0].receivedAt)}</p>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">
              Declarations &amp; Responses ({messages.length})
            </h3>
            {messages.length === 0 ? (
              <p className="text-xs text-ink-muted">No canonical messages have been exchanged for this filing yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-xs border-collapse min-w-[720px]">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase text-ink-muted border-b border-border">
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Direction</th>
                      <th className="px-2 py-2">Message Name</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Linked To</th>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(messages || [])
                      .slice()
                      .reverse()
                      .map((m) => {
                        const linkedId = m.correlationId ?? m.priorMessageId;
                        return (
                          <tr key={m.id} className="border-b border-border/60 hover:bg-surface-muted/60">
                            <td className="px-2 py-2 font-semibold text-ink whitespace-nowrap">
                              {messageActionLabel(m)}
                              {m.priorMessageId && m.direction === "OUTBOUND" && (
                                <span className="ml-1.5 text-[9px] font-bold uppercase text-ink-muted">(child)</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <Badge variant={m.direction === "OUTBOUND" ? "info" : "neutral"}>{m.direction}</Badge>
                            </td>
                            <td className="px-2 py-2 font-mono text-[11px] text-ink-muted whitespace-nowrap">{m.messageName}</td>
                            <td className="px-2 py-2">
                              {m.status ? <Badge variant={statusBadgeVariant(m.status) ?? "neutral"}>{m.status}</Badge> : <span className="text-ink-muted">—</span>}
                            </td>
                            <td className="px-2 py-2 font-mono text-[10px] text-ink-muted whitespace-nowrap">
                              {linkedId ? `${linkedId.slice(0, 10)}…` : "—"}
                            </td>
                            <td className="px-2 py-2 text-ink-muted whitespace-nowrap">{displayDate(m.createdAt)}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button variant="secondary" size="sm" onClick={() => setMessageView({ message: m, mode: "structured" })}>
                                  View
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setMessageView({ message: m, mode: "json" })}>
                                  JSON
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setMessageView({ message: m, mode: "file" })}>
                                  Customs File
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {messageView && (() => {
        const m = messageView.message;
        const { header, data } = messageEnvelopeParts(m);
        const declaration = data.declaration as Record<string, unknown> | undefined;
        const titles = { structured: "Message Detail", json: "Raw Canonical JSON", file: "Customs File Preview" } as const;
        return (
          <Modal isOpen onClose={() => setMessageView(null)} titleId="message-view-title">
            <ModalHeader
              titleId="message-view-title"
              title={`${titles[messageView.mode]} — ${messageActionLabel(m)}`}
              onClose={() => setMessageView(null)}
            />
            <ModalBody className="space-y-3">
              {messageView.mode === "json" && (
                <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px]">
                  {JSON.stringify(m.envelope, null, 2)}
                </pre>
              )}

              {messageView.mode === "file" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-ink-muted">
                    Preview only — derived from the canonical envelope. No authority-certified native format generator
                    is configured for this filing system yet.
                  </p>
                  <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap">
                    {renderCustomsFileStub(m)}
                  </pre>
                </div>
              )}

              {messageView.mode === "structured" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs p-3 rounded-xl bg-surface-muted border border-border">
                    <div><span className="text-ink-muted">Message ID:</span> <span className="font-mono text-ink">{String(header.messageId ?? "—")}</span></div>
                    <div><span className="text-ink-muted">Direction:</span> <span className="text-ink">{m.direction}</span></div>
                    <div><span className="text-ink-muted">Country:</span> <span className="text-ink">{String(header.country ?? "—")}</span></div>
                    <div><span className="text-ink-muted">Procedure:</span> <span className="text-ink">{String(header.procedure ?? "—")}</span></div>
                    <div><span className="text-ink-muted">Authority:</span> <span className="text-ink">{String(header.authority ?? "—")}</span></div>
                    <div><span className="text-ink-muted">Date/Time:</span> <span className="text-ink">{header.dateTime ? displayDate(String(header.dateTime)) : "—"}</span></div>
                  </div>

                  {declaration && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-extrabold text-ink uppercase tracking-wider">Declaration</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs p-3 rounded-xl bg-surface-muted border border-border">
                        <div><span className="text-ink-muted">Declaration ID:</span> <span className="font-mono text-ink">{String(declaration.declarationId ?? "—")}</span></div>
                        <div><span className="text-ink-muted">Entry Type:</span> <span className="text-ink">{String(declaration.entryType ?? "—")}</span></div>
                        <div><span className="text-ink-muted">Importer:</span> <span className="text-ink">{String((declaration.importer as Record<string, unknown> | undefined)?.name ?? "—")}</span></div>
                        <div><span className="text-ink-muted">Exporter:</span> <span className="text-ink">{String((declaration.exporter as Record<string, unknown> | undefined)?.name ?? "—")}</span></div>
                        <div><span className="text-ink-muted">Currency:</span> <span className="text-ink">{String(declaration.currency ?? "—")}</span></div>
                        <div><span className="text-ink-muted">Customs Value:</span> <span className="text-ink">{displayCurrency((declaration.totals as Record<string, unknown> | undefined)?.customsValue as number | undefined ?? null)}</span></div>
                      </div>
                      {Array.isArray(declaration.lineItems) && declaration.lineItems.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] border-collapse min-w-[480px]">
                            <thead>
                              <tr className="text-left text-[9px] font-bold uppercase text-ink-muted border-b border-border">
                                <th className="px-2 py-1.5">Line</th>
                                <th className="px-2 py-1.5">Description</th>
                                <th className="px-2 py-1.5">HS Code</th>
                                <th className="px-2 py-1.5">Origin</th>
                                <th className="px-2 py-1.5 text-right">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(declaration.lineItems as Array<Record<string, unknown>>).map((li, i) => (
                                <tr key={i} className="border-b border-border/60">
                                  <td className="px-2 py-1.5">{String(li.lineNumber ?? i + 1)}</td>
                                  <td className="px-2 py-1.5">{String(li.description ?? "—")}</td>
                                  <td className="px-2 py-1.5 font-mono">{String(li.hsCode6 ?? "—")}</td>
                                  <td className="px-2 py-1.5">{String(li.originCountry ?? "—")}</td>
                                  <td className="px-2 py-1.5 text-right">{displayCurrency(li.totalValue as number | undefined ?? null)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {Boolean(declaration.extensions) && Object.keys(declaration.extensions as object).length > 0 && (
                        <ExtensionFieldsView extensions={declaration.extensions as Record<string, unknown>} />
                      )}
                    </div>
                  )}

                  {data.status !== undefined && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-extrabold text-ink uppercase tracking-wider">Response</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs p-3 rounded-xl bg-surface-muted border border-border">
                        <div><span className="text-ink-muted">Status:</span> <Badge variant={statusBadgeVariant(String(data.status)) ?? "neutral"}>{String(data.status)}</Badge></div>
                        <div><span className="text-ink-muted">Authority Reference:</span> <span className="font-mono text-ink">{String(data.authorityReference ?? "—")}</span></div>
                        <div className="col-span-2"><span className="text-ink-muted">Message:</span> <span className="text-ink">{String(data.humanMessage ?? "—")}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setMessageView(null)}>Close</Button>
            </ModalFooter>
          </Modal>
        );
      })()}

      {tab === "form7501" && (
        <div className="space-y-4">
          {form7501Loading && (
            <p className="text-xs text-ink-muted animate-pulse">Loading 7501 field data…</p>
          )}
          {form7501Error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {form7501Error}
            </p>
          )}
          {!form7501Data && !form7501Loading && !form7501Error && (
            <Card className="text-center py-10 space-y-2">
              <p className="text-xs text-ink-muted">Click the 7501 Preview tab to load the structured form view.</p>
            </Card>
          )}
          {form7501Data && (() => {
            type F7Field = { block: string; label: string; value: unknown; status: string; provenance: { sourceModel: string; sourceId: string | null; sourceField: string; approvedByUserId?: string | null; approvedAt?: string | null } };
            type F7LineItem = { lineNumber: number; description: F7Field; htsCode: F7Field; enteredValue: F7Field; dutyRate: F7Field; dutyAmount: F7Field; countryOfOrigin: F7Field; quantity: F7Field };
            const f = form7501Data as {
              entryType: F7Field; entryNumber: F7Field; portCode: F7Field; importerName: F7Field; importerNumber: F7Field; bondNumber: F7Field; countryOfExport: F7Field; carrier: F7Field; totalEnteredValue: F7Field; totalDuty: F7Field; lineItems: F7LineItem[]; coverageStatus: { required: number; sourced: number; approved: number; missing: number }; generatedAt: string;
            };
            const statusColor = (s: string) =>
              s === "sourced_approved" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : s === "sourced_unapproved" ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-red-300 bg-red-50 text-red-900";
            const statusDot = (s: string) =>
              s === "sourced_approved" ? "bg-emerald-500"
              : s === "sourced_unapproved" ? "bg-amber-400"
              : "bg-red-500";
            const headerFields: F7Field[] = [f.entryType, f.entryNumber, f.portCode, f.importerName, f.importerNumber, f.bondNumber, f.countryOfExport, f.carrier];
            return (
              <div className="space-y-6">
                {/* 7501 Export Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-border shadow-2xs">
                  <div>
                    <h3 className="text-sm font-extrabold text-ink">CBP Form 7501 Document Export</h3>
                    <p className="text-xs text-ink-muted">Official Entry Summary printable PDF and structured filing ZIP archive</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={handleDownload7501Pdf}>
                      <Download className="w-3.5 h-3.5" />
                      Download 7501 PDF
                    </Button>
                    <Button variant="secondary" onClick={handleDownload7501Zip}>
                      <FolderArchive className="w-3.5 h-3.5 text-brand" />
                      Export 7501 Package (ZIP)
                    </Button>
                  </div>
                </div>

                {/* Coverage summary */}
                <Card className="space-y-3">
                  <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Form 7501 Field Coverage</h3>
                  <div className="flex gap-6 text-xs flex-wrap">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Approved: {f.coverageStatus.approved}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Unapproved: {f.coverageStatus.sourced - f.coverageStatus.approved}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Missing: {f.coverageStatus.missing}</span>
                    <span className="text-ink-muted">Total required: {f.coverageStatus.required}</span>
                  </div>
                  <p className="text-[10px] text-ink-muted">Generated {f.generatedAt ? new Date(f.generatedAt).toLocaleString() : "—"}</p>
                </Card>

                {/* Header fields */}
                <Card className="space-y-3">
                  <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Header Blocks</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {headerFields.map((field) => (
                      <button
                        key={field.block}
                        type="button"
                        onClick={() => setProvenanceDetail(field.provenance as Record<string, unknown>)}
                        className={`rounded-xl border p-3 text-left space-y-1 cursor-pointer hover:shadow-sm transition-shadow ${statusColor(field.status)}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Block {field.block}</span>
                          <span className={`w-2 h-2 rounded-full ${statusDot(field.status)}`} />
                        </div>
                        <p className="text-[10px] opacity-70">{field.label}</p>
                        <p className="text-sm font-bold truncate">{field.value !== null && field.value !== undefined ? String(field.value) : "—"}</p>
                      </button>
                    ))}
                  </div>
                </Card>

                {/* Total blocks */}
                <Card className="space-y-3">
                  <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Totals</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[f.totalEnteredValue, f.totalDuty].map((field) => (
                      <button
                        key={field.block}
                        type="button"
                        onClick={() => setProvenanceDetail(field.provenance as Record<string, unknown>)}
                        className={`rounded-xl border p-3 text-left space-y-1 cursor-pointer hover:shadow-sm transition-shadow ${statusColor(field.status)}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Block {field.block}</span>
                          <span className={`w-2 h-2 rounded-full ${statusDot(field.status)}`} />
                        </div>
                        <p className="text-[10px] opacity-70">{field.label}</p>
                        <p className="text-sm font-bold">{field.value !== null ? `$${Number(field.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</p>
                      </button>
                    ))}
                  </div>
                </Card>

                {/* Line items */}
                {f.lineItems.length > 0 && (
                  <Card className="space-y-4">
                    <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Line Items (Blocks 27–35)</h3>
                    <div className="space-y-4">
                      {f.lineItems.map((li) => {
                        const lineFields: F7Field[] = [li.description, li.htsCode, li.enteredValue, li.dutyRate, li.dutyAmount, li.countryOfOrigin, li.quantity];
                        return (
                          <div key={li.lineNumber} className="space-y-2">
                            <p className="text-xs font-bold text-ink">Line {li.lineNumber}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {lineFields.map((field) => (
                                <button
                                  key={`${li.lineNumber}-${field.block}`}
                                  type="button"
                                  onClick={() => setProvenanceDetail(field.provenance as Record<string, unknown>)}
                                  className={`rounded-lg border p-2 text-left space-y-0.5 cursor-pointer hover:shadow-sm transition-shadow ${statusColor(field.status)}`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] font-bold uppercase opacity-70">Blk {field.block}</span>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot(field.status)}`} />
                                  </div>
                                  <p className="text-[9px] opacity-70 truncate">{field.label}</p>
                                  <p className="text-xs font-bold truncate">
                                    {field.value !== null && field.value !== undefined
                                      ? field.block === "29" || field.block === "35"
                                        ? `$${Number(field.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : field.block === "34"
                                        ? `${(Number(field.value) * 100).toFixed(2)}%`
                                        : String(field.value)
                                      : "—"}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {/* Legend */}
                <p className="text-[10px] text-ink-muted">
                  Click any block to see its source record. Green = sourced and approved; amber = sourced but not approved; red = missing.
                  Mock provider active — this filing has not been transmitted to {config.authorityName}.
                </p>
              </div>
            );
          })()}

          {/* Provenance detail drawer */}
          {provenanceDetail && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setProvenanceDetail(null)}>
              <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl p-6 w-full sm:max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-ink">Field Provenance</h3>
                  <button type="button" onClick={() => setProvenanceDetail(null)} className="text-ink-muted hover:text-ink text-lg">&times;</button>
                </div>
                <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px]">
                  {JSON.stringify(provenanceDetail, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "psc" && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-extrabold text-ink">{config.postCorrectionLabel || "Post-Summary Correction"} Management</h3>
              <p className="text-xs text-ink-muted">{config.postCorrectionDescription}</p>
            </div>
            <Badge variant={filing.filingStatus === "Accepted" || filing.filingStatus === "Released" ? "success" : "warning"}>
              {filing.filingStatus === "Accepted" || filing.filingStatus === "Released" ? `Eligible for ${config.postCorrectionLabel || "Correction"}` : `Status: ${filing.filingStatus}`}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-surface-muted rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-ink-muted uppercase">Original Declared Duty</span>
              <p className="text-xl font-extrabold text-ink">{formatCurrencyAmount(filing.totalDuties, config.currency)}</p>
              <p className="text-xs text-ink-muted">Filing Entry #{filing.entryNumber}</p>
            </div>
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-emerald-800 uppercase">PSC Correction Window</span>
              <p className="text-sm font-bold text-emerald-900">300 Days Statutory Limit (19 CFR 174)</p>
              <p className="text-xs text-emerald-700">Must be filed prior to liquidation</p>
            </div>
          </div>
        </Card>
      )}

      {confirmAction && CHILD_ACTION_REGISTRY[confirmAction] && (() => {
        const def = CHILD_ACTION_REGISTRY[confirmAction];
        const ConfirmIcon = def.icon;
        return (
          <Modal
            isOpen
            onClose={() => setConfirmAction(null)}
            titleId="child-action-confirm-title"
            closeDisabled={busy === confirmAction}
          >
            <ModalHeader
              titleId="child-action-confirm-title"
              title={def.confirmTitle}
              subtitle={`Entry ${filing.entryNumber}`}
              icon={<ConfirmIcon className="w-4 h-4" />}
              onClose={() => setConfirmAction(null)}
              closeDisabled={busy === confirmAction}
            />
            <ModalBody>
              <p className="text-sm text-ink-muted">{def.confirmBody}</p>
              {actionFieldsLoading ? (
                <p className="text-xs text-ink-muted mt-3">Checking what this destination requires...</p>
              ) : (
                actionFields && (
                  <ActionFieldPrompts fields={actionFields} values={promptedValues} onChange={setPromptedValues} />
                )
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setConfirmAction(null)} disabled={busy === confirmAction}>
                Keep Filing
              </Button>
              <Button
                variant={def.variant}
                onClick={() => handleChildAction(confirmAction)}
                loading={busy === confirmAction}
                disabled={actionFieldsLoading}
              >
                {def.confirmLabel}
              </Button>
            </ModalFooter>
          </Modal>
        );
      })()}
    </div>
  );
}
