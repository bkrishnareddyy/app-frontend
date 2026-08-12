"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scale, TriangleAlert, Search, CheckCircle2, FileText, X } from "lucide-react";
import { useDecisionActions } from "@/lib/decisions/useDecisionActions";
import { ExceptionQuickActions } from "./ExceptionQuickActions";
import { DocumentReviewPanel } from "@/components/DocumentReviewPanel";
import { Modal, ModalHeader, ModalBody } from "@/components/ui/Modal";
import { decisionGroupLabel, reviewerLabel, editableFieldsFor } from "@/modules/decisions/editableFields";
import type { ShipmentActionGroup, ActionItem } from "@/modules/actions/shipmentActions";
import type { WorkPriority } from "@/modules/work/workQueue";

export interface DocSummary {
  id: string;
  fileName: string;
  fileUrl: string | null;
}

interface ActionsClientProps {
  groups: ShipmentActionGroup[];
  canWrite: boolean;
  canWaive: boolean;
  initialShipmentId?: string;
  userId: string;
  userName: string;
  documents: DocSummary[];
}

const PRIORITY_LABEL: Record<WorkPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

const PRIORITY_DOT: Record<WorkPriority, string> = {
  critical: "bg-red-500",
  high: "bg-amber-400",
  normal: "bg-gray-300",
};

const PRIORITY_TEXT: Record<WorkPriority, string> = {
  critical: "text-red-600",
  high: "text-amber-600",
  normal: "text-ink-muted",
};

export function ActionsClient({ groups: initialGroups, canWrite, canWaive, initialShipmentId, userId, userName, documents }: ActionsClientProps) {
  const router = useRouter();
  const [localGroups, setLocalGroups] = useState(initialGroups);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<WorkPriority | "all">("all");
  const [taskFilter, setTaskFilter] = useState<"all" | "mine">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [activeCategory, setActiveCategory] = useState<"all" | "blocked" | "review" | "verified">("all");
  const [docModal, setDocModal] = useState<{ documentId: string; fileName: string; fileUrl: string | null } | null>(null);
  const [notesByDecision, setNotesByDecision] = useState<Record<string, string>>({});
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalGroups(initialGroups);
  }, [initialGroups]);

  // Derive available team members from both shipment assigned brokers and exception assignees
  const teamMemberEntries: [string, { id: string; name: string }][] = [
    ...localGroups
      .filter((g) => g.assignedBrokerId)
      .map((g): [string, { id: string; name: string }] => [
        g.assignedBrokerId!,
        { id: g.assignedBrokerId!, name: g.assignedBrokerName ?? g.assignedBrokerId! },
      ]),
    ...localGroups.flatMap((g) =>
      g.items
        .filter((i): i is Extract<ActionItem, { kind: "exception" }> => i.kind === "exception" && i.assignedToUser !== null)
        .map((i): [string, { id: string; name: string }] => [
          i.assignedToUser!.id ?? i.assignedToUserId ?? "",
          {
            id: i.assignedToUser!.id ?? i.assignedToUserId ?? "",
            name: [i.assignedToUser!.firstName, i.assignedToUser!.lastName].filter(Boolean).join(" ") || i.assignedToUser!.email,
          },
        ])
    ),
  ];
  const teamMembers = Array.from(new Map(teamMemberEntries).values()).filter((m) => m.id);

  // Derive available clients
  const clients = Array.from(
    new Map(
      localGroups
        .filter((g) => g.clientId)
        .map((g) => [g.clientId!, { id: g.clientId!, name: g.clientName ?? g.clientId! }])
    ).values()
  );

  const filteredGroups = localGroups.filter((g) => {
    if (priorityFilter !== "all" && g.priority !== priorityFilter) return false;
    if (clientFilter !== "all" && g.clientId !== clientFilter) return false;
    if (taskFilter === "mine" || assigneeFilter !== "all") {
      const targetId = taskFilter === "mine" ? userId : assigneeFilter;
      const isAssignedBroker = g.assignedBrokerId === targetId;
      const hasMatch = g.items.some(
        (item) => item.kind === "exception" && item.assignedToUserId === targetId
      );
      if (!isAssignedBroker && !hasMatch) return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.shipmentNumber.toLowerCase().includes(q) ||
      (g.clientName ?? "").toLowerCase().includes(q) ||
      g.items.some(
        (item) =>
          (item.kind === "decision" ? item.agentName : item.type).toLowerCase().includes(q)
      )
    );
  });

  const initialGroup = initialShipmentId
    ? filteredGroups.find((g) => g.shipmentId === initialShipmentId) ?? filteredGroups[0]
    : filteredGroups[0];

  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(initialGroup?.shipmentId ?? "");

  useEffect(() => {
    if (filteredGroups.length > 0 && !filteredGroups.some((g) => g.shipmentId === selectedShipmentId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedShipmentId(filteredGroups[0].shipmentId);
    }
  }, [filteredGroups, selectedShipmentId]);

  const selectedGroup = localGroups.find((g) => g.shipmentId === selectedShipmentId) ?? localGroups[0];

  const docLookup = new Map(documents.map((d) => [d.id, d]));

  const { actionLoadingId, runDecisionAction } = useDecisionActions((decisionId, newStatus) => {
    setLocalGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) =>
          item.kind === "decision" && item.id === decisionId
            ? { ...item, status: newStatus }
            : item
        ),
      }))
    );
  });

  const handleDecisionAction = async (
    decisionId: string,
    action: "APPROVE" | "REJECT" | "RE_EVALUATE"
  ) => {
    const ok = await runDecisionAction(decisionId, action, notesByDecision[decisionId]);
    if (ok) {
      setActionSuccess(
        action === "APPROVE"
          ? "Approved & signed into audit log."
          : action === "REJECT"
            ? "Rejected."
            : "Re-evaluation requested."
      );
      router.refresh();
    }
  };

  const handleExceptionResolved = (exceptionId: string) => {
    setLocalGroups((prev) =>
      prev
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => !(item.kind === "exception" && item.id === exceptionId)),
        }))
        .filter((g) => g.items.length > 0)
    );
    setActionSuccess("Exception closed and recorded in the audit log.");
  };

  if (localGroups.length === 0) {
    return (
      <div className="bg-white p-12 rounded-3xl border border-border text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto opacity-70" />
        <h3 className="text-sm font-bold text-ink">No open actions</h3>
        <p className="text-xs text-ink-muted max-w-sm mx-auto">
          Every AI decision has been reviewed and all exceptions are resolved. Check back after the next document
          processing run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto pb-12">
      {/* Header toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-border shadow-2xs">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
            <TriangleAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-ink tracking-tight">Actions</h1>
            <p className="text-xs text-ink-muted">{localGroups.reduce((n, g) => n + g.items.length, 0)} open items across {localGroups.length} shipments</p>
          </div>
        </div>

        {/* Filter bar: search + task/assignee/client filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shipment or agent…"
              className="pl-9 pr-4 py-2 bg-surface-muted border border-border focus:border-brand focus:bg-white rounded-xl text-xs text-ink w-48 transition-all outline-none font-medium"
            />
          </div>

          {/* My Tasks / All Tasks toggle */}
          <div className="flex items-center bg-surface-muted border border-border rounded-xl p-0.5 gap-0.5">
            <button
              onClick={() => { setTaskFilter("mine"); setAssigneeFilter("all"); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                taskFilter === "mine" ? "bg-white text-ink shadow-2xs" : "text-ink-muted hover:text-ink"
              }`}
            >
              My Tasks
            </button>
            <button
              onClick={() => setTaskFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                taskFilter === "all" ? "bg-white text-ink shadow-2xs" : "text-ink-muted hover:text-ink"
              }`}
            >
              All Tasks
            </button>
          </div>

          {/* Team Members dropdown */}
          {teamMembers.length > 0 && (
            <select
              value={assigneeFilter}
              onChange={(e) => { setAssigneeFilter(e.target.value); setTaskFilter("all"); }}
              className="py-1.5 pl-3 pr-7 bg-surface-muted border border-border rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand appearance-none cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
            >
              <option value="all">Team Members</option>
              {taskFilter === "all" && (
                <option value={userId}>My Tasks ({userName})</option>
              )}
              {teamMembers.filter((m) => m.id !== userId).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}

          {/* Client dropdown */}
          {clients.length > 0 && (
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="py-1.5 pl-3 pr-7 bg-surface-muted border border-border rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand appearance-none cursor-pointer"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
            >
              <option value="all">Client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: shipment list */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-white p-4 rounded-2xl border border-border shadow-2xs space-y-3">
            <div className="border-b border-border pb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink shrink-0">
                Shipments ({filteredGroups.length})
              </h3>
              <div className="flex items-center gap-0.5 bg-surface-muted p-0.5 rounded-lg border border-border">
                {(["all", "critical", "high", "normal"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriorityFilter(p)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap transition-all ${
                      priorityFilter === p
                        ? p === "all"
                          ? "bg-white text-ink shadow-2xs"
                          : p === "critical"
                            ? "bg-red-500 text-white shadow-2xs"
                            : p === "high"
                              ? "bg-amber-400 text-white shadow-2xs"
                              : "bg-gray-400 text-white shadow-2xs"
                        : "text-ink-muted"
                    }`}
                  >
                    {p === "all" ? "All" : PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 max-h-[76vh] overflow-y-auto pr-1">
              {filteredGroups.map((g) => {
                const isSelected = g.shipmentId === selectedShipmentId;
                return (
                  <button
                    key={g.shipmentId}
                    type="button"
                    onClick={() => { setSelectedShipmentId(g.shipmentId); setActionSuccess(null); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all text-xs cursor-pointer space-y-2 block ${
                      isSelected
                        ? "bg-blue-50/80 border-brand shadow-md ring-2 ring-brand/20"
                        : "bg-surface-muted border-border hover:border-brand hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-brand text-sm">{g.shipmentNumber}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[g.priority]}`} />
                        <span className={`text-[10px] font-semibold ${PRIORITY_TEXT[g.priority]}`}>
                          {PRIORITY_LABEL[g.priority]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {g.decisionCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-ink-muted bg-white border border-border rounded-lg px-2 py-0.5">
                          <Scale className="w-3 h-3" />
                          {g.decisionCount} decision{g.decisionCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {g.exceptionCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-ink-muted bg-white border border-border rounded-lg px-2 py-0.5">
                          <TriangleAlert className="w-3 h-3" />
                          {g.exceptionCount} exception{g.exceptionCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredGroups.length === 0 && (
                <p className="p-8 text-center text-xs text-ink-muted">No shipments match this filter.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right: action detail */}
        <div className="lg:col-span-8">
          {selectedGroup ? (
            <div className="bg-white rounded-2xl border border-border shadow-2xs p-6 space-y-4">
              {/* Shipment header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-brand text-lg">{selectedGroup.shipmentNumber}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      selectedGroup.priority === "critical"
                        ? "bg-red-50 border-red-200 text-red-700"
                        : selectedGroup.priority === "high"
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-gray-50 border-gray-200 text-gray-600"
                    }`}>
                      {PRIORITY_LABEL[selectedGroup.priority]}
                    </span>
                  </div>
                  {(() => {
                    const openCount = selectedGroup.items.filter((i) => categorize(i) !== "verified").length;
                    const verifiedCount = selectedGroup.items.filter((i) => categorize(i) === "verified").length;
                    return (
                      <p className="text-xs text-ink-muted mt-0.5">
                        <span className="font-semibold text-ink">{openCount}</span> open action{openCount !== 1 ? "s" : ""}
                        {verifiedCount > 0 && <span className="text-emerald-700 font-semibold ml-2">· {verifiedCount} verified</span>}
                      </p>
                    );
                  })()}
                </div>
                <Link
                  href={`/app/shipments/${selectedGroup.shipmentId}`}
                  className="text-xs font-semibold text-brand hover:underline flex items-center gap-1"
                >
                  Open shipment →
                </Link>
              </div>

              {/* Success banner */}
              {actionSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  {actionSuccess}
                </div>
              )}

              {/* Action scorecard */}
              <ActionScorecard
                items={selectedGroup.items}
                activeCategory={activeCategory}
                onCategoryClick={(c) => setActiveCategory((prev) => (prev === c ? "all" : c))}
              />

              {/* Action cards — ordered Blocked → Review → Verified */}
              <div className="space-y-3 max-h-[64vh] overflow-y-auto pr-1">
                {(["blocked", "review", "verified"] as const).map((cat) => {
                  const catItems = selectedGroup.items.filter((item) => categorize(item) === cat);
                  if (catItems.length === 0) return null;
                  if (activeCategory !== "all" && activeCategory !== cat) return null;
                  return (
                    <div key={cat} className="space-y-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          cat === "blocked" ? "text-red-600" : cat === "review" ? "text-amber-600" : "text-emerald-600"
                        }`}>
                          {cat === "blocked" ? "Blocked" : cat === "review" ? "Needs Review" : "Verified"}
                        </span>
                        <span className={`w-full h-px ${
                          cat === "blocked" ? "bg-red-100" : cat === "review" ? "bg-amber-100" : "bg-emerald-100"
                        }`} />
                        <span className={`text-[10px] font-semibold shrink-0 ${
                          cat === "blocked" ? "text-red-400" : cat === "review" ? "text-amber-400" : "text-emerald-400"
                        }`}>{catItems.length}</span>
                      </div>
                      {catItems.map((item) =>
                        item.kind === "decision" ? (
                          <AgentResultCard
                            key={item.id}
                            item={item}
                            note={notesByDecision[item.id] ?? ""}
                            onNoteChange={(v) => setNotesByDecision((prev) => ({ ...prev, [item.id]: v }))}
                            onAction={handleDecisionAction}
                            loading={actionLoadingId === item.id}
                            canWrite={canWrite}
                            verified={cat === "verified"}
                            onDocClick={(docId, fileName) => {
                              const doc = docLookup.get(docId);
                              setDocModal({ documentId: docId, fileName, fileUrl: doc?.fileUrl ?? null });
                            }}
                          />
                        ) : (
                          <ExceptionCard
                            key={item.id}
                            item={item}
                            canWrite={canWrite}
                            canWaive={canWaive}
                            onResolved={() => handleExceptionResolved(item.id)}
                            verified={cat === "verified"}
                          />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-border text-xs text-ink-muted">
              Select a shipment from the left to see its open actions.
            </div>
          )}
        </div>
      </div>

      {/* Document review modal */}
      {docModal && (() => {
        const modalDecisions = (selectedGroup?.items ?? [])
          .filter((i): i is Extract<ActionItem, { kind: "decision" }> =>
            i.kind === "decision" && i.raw.documentId === docModal.documentId
          )
          .map((i) => i.raw);
        return (
          <Modal isOpen titleId="doc-modal-title" onClose={() => setDocModal(null)} size="xl">
            <ModalHeader titleId="doc-modal-title" title={docModal.fileName} onClose={() => setDocModal(null)} />
            <ModalBody>
              <DocumentReviewPanel
                documentId={docModal.documentId}
                fileName={docModal.fileName}
                fileUrl={docModal.fileUrl}
                decisions={modalDecisions}
                onReviewAction={async (decisionId, action) => {
                  await handleDecisionAction(decisionId, action);
                }}
                actionLoadingId={actionLoadingId}
                onClose={() => setDocModal(null)}
              />
            </ModalBody>
          </Modal>
        );
      })()}
    </div>
  );
}

const BLOCKED_SENTINELS = new Set([
  "BLOCKED_DEPENDENCY",
  "WAITING_FOR_EXTRACTION",
  "BLOCKED_MISSING_DESCRIPTION",
]);

function categorize(item: ActionItem): "blocked" | "review" | "verified" {
  if (item.kind === "exception") {
    if (item.severity === "Critical") return "blocked";
    return "review";
  }

  const dec = item.raw as unknown as Record<string, unknown>;
  const desc = typeof dec.proposedDescription === "string" ? dec.proposedDescription : "";
  const summary = typeof dec.decisionSummary === "string" ? dec.decisionSummary : "";
  const ev = (dec.evidenceItems && typeof dec.evidenceItems === "object"
    ? dec.evidenceItems
    : {}) as Record<string, unknown>;

  // Gated execution sentinels or explicit pipeline blocks
  if (
    BLOCKED_SENTINELS.has(desc) ||
    desc.includes("BLOCKED") ||
    summary.includes("BLOCKED") ||
    summary.includes("Gating:")
  ) {
    return "blocked";
  }

  // Missing commercial invoice, zero extracted line items, or skipped agent evaluation
  if (
    summary.includes("Skipped") ||
    summary.includes("Paused") ||
    ev.hasCommercialInvoice === false ||
    (typeof ev.lineItemCount === "number" && ev.lineItemCount === 0)
  ) {
    return "review";
  }

  // Unresolved evidence flags
  const flags = Array.isArray(ev.flags) ? (ev.flags as { severity: string; summary: string }[]) : [];
  if (flags.length > 0) return "review";

  if (item.status === "Approved") return "verified";
  if (item.status === "Rejected") return "blocked";
  return "review";
}

function ActionScorecard({
  items,
  activeCategory,
  onCategoryClick,
}: {
  items: ActionItem[];
  activeCategory: "all" | "blocked" | "review" | "verified";
  onCategoryClick: (c: "blocked" | "review" | "verified") => void;
}) {
  const blocked = items.filter((i) => categorize(i) === "blocked").length;
  const review = items.filter((i) => categorize(i) === "review").length;
  const verified = items.filter((i) => categorize(i) === "verified").length;

  const tile = (
    cat: "blocked" | "review" | "verified",
    count: number,
    label: string,
    colors: { border: string; bg: string; active: string; num: string; text: string }
  ) => {
    const isActive = activeCategory === cat;
    return (
      <button
        key={cat}
        onClick={() => onCategoryClick(cat)}
        className={`rounded-xl border p-3 text-left w-full transition-all cursor-pointer ring-2 ${
          isActive ? `${colors.active} ring-current/30` : `${colors.border} ${colors.bg} ring-transparent hover:ring-current/10`
        }`}
      >
        <p className={`text-xl font-extrabold ${colors.num}`}>{count}</p>
        <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${colors.text}`}>{label}</p>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-muted/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center">
            <Scale className="w-3.5 h-3.5 text-brand" />
          </div>
          <span className="text-xs font-bold text-ink uppercase tracking-wider">AI Review</span>
        </div>
        {activeCategory !== "all" && (
          <button onClick={() => onCategoryClick(activeCategory)} className="text-[10px] text-brand font-semibold hover:underline">
            Clear filter ×
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tile("blocked", blocked, "Blocked", {
          border: "border-red-200", bg: "bg-red-50", active: "border-red-400 bg-red-100",
          num: "text-red-700", text: "text-red-600",
        })}
        {tile("review", review, "Needs Review", {
          border: "border-amber-200", bg: "bg-amber-50", active: "border-amber-400 bg-amber-100",
          num: "text-amber-700", text: "text-amber-600",
        })}
        {tile("verified", verified, "Verified", {
          border: "border-emerald-200", bg: "bg-emerald-50", active: "border-emerald-400 bg-emerald-100",
          num: "text-emerald-700", text: "text-emerald-600",
        })}
      </div>
    </div>
  );
}

function DecisionBody({ item }: { item: Extract<ActionItem, { kind: "decision" }> }) {
  const label = decisionGroupLabel(item.raw);
  const ev = (item.raw.evidenceItems && typeof item.raw.evidenceItems === "object"
    ? item.raw.evidenceItems
    : {}) as Record<string, unknown>;

  if (label === "HTS Classification") {
    const fields = editableFieldsFor(item.raw);
    const hts = fields[0]?.value;
    const confMatch = item.decisionSummary?.match(/Confidence:\s*(\d+)%/i);
    const productMatch = item.decisionSummary?.match(/Classification for ([^:]+):/i);
    return (
      <div className="space-y-1.5">
        {hts && <Row label="HS Code" value={hts} highlight />}
        {productMatch?.[1] && <Row label="Product" value={productMatch[1].trim()} />}
        {confMatch?.[1] && <Row label="Confidence" value={`${confMatch[1]}%`} />}
        {!hts && !productMatch && <p className="text-[11px] text-ink-muted">{item.decisionSummary}</p>}
      </div>
    );
  }

  if (label === "Origin") {
    const quals = Array.isArray(ev.qualifications) ? (ev.qualifications as { countryOfOrigin?: string; ftaProgram?: string }[]) : [];
    const primary = quals[0];
    if (primary?.countryOfOrigin) {
      const fta = !primary.ftaProgram || primary.ftaProgram === "NONE" || primary.ftaProgram === "UNDETERMINED"
        ? "None" : primary.ftaProgram;
      return (
        <div className="space-y-1.5">
          <Row label="Country of Origin" value={primary.countryOfOrigin} highlight />
          <Row label="FTA Program" value={fta} />
          {quals.length > 1 && <Row label="Line items" value={String(quals.length)} />}
        </div>
      );
    }
  }

  if (label === "Compliance") {
    const flags = Array.isArray(ev.flags) ? (ev.flags as { severity: string; summary: string }[]) : [];
    if (flags.length === 0) return <p className="text-[11px] text-ink-muted">{item.decisionSummary || "No issues identified."}</p>;
    return (
      <div className="space-y-1.5">
        {flags.map((f, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[9px] shrink-0 ${
              f.severity === "HIGH" || f.severity === "CRITICAL"
                ? "bg-red-100 text-red-700"
                : f.severity === "MEDIUM"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-600"
            }`}>{f.severity}</span>
            <span className="text-ink">{f.summary}</span>
          </div>
        ))}
      </div>
    );
  }

  if (label === "Valuation") {
    const value = typeof ev.enteredCustomsValue === "number" ? ev.enteredCustomsValue : null;
    const adjustments = Array.isArray(ev.adjustments) ? ev.adjustments : [];
    if (value !== null) return (
      <div className="space-y-1.5">
        <Row label="Entered customs value" value={`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} highlight />
        <Row label="Method" value="Method 1 — transaction value" />
        <Row label="Adjustments" value={adjustments.length > 0 ? `${adjustments.length} applied` : "None"} />
      </div>
    );
  }

  if (label === "Document Intelligence") {
    const agency = typeof ev.primaryAgency === "string" ? ev.primaryAgency : null;
    const hasInvoice = Boolean(ev.hasCommercialInvoice);
    const lineItems = typeof ev.lineItemCount === "number" ? ev.lineItemCount : null;
    return (
      <div className="space-y-1.5">
        {agency && <Row label="Regulatory body" value={agency} highlight />}
        <Row label="Commercial invoice" value={hasInvoice ? "Present" : "Missing"} />
        {lineItems !== null && <Row label="Line items" value={String(lineItems)} />}
      </div>
    );
  }

  if (label === "Product Intelligence") {
    const profiles = Array.isArray(ev.profiles) ? (ev.profiles as { materialComposition?: string; essentialCharacter?: string; endUse?: string }[]) : [];
    const p = profiles[0];
    if (p) return (
      <div className="space-y-1.5">
        {p.materialComposition && <Row label="Material" value={p.materialComposition} highlight />}
        {p.essentialCharacter && <Row label="Essential character" value={p.essentialCharacter} />}
        {p.endUse && <Row label="End use" value={p.endUse} />}
      </div>
    );
  }

  return <p className="text-[11px] text-ink-muted leading-relaxed">{item.decisionSummary || "No details available."}</p>;
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className={`text-right font-semibold ${highlight ? "text-ink" : "text-ink-muted"}`}>{value}</span>
    </div>
  );
}

function AgentResultCard({
  item,
  note,
  onNoteChange,
  onAction,
  loading,
  canWrite,
  verified = false,
  onDocClick,
}: {
  item: Extract<ActionItem, { kind: "decision" }>;
  note: string;
  onNoteChange: (v: string) => void;
  onAction: (id: string, action: "APPROVE" | "REJECT" | "RE_EVALUATE") => void;
  loading: boolean;
  canWrite: boolean;
  verified?: boolean;
  onDocClick: (docId: string, fileName: string) => void;
}) {
  const [showNote, setShowNote] = useState(false);
  const label = reviewerLabel(item.raw);
  const effectiveCategory = categorize(item);
  const docId = item.documentId || item.raw.documentId;
  const isApproved = effectiveCategory === "verified";

  return (
    <div className={`border rounded-2xl p-4 space-y-3 ${verified ? "border-emerald-100 bg-emerald-50/20 opacity-80" : "border-border bg-white"}`}>
      {/* Header: doc link + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          {item.documentName && docId ? (
            <button
              onClick={() => onDocClick(docId, item.documentName!)}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline cursor-pointer max-w-full text-left"
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{item.documentName}</span>
            </button>
          ) : item.documentName ? (
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{item.documentName}</span>
            </div>
          ) : null}
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
          effectiveCategory === "verified"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : effectiveCategory === "blocked"
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          {effectiveCategory === "verified" ? "Approved" : effectiveCategory === "blocked" ? "Blocked" : "Needs Review"}
        </span>
      </div>

      {/* Extracted data */}
      <DecisionBody item={item} />

      {/* Note */}
      {showNote && (
        <textarea
          rows={2}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Add a note for the audit log…"
          className="w-full px-3 py-2 rounded-xl border border-border text-xs text-ink resize-none focus:outline-none focus:border-brand"
        />
      )}

      {/* Actions — compact; hide approve/reject when already approved */}
      {canWrite && (
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {!isApproved && (
            <button
              onClick={() => onAction(item.id, "APPROVE")}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl bg-ink text-white text-xs font-semibold disabled:opacity-40 hover:bg-ink/80 transition-colors"
            >
              {loading ? "Saving…" : "Approve"}
            </button>
          )}
          {!isApproved && (
            <button
              onClick={() => { setShowNote(true); onAction(item.id, "REJECT"); }}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
            >
              Reject
            </button>
          )}
          <button
            onClick={() => onAction(item.id, "RE_EVALUATE")}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-40 transition-colors"
          >
            Re-evaluate
          </button>
          {!showNote && (
            <button onClick={() => setShowNote(true)} className="text-xs text-ink-muted hover:text-ink">
              + Note
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ExceptionCard({
  item,
  canWrite,
  canWaive,
  onResolved,
  verified = false,
}: {
  item: Extract<ActionItem, { kind: "exception" }>;
  canWrite: boolean;
  canWaive: boolean;
  onResolved: () => void;
  verified?: boolean;
}) {
  const [resolved, setResolved] = useState(false);

  if (resolved) {
    return (
      <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-xs text-emerald-700 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          Exception closed
        </div>
      </div>
    );
  }

  const severityClass =
    item.severity === "Critical"
      ? "bg-red-50 border-red-200 text-red-700"
      : item.severity === "High"
        ? "bg-amber-50 border-amber-200 text-amber-700"
        : "bg-gray-50 border-gray-200 text-gray-600";

  return (
    <div className={`border rounded-2xl p-4 space-y-2 ${verified ? "border-emerald-100 bg-emerald-50/30 opacity-75" : "border-border bg-surface-muted/30"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-sm font-semibold text-ink truncate">
            {item.type.replace(/_/g, " ")}
          </span>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${severityClass}`}>
          {item.severity}
        </span>
      </div>

      <div className="flex items-center gap-1 text-xs text-ink-muted">
        <span>Shipment-level</span>
        <span>·</span>
        <span>Open {new Date(item.createdAt).toLocaleDateString()}</span>
      </div>

      <p className="text-xs text-ink-muted leading-relaxed">{item.description}</p>

      {canWrite && (
        <ExceptionQuickActions
          exceptionId={item.id}
          version={item.version}
          canWaive={canWaive}
          onResolved={() => { setResolved(true); onResolved(); }}
        />
      )}
    </div>
  );
}
