"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, ArrowLeft, Scale, ExternalLink, Check, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui";

// ---------- Types ----------

interface GriStep {
  id: string;
  sequence: number;
  griRule: string;
  question: string;
  conclusion: string;
  outcome: "APPLIED" | "NOT_APPLICABLE" | "PASSED_TO_NEXT";
}

interface ProposalEvidence {
  id: string;
  evidenceType: string;
  sourceEntityId: string | null;
  citation: string;
  quotedFragment: string;
  relevanceScore: number;
  supportsOrConflicts: "SUPPORTS" | "CONFLICTS";
}

interface HtsNode {
  id: string;
  htsNumberDisplay: string;
  description: string | null;
  dutyRates: Array<{ rateColumn: string; rawRateText: string }>;
}

interface Proposal {
  id: string;
  rank: number;
  calibratedConfidence: number;
  confidenceBand: "HIGH" | "MEDIUM" | "LOW";
  recommendationStatus: string;
  summary: string;
  proposedHtsNodeId: string;
  proposedNode: HtsNode;
  griSteps: GriStep[];
  evidenceItems: ProposalEvidence[];
}

interface ClassificationRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  proposals: Proposal[];
}

interface ClassificationDecision {
  id: string;
  decisionStatus: string;
  approvedHtsNodeId: string;
  rationale: string;
  overrideReason: string | null;
  attestedAt: string;
  approvedNode: HtsNode;
}

interface ClassificationSubject {
  rawDescription: string;
  countryOfOrigin: string | null;
  intendedUse: string | null;
  structuredAttributesJson: Record<string, unknown>;
}

interface ClassificationCase {
  id: string;
  status: string;
  priority: string;
  jurisdiction: string;
  createdAt: string;
  subjects: ClassificationSubject[];
  runs: ClassificationRun[];
  decisions: ClassificationDecision[];
}

// ---------- Sub-components ----------

function ConfidenceBadge({ band, score }: { band: "HIGH" | "MEDIUM" | "LOW"; score: number }) {
  const pct = Math.round(score * 100);
  const variant = band === "HIGH" ? "success" : band === "MEDIUM" ? "warning" : "danger";
  return <Badge variant={variant}>{pct}% {band}</Badge>;
}

function GriAccordion({ steps }: { steps: GriStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-ink bg-surface-muted hover:bg-border/40"
      >
        <span className="flex items-center gap-2">
          <Scale className="w-4 h-4" aria-hidden />
          GRI Analysis ({steps.length} step{steps.length !== 1 ? "s" : ""})
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div className="divide-y divide-border">
          {steps
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((step) => (
              <div key={step.id} className="px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                      step.outcome === "APPLIED"
                        ? "bg-green-100 text-green-700"
                        : step.outcome === "NOT_APPLICABLE"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-amber-100 text-amber-700"
                    }`}
                    aria-label={step.outcome}
                  >
                    {step.outcome === "APPLIED" ? "✓" : step.outcome === "NOT_APPLICABLE" ? "—" : "→"}
                  </span>
                  <div>
                    <p className="font-semibold text-ink">{step.griRule}</p>
                    <p className="text-[#6E6E73] mt-0.5">{step.question}</p>
                    <p className="text-ink mt-1 italic">{step.conclusion}</p>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function RulingCitation({ evidence }: { evidence: ProposalEvidence }) {
  const [open, setOpen] = useState(false);
  const rulingNumber = evidence.citation.replace("CBP CROSS Ruling ", "");
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm bg-surface-muted hover:bg-border/40"
      >
        <span className="font-semibold text-brand">{rulingNumber}</span>
        <span className="flex items-center gap-2 text-[#6E6E73]">
          <span className="text-xs">{Math.round(evidence.relevanceScore * 100)}% relevant</span>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-sm space-y-2">
          <p className="text-[#6E6E73] italic">&ldquo;{evidence.quotedFragment}&rdquo;</p>
          <a
            href={`https://rulings.cbp.gov/ruling/${rulingNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand text-xs hover:underline"
          >
            Open in CBP CROSS <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  isSelected,
  onSelect,
  canDecide,
}: {
  proposal: Proposal;
  isSelected: boolean;
  onSelect: (p: Proposal) => void;
  canDecide: boolean;
}) {
  const generalRate = proposal.proposedNode.dutyRates.find((r) => r.rateColumn === "General");
  const rulings = proposal.evidenceItems.filter((e) => e.evidenceType === "CROSS_RULING");

  return (
    <div
      className={`rounded-2xl border p-5 space-y-4 ${
        isSelected ? "border-brand ring-2 ring-brand/20" : "border-border bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xl font-bold text-ink">{proposal.proposedNode.htsNumberDisplay}</p>
          <p className="text-sm text-[#6E6E73] mt-0.5">{proposal.proposedNode.description}</p>
        </div>
        <ConfidenceBadge band={proposal.confidenceBand} score={proposal.calibratedConfidence} />
      </div>

      {generalRate && (
        <p className="text-sm">
          <span className="text-[#6E6E73]">Duty rate:</span>{" "}
          <span className="font-semibold text-ink">{generalRate.rawRateText}</span>
        </p>
      )}

      <p className="text-xs text-[#6E6E73] leading-relaxed">{proposal.summary}</p>

      <GriAccordion steps={proposal.griSteps} />

      {rulings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6E6E73]">
            CROSS Ruling citations
          </p>
          {rulings.map((r) => (
            <RulingCitation key={r.id} evidence={r} />
          ))}
        </div>
      )}

      {canDecide && (
        <button
          type="button"
          onClick={() => onSelect(proposal)}
          className="w-full h-9 rounded-xl bg-brand text-white text-sm font-semibold hover:opacity-90"
        >
          Select this code
        </button>
      )}
    </div>
  );
}

function CompareView({ proposals }: { proposals: Proposal[] }) {
  const shown = proposals.slice(0, 3);
  const allStepRules = [...new Set(shown.flatMap((p) => p.griSteps.map((s) => s.griRule)))].sort();

  return (
    <div className="rounded-2xl border border-border bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted w-32">
              GRI Step
            </th>
            {shown.map((p) => (
              <th key={p.id} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                {p.proposedNode.htsNumberDisplay}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {allStepRules.map((rule) => {
            const cells = shown.map((p) => p.griSteps.find((s) => s.griRule === rule));
            const outcomes = cells.map((c) => c?.outcome ?? "ABSENT");
            const hasDivergence = new Set(outcomes).size > 1;
            return (
              <tr key={rule} className={hasDivergence ? "bg-amber-50" : ""}>
                <td className="px-4 py-2.5 font-semibold text-ink">{rule}</td>
                {cells.map((cell, i) => (
                  <td key={i} className="px-4 py-2.5 text-[#6E6E73]">
                    {cell ? (
                      <>
                        <span
                          className={`inline-block h-4 w-4 rounded-full text-xs text-center leading-4 mr-1 ${
                            cell.outcome === "APPLIED"
                              ? "bg-green-100 text-green-700"
                              : cell.outcome === "NOT_APPLICABLE"
                                ? "bg-gray-100 text-gray-500"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {cell.outcome === "APPLIED" ? "✓" : cell.outcome === "NOT_APPLICABLE" ? "—" : "→"}
                        </span>
                        <span className="text-xs">{cell.conclusion.slice(0, 60)}{cell.conclusion.length > 60 ? "…" : ""}</span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">N/A</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DecisionModal({
  proposal,
  isOverride,
  onClose,
  onConfirm,
}: {
  proposal: Proposal;
  isOverride: boolean;
  onClose: () => void;
  onConfirm: (opts: { overrideReason?: string; changeReason: string }) => void;
}) {
  const [overrideReason, setOverrideReason] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const generalRate = proposal.proposedNode.dutyRates.find((r) => r.rateColumn === "General");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-5">
        <h2 className="text-lg font-bold text-ink">Confirm classification decision</h2>

        <dl className="text-sm space-y-2">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-[#6E6E73]">HTS Code</dt>
            <dd className="font-mono font-bold text-ink">{proposal.proposedNode.htsNumberDisplay}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-[#6E6E73]">Description</dt>
            <dd className="text-ink">{proposal.proposedNode.description}</dd>
          </div>
          {generalRate && (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-[#6E6E73]">Duty rate</dt>
              <dd className="text-ink">{generalRate.rawRateText}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-[#6E6E73]">Effective</dt>
            <dd className="text-ink">Today</dd>
          </div>
        </dl>

        {isOverride && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Override
            </p>
            <p className="text-xs text-amber-700">
              This code differs from the AI top proposal. An override reason is required.
            </p>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Explain why you are overriding the AI proposal…"
              rows={3}
              className="w-full rounded-xl border border-border px-3 py-2 text-sm"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#6E6E73] mb-1">
            Change reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="Brief reason for this classification decision…"
            rows={2}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border border-border text-sm font-semibold text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!changeReason.trim() || (isOverride && !overrideReason.trim())}
            onClick={() => onConfirm({ overrideReason: overrideReason || undefined, changeReason })}
            className="h-9 px-4 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-40"
          >
            <Check className="w-4 h-4 inline mr-1" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function ClassificationCasePage({
  params,
}: {
  params: { id: string; caseId: string };
}) {
  const router = useRouter();
  const [classificationCase, setClassificationCase] = useState<ClassificationCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [impactSummary, setImpactSummary] = useState<{
    shipmentCount: number;
    filingCount: number;
    dutyDelta: string;
  } | null>(null);

  const fetchCase = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/classification/cases/${params.caseId}`);
      if (!res.ok) throw new Error("Failed to load case");
      const data = await res.json();
      setClassificationCase(data.classificationCase);
    } catch {
      setError("Could not load the classification case.");
    } finally {
      setLoading(false);
    }
  }, [params.caseId]);

  const fetchImpact = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/classification/cases/${params.caseId}/impact`);
      if (!res.ok) return;
      const data = await res.json();
      setImpactSummary(data.summary);
    } catch {}
  }, [params.caseId]);

  useEffect(() => {
    fetchCase();
  }, [fetchCase]);

  useEffect(() => {
    if (classificationCase?.decisions?.length) fetchImpact();
  }, [classificationCase, fetchImpact]);

  const handleDecision = async (opts: { overrideReason?: string; changeReason: string }) => {
    if (!selectedProposal) return;
    setDeciding(true);
    setDecisionError(null);

    const latestRun = classificationCase?.runs[0];
    const topProposal = latestRun?.proposals[0];
    const isOverride = topProposal?.proposedHtsNodeId !== selectedProposal.proposedHtsNodeId;

    try {
      const res = await fetch(`/api/v1/classification/cases/${params.caseId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: selectedProposal.id,
          approvedHtsNodeId: selectedProposal.proposedHtsNodeId,
          decisionStatus: isOverride ? "OVERRIDDEN" : "APPROVED",
          rationale: opts.changeReason,
          overrideReason: opts.overrideReason,
          changeReason: opts.changeReason,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Decision failed");
      }

      setSelectedProposal(null);
      await fetchCase();
      await fetchImpact();
      router.refresh();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setDeciding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-[#6E6E73]">Loading classification case…</div>
    );
  }

  if (error || !classificationCase) {
    return (
      <div className="p-8 text-center text-sm text-red-700">{error ?? "Case not found."}</div>
    );
  }

  const subject = classificationCase.subjects[0];
  const latestRun = classificationCase.runs[0];
  const proposals = latestRun?.proposals ?? [];
  const decision = classificationCase.decisions[0];
  const attrs = subject?.structuredAttributesJson ?? {};
  const isApproved = classificationCase.status === "APPROVED";
  const canDecide = !isApproved;

  const topProposalNodeId = proposals[0]?.proposedHtsNodeId;

  return (
    <div className="space-y-6 pb-16">
      {/* Back link */}
      <Link
        href={`/app/products/${params.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
      >
        <ArrowLeft className="w-4 h-4" /> Back to product
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Classification Case</h1>
          <p className="text-sm text-[#6E6E73] mt-0.5 font-mono">{params.caseId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isApproved ? "success" : "neutral"}>{classificationCase.status}</Badge>
          <Badge variant="info">{classificationCase.priority}</Badge>
        </div>
      </div>

      {/* Impact banner (F-4) */}
      {impactSummary && (impactSummary.shipmentCount > 0 || impactSummary.filingCount > 0) && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          <strong>Classification change impact:</strong> This change affects{" "}
          {impactSummary.shipmentCount} shipment{impactSummary.shipmentCount !== 1 ? "s" : ""} and{" "}
          {impactSummary.filingCount} pending entr{impactSummary.filingCount !== 1 ? "ies" : "y"}.
          {Number(impactSummary.dutyDelta) !== 0 && (
            <> Estimated duty delta: <strong>${impactSummary.dutyDelta}</strong>.</>
          )}
        </div>
      )}

      {/* Approved decision banner */}
      {decision && isApproved && (
        <div className="rounded-2xl bg-green-50 border border-green-200 p-4 flex items-start gap-3">
          <Check className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-green-800">
              Approved: {decision.approvedNode.htsNumberDisplay}
            </p>
            <p className="text-green-700 mt-0.5">{decision.rationale}</p>
            {decision.overrideReason && (
              <p className="text-amber-700 mt-1">
                <strong>Override reason:</strong> {decision.overrideReason}
              </p>
            )}
          </div>
        </div>
      )}

      {decisionError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {decisionError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Left pane: product facts */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-border p-5 space-y-4">
            <h2 className="text-sm font-bold text-ink">Product facts</h2>

            {subject && (
              <dl className="text-sm space-y-2">
                <div>
                  <dt className="text-xs font-semibold text-[#6E6E73] uppercase tracking-wider">Description</dt>
                  <dd className="text-ink mt-0.5">{subject.rawDescription}</dd>
                </div>
                {subject.countryOfOrigin && (
                  <div>
                    <dt className="text-xs font-semibold text-[#6E6E73] uppercase tracking-wider">Country of origin</dt>
                    <dd className="text-ink mt-0.5">{subject.countryOfOrigin}</dd>
                  </div>
                )}
                {subject.intendedUse && (
                  <div>
                    <dt className="text-xs font-semibold text-[#6E6E73] uppercase tracking-wider">Intended use</dt>
                    <dd className="text-ink mt-0.5">{subject.intendedUse}</dd>
                  </div>
                )}
              </dl>
            )}

            {Object.keys(attrs).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-wider mb-2">Attributes</p>
                <dl className="text-sm space-y-1">
                  {Object.entries(attrs).map(([k, v]) =>
                    v != null && v !== "" ? (
                      <div key={k} className="flex gap-2">
                        <dt className="w-40 shrink-0 text-[#6E6E73] capitalize">{k.replace(/_/g, " ")}</dt>
                        <dd className="text-ink">{String(v)}</dd>
                      </div>
                    ) : null
                  )}
                </dl>
              </div>
            )}
          </div>

          {/* Jurisdiction info */}
          <div className="rounded-2xl bg-white border border-border p-5 text-sm">
            <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-wider mb-2">Case info</p>
            <dl className="space-y-1">
              <div className="flex gap-2">
                <dt className="w-32 text-[#6E6E73]">Jurisdiction</dt>
                <dd className="font-mono text-ink">{classificationCase.jurisdiction}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 text-[#6E6E73]">Priority</dt>
                <dd className="text-ink">{classificationCase.priority}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 text-[#6E6E73]">Opened</dt>
                <dd className="text-ink">{new Date(classificationCase.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Right pane: proposals */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">
              Classification proposals ({proposals.length})
            </h2>
            {proposals.length > 1 && (
              <button
                type="button"
                onClick={() => setCompareMode((m) => !m)}
                className="text-sm font-semibold text-brand"
              >
                {compareMode ? "Back to list" : "Compare proposals →"}
              </button>
            )}
          </div>

          {compareMode ? (
            <CompareView proposals={proposals} />
          ) : proposals.length === 0 ? (
            <div className="rounded-2xl bg-white border border-border p-8 text-center text-sm text-[#6E6E73]">
              {latestRun ? "No proposals were generated." : "No runs yet. Trigger a run to classify."}
            </div>
          ) : (
            proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isSelected={selectedProposal?.id === proposal.id}
                onSelect={setSelectedProposal}
                canDecide={canDecide && !deciding}
                // B-5: flag override if not the top proposal
                {...(proposal.proposedHtsNodeId !== topProposalNodeId
                  ? { "data-override": "true" }
                  : {})}
              />
            ))
          )}
        </div>
      </div>

      {selectedProposal && (
        <DecisionModal
          proposal={selectedProposal}
          isOverride={selectedProposal.proposedHtsNodeId !== topProposalNodeId}
          onClose={() => setSelectedProposal(null)}
          onConfirm={handleDecision}
        />
      )}
    </div>
  );
}
