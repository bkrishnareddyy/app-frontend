"use client";

import { useMemo, useState } from "react";
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
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { displayCurrency, displayDate, displayText } from "@/lib/honest";
import { filingStages, type FilingStageState } from "@/modules/filings/filingStateMachine";

interface FilingProps {
  id: string;
  entryNumber: string;
  entryType: string;
  filingType: string;
  filingStatus: string;
  paymentStatus: string;
  authority: string;
  totalValue: number | null;
  totalDuties: number | null;
  totalTaxes: number | null;
  totalAmount: number | null;
  dutyBreakdown: { feeName: string; amount: number; rate: string }[];
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

interface FilingDetailClientProps {
  filing: FilingProps;
  shipment: ShipmentProps;
  lineItems: LineItemProps[];
  documents: DocumentProps[];
  responses: ResponseProps[];
  messages: MessageProps[];
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
  },
};

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

type Tab = "overview" | "declaration" | "response";

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
  allowUpdates,
  canValidate,
  canApprove,
  canTransmit,
  canResubmit,
  childActions,
}: FilingDetailClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [edits, setEdits] = useState<Record<string, LineItemEdit>>(() =>
    Object.fromEntries(lineItems.map((li) => [li.id, { htsCode: li.htsCode, countryOfOrigin: li.countryOfOrigin }]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** Action code (e.g. "CANCEL") pending confirmation, or null when no modal is open. */
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [showRawPayload, setShowRawPayload] = useState(false);

  const stages = filingStages(filing.filingStatus);
  const stageDates: Record<string, string | null> = {
    prepare: filing.createdAt,
    review: null,
    transmit: filing.submittedAt,
    clearance: filing.releasedAt,
  };

  const changedLineItems = useMemo(
    () =>
      lineItems
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
    const res = await fetch(`/api/shipments/${shipment.id}`, {
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
      setSuccess(
        data?.validation?.isValid
          ? "Validation passed — ready for broker review."
          : `Validation failed: ${data?.validation?.exceptions?.[0]?.description ?? "see exceptions."}`
      );
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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
    setBusy("transmit");
    setError(null);
    setSuccess(null);
    try {
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
      const res = await fetch(`/api/filing/${filing.id}/${def.endpoint}`, { method: "POST" });
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
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Entry {filing.entryNumber}</h1>
            <Badge variant={statusBadgeVariant(filing.filingStatus)}>{filing.filingStatus}</Badge>
          </div>
          <p className="text-xs text-ink-muted">
            {displayText(shipment.importerName)} &middot; {displayText(shipment.destinationCountry)} &middot;{" "}
            {filing.filingType}
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
          {canTransmit && (
            <Button onClick={handleTransmit} loading={busy === "transmit"} disabled={busy !== null}>
              <Send className="w-3.5 h-3.5" />
              Transmit to Customs
            </Button>
          )}
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
          {childActions.map((action) => {
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

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-border shadow-2xs w-fit">
        {([
          ["overview", "Overview"],
          ["declaration", "Declaration"],
          ["response", "Response"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
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
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Customs Filing Timeline</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              {stages.map((stage, index) => {
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
          </div>

          <Card className="space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">Entry Summary</h3>
                <p className="text-xs text-ink-muted">Filing Authority: {displayText(filing.authority)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-ink-muted">Entry Type</p>
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
                <p className="font-bold text-ink">{displayCurrency(filing.totalValue)}</p>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-border">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Duty & Tax Breakdown</h4>
              {filing.dutyBreakdown.length === 0 ? (
                <p className="text-xs text-ink-muted">No duty or fee lines have been calculated for this entry yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="pb-2">Duty Fee Item</th>
                      <th className="pb-2">Calculation Rate</th>
                      <th className="pb-2 text-right">Amount (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filing.dutyBreakdown.map((duty, idx) => (
                      <tr key={idx} className="hover:bg-surface-muted">
                        <td className="py-2.5 font-semibold text-ink">{duty.feeName}</td>
                        <td className="py-2.5 text-ink-muted">{duty.rate}</td>
                        <td className="py-2.5 text-right font-bold text-ink">{displayCurrency(duty.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex justify-end pt-3 border-t border-border text-xs text-right">
                <div>
                  <p className="text-ink-muted">
                    Total Duties: <span className="font-bold text-ink">{displayCurrency(filing.totalDuties)}</span>
                  </p>
                  <p className="text-ink-muted">
                    Total Taxes: <span className="font-bold text-ink">{displayCurrency(filing.totalTaxes)}</span>
                  </p>
                  <p className="font-extrabold text-sm text-brand mt-1">Total Due: {displayCurrency(filing.totalAmount)}</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "declaration" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="space-y-3">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
                <Building2 className="w-4 h-4 text-brand" />
                Parties
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Importer</span>
                  <span className="font-medium text-ink">{displayText(shipment.importerName)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Country of Export</span>
                  <span className="font-medium text-ink">{displayText(shipment.countryOfExport)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted font-bold">Destination Country</span>
                  <span className="font-medium text-ink">{displayText(shipment.destinationCountry)}</span>
                </div>
              </div>
            </Card>

            <Card className="space-y-3">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
                <Truck className="w-4 h-4 text-brand" />
                Transport
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Carrier</span>
                  <span className="font-medium text-ink">{displayText(shipment.carrierName)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Port of Entry</span>
                  <span className="font-medium text-ink">{displayText(shipment.portOfEntry)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted font-bold">Incoterm</span>
                  <span className="font-mono font-bold text-brand">{displayText(shipment.incoterm)}</span>
                </div>
              </div>
            </Card>
          </div>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand" />
                Line Items
              </h3>
              {allowUpdates && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                  <AlertTriangle className="w-3 h-3" />
                  Editable — corrections required before resubmission
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-ink-muted">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Description</th>
                    <th className="pb-2 pr-3 text-right">Qty</th>
                    <th className="pb-2 pr-3 text-right">Unit Price</th>
                    <th className="pb-2 pr-3 text-right">Total Value</th>
                    <th className="pb-2 pr-3">Country of Origin</th>
                    <th className="pb-2">HTS Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineItems.map((li) => (
                    <tr key={li.id}>
                      <td className="py-2 pr-3 text-ink-muted">{li.lineNumber}</td>
                      <td className="py-2 pr-3 text-ink font-medium">{li.description}</td>
                      <td className="py-2 pr-3 text-right text-ink">{li.quantity}</td>
                      <td className="py-2 pr-3 text-right text-ink">{displayCurrency(li.unitPrice)}</td>
                      <td className="py-2 pr-3 text-right font-bold text-ink">{displayCurrency(li.totalValue)}</td>
                      <td className="py-2 pr-3">
                        {allowUpdates ? (
                          <Input
                            value={edits[li.id]?.countryOfOrigin ?? li.countryOfOrigin}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [li.id]: { ...prev[li.id], countryOfOrigin: e.target.value },
                              }))
                            }
                            className="w-28 py-1.5"
                          />
                        ) : (
                          <span className="text-ink">{li.countryOfOrigin}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {allowUpdates ? (
                          <Input
                            value={edits[li.id]?.htsCode ?? li.htsCode}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [li.id]: { ...prev[li.id], htsCode: e.target.value },
                              }))
                            }
                            className="w-32 py-1.5 font-mono"
                          />
                        ) : (
                          <span className="font-mono text-ink">{li.htsCode}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-3 border-t border-border text-xs text-right">
              <div className="space-y-1">
                <p className="text-ink-muted">
                  Customs Value: <span className="font-bold text-ink">{displayCurrency(filing.totalValue)}</span>
                </p>
                <p className="font-extrabold text-sm text-brand">Total Due: {displayCurrency(filing.totalAmount)}</p>
              </div>
            </div>
          </Card>

          <Card className="space-y-3">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Compliance & Evidence (as last transmitted)</h3>
            {declaration ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                  <p className="text-ink-muted font-bold">Compliance</p>
                  <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px]">
                    {JSON.stringify((declaration as { compliance?: unknown }).compliance ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="space-y-2">
                  <p className="text-ink-muted font-bold">Evidence</p>
                  <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px]">
                    {JSON.stringify((declaration as { evidence?: unknown }).evidence ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">Not yet transmitted — no declaration has been sent for this entry.</p>
            )}

            {documents.length > 0 && (
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-ink-muted font-bold text-xs">Source Documents</p>
                <ul className="space-y-1.5">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between text-xs">
                      <span className="text-ink font-medium">
                        {doc.fileName} <span className="text-ink-muted">({doc.docType})</span>
                      </span>
                      {doc.fileUrl ? (
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-brand font-semibold hover:underline">
                          View
                        </a>
                      ) : (
                        <span className="text-ink-muted">{doc.status}</span>
                      )}
                    </li>
                  ))}
                </ul>
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

          {responses.length > 1 && (
            <Card className="space-y-3">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">Response History</h3>
              <div className="space-y-2">
                {responses.map((resp) => (
                  <div key={resp.id} className="p-3 rounded-xl bg-surface-muted border border-border text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">{resp.title}</span>
                      <span className="text-[10px] text-ink-muted">{displayDate(resp.receivedAt)}</span>
                    </div>
                    <p className="text-ink-muted">{resp.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="space-y-3">
            <button
              type="button"
              onClick={() => setShowRawPayload((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink"
            >
              {showRawPayload ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Raw message payloads ({messages.length})
            </button>
            {showRawPayload && (
              <div className="space-y-3">
                {messages.length === 0 ? (
                  <p className="text-xs text-ink-muted">No canonical messages have been exchanged for this filing yet.</p>
                ) : (
                  messages
                    .slice()
                    .reverse()
                    .map((m) => (
                      <div key={m.id} className="space-y-1.5">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-ink-muted">
                          <Badge variant={m.direction === "OUTBOUND" ? "info" : "neutral"}>{m.direction}</Badge>
                          <span>{m.messageName}</span>
                          <span>&middot;</span>
                          <span>{displayDate(m.createdAt)}</span>
                        </div>
                        <pre className="bg-surface-muted rounded-lg p-3 overflow-x-auto text-[11px]">
                          {JSON.stringify(m.envelope, null, 2)}
                        </pre>
                      </div>
                    ))
                )}
              </div>
            )}
          </Card>
        </div>
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
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setConfirmAction(null)} disabled={busy === confirmAction}>
                Keep Filing
              </Button>
              <Button variant={def.variant} onClick={() => handleChildAction(confirmAction)} loading={busy === confirmAction}>
                {def.confirmLabel}
              </Button>
            </ModalFooter>
          </Modal>
        );
      })()}
    </div>
  );
}
