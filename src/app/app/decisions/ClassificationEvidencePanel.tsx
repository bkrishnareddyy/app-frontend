"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { displayDate, displayText, NOT_PROVIDED } from "@/lib/honest";

interface CodeBlock {
  code: string | null;
  found: boolean;
  description: string | null;
  generalDutyRate: string | null;
  column2DutyRate: string | null;
  specialRatePrograms: unknown;
  additionalDuties: Array<{ programme: string; percent: number | null }>;
  effectiveDate: string | null;
  expirationDate: string | null;
  sourceRevision: string | null;
}

interface DutyBlock {
  comparable: boolean;
  deltaPercent: number | null;
  reason: string | null;
}

interface RulingBlock {
  id: string;
  rulingNumber: string;
  title: string;
  issuedAt: string;
  rulingType: string;
  sourceProvider: string;
  sourceUrl: string | null;
  modifiedOrRevokedStatus: string;
}

interface Evidence {
  proposed: CodeBlock | null;
  current: CodeBlock | null;
  duty: DutyBlock;
  rulesApplied: string[];
  regulations: string[];
  dataSources: string[];
  modelVersion: string | null;
  rulings: RulingBlock[];
}

function CodeCard({ label, block }: { label: string; block: CodeBlock | null }) {
  if (block === null) {
    return (
      <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-1">
        <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">{label}</p>
        <p className="text-sm text-[#6E6E73]">The decision does not name a code here.</p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-1.5">
      <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">{label}</p>
      <p className="font-mono text-base font-extrabold text-[#0071E3]">
        {displayText(block.code)}
      </p>

      {block.found ? (
        <>
          <p className="text-sm text-[#1D1D1F]">{displayText(block.description)}</p>
          <dl className="text-sm text-[#6E6E73] space-y-0.5">
            <div className="flex gap-2">
              <dt className="font-semibold text-[#1D1D1F]">General rate</dt>
              <dd>{displayText(block.generalDutyRate)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold text-[#1D1D1F]">Column 2</dt>
              <dd>{displayText(block.column2DutyRate)}</dd>
            </div>
            {block.additionalDuties.map((duty) => (
              <div key={duty.programme} className="flex gap-2">
                <dt className="font-semibold text-[#1D1D1F]">{duty.programme}</dt>
                <dd>
                  {duty.percent === null
                    ? "applies, rate not recorded"
                    : `applies at ${duty.percent}%`}
                </dd>
              </div>
            ))}
            <div className="flex gap-2">
              <dt className="font-semibold text-[#1D1D1F]">Effective</dt>
              <dd>{displayDate(block.effectiveDate)}</dd>
            </div>
            {block.expirationDate !== null && (
              <div className="flex gap-2">
                <dt className="font-semibold text-[#1D1D1F]">Expires</dt>
                <dd>{displayDate(block.expirationDate)}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-semibold text-[#1D1D1F]">Source release</dt>
              <dd>{displayText(block.sourceRevision)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="text-sm text-amber-800">
          This code is not in the loaded tariff release, so no description, rate, or
          effective date can be shown for it.
        </p>
      )}
    </div>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; evidence: Evidence }
  | { kind: "error"; message: string };

export function ClassificationEvidencePanel({ decisionId }: { decisionId: string }) {
  // One state value keyed by the decision, so switching decisions does not need a
  // synchronous reset inside the effect body.
  const [state, setState] = useState<{ id: string; load: LoadState }>({
    id: decisionId,
    load: { kind: "loading" },
  });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/decisions/${decisionId}/evidence`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        setState({
          id: decisionId,
          load: res.ok
            ? { kind: "loaded", evidence: body }
            : {
                kind: "error",
                message:
                  body?.error?.message ?? `Could not load evidence (HTTP ${res.status}).`,
              },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          id: decisionId,
          load: {
            kind: "error",
            message: "The tariff and rulings lookup could not be reached.",
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [decisionId]);

  // A response for a previous decision must not be shown against this one.
  const load: LoadState = state.id === decisionId ? state.load : { kind: "loading" };

  if (load.kind === "loading") {
    return (
      <p className="text-sm text-[#6E6E73]" aria-live="polite">
        Loading tariff and rulings evidence…
      </p>
    );
  }

  if (load.kind === "error") {
    return (
      <p role="alert" className="text-sm text-red-800 font-semibold">
        {load.message}
      </p>
    );
  }

  const evidence = load.evidence;
  if (!evidence) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
        Tariff evidence
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CodeCard label="Code on the record now" block={evidence.current} />
        <CodeCard label="Proposed code" block={evidence.proposed} />
      </div>

      <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm">
        <p className="font-bold text-[#1D1D1F]">Duty impact</p>
        {evidence.duty.comparable && evidence.duty.deltaPercent !== null ? (
          <p className="text-[#1D1D1F]">
            {evidence.duty.deltaPercent === 0
              ? "The general rate is the same on both codes."
              : `The general rate ${
                  evidence.duty.deltaPercent > 0 ? "increases" : "decreases"
                } by ${Math.abs(evidence.duty.deltaPercent)} percentage points.`}{" "}
            <span className="text-[#6E6E73]">
              This compares published general rates only; it is not a calculated duty
              amount for this shipment.
            </span>
          </p>
        ) : (
          <p className="text-[#6E6E73]">
            {displayText(evidence.duty.reason, "The duty impact was not calculated.")}
          </p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F] mb-1.5">
          Rules the agent recorded
        </h4>
        {evidence.rulesApplied.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">
            The agent did not record which rules it applied.
          </p>
        ) : (
          <ul className="space-y-1">
            {evidence.rulesApplied.map((rule) => (
              <li
                key={rule}
                className="p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm text-[#1D1D1F]"
              >
                {rule}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F] mb-1.5">
          CROSS rulings on the proposed code ({evidence.rulings.length})
        </h4>
        {evidence.rulings.length === 0 ? (
          <p className="text-sm text-[#6E6E73]">
            No stored ruling references this code. That means none is on file here, not
            that none exists.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {evidence.rulings.map((ruling) => (
              <li
                key={ruling.id}
                className="p-2.5 rounded-xl bg-white border border-[#E5E5EA] text-sm space-y-0.5"
              >
                <p className="font-bold text-[#1D1D1F]">
                  {ruling.rulingNumber}
                  <span className="ml-2 font-normal text-[#6E6E73]">
                    {ruling.rulingType} · {displayDate(ruling.issuedAt)}
                  </span>
                </p>
                <p className="text-[#1D1D1F]">{ruling.title}</p>
                <p className="text-[#6E6E73]">
                  {ruling.sourceProvider} · {ruling.modifiedOrRevokedStatus}
                </p>
                {ruling.sourceUrl !== null && (
                  <a
                    href={ruling.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#0071E3] hover:underline"
                  >
                    Open the ruling
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-sm text-[#6E6E73]">
        Model version: {displayText(evidence.modelVersion, NOT_PROVIDED)} · Data sources:{" "}
        {evidence.dataSources.length === 0
          ? "none recorded"
          : evidence.dataSources.join(", ")}
      </p>
    </div>
  );
}
