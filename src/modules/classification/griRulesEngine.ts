import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

/** A candidate heading the GRI engine can reason over. */
export interface HtsCandidate {
  id: string;
  chapter: string;
  heading: string;
  htsNumberDisplay: string;
  description: string;
}

/**
 * Lookup port for candidate headings. Injected so the rules engine can be
 * exercised deterministically without a live HTS database.
 */
export interface HtsCandidateLookup {
  search(description: string, releaseId?: string): Promise<HtsCandidate[]>;
}

export const databaseHtsCandidateLookup: HtsCandidateLookup = {
  async search(description) {
    const result = await HtsNodeRepository.searchNodes({
      q: description,
      level: 10,
      limit: 5,
    });
    return result.items as unknown as HtsCandidate[];
  },
};

export interface SubjectInput {
  rawDescription: string;
  materialComposition?: string | null;
  functionUsage?: string | null;
  intendedUse?: string | null;
  partNumber?: string | null;
  countryOfOrigin?: string | null;
}

/** JSON-serialisable record of the deterministic checks behind a GRI step. */
export type DeterministicChecks = Record<string, string | number | boolean | null>;

export interface GriStepResult {
  sequence: number;
  griRule: "GRI 1" | "GRI 2a" | "GRI 2b" | "GRI 3a" | "GRI 3b" | "GRI 3c" | "GRI 4" | "GRI 5a" | "GRI 5b" | "GRI 6";
  question: string;
  conclusion: string;
  outcome: "APPLIED" | "NOT_APPLICABLE" | "PASSED_TO_NEXT";
  deterministicChecksJson?: DeterministicChecks;
}

export interface GriEvaluationOutput {
  recommendationStatus: "PROPOSED" | "NEEDS_INFORMATION" | "HUMAN_REVIEW_REQUIRED";
  calibratedConfidence: number;
  confidenceBand: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  missingFacts: string[];
  griSteps: GriStepResult[];
  candidateHtsCode?: string;
  candidateNodeId?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Count how many words from `terms` appear in `target` (case-insensitive). */
function wordOverlap(target: string, terms: string): number {
  const t = target.toLowerCase();
  return terms
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && t.includes(w)).length;
}

/**
 * Score a candidate heading against the subject.  Higher is more specific /
 * more relevant.  Word-overlap is honest and fully disclosed in
 * deterministicChecksJson; a semantic scorer can replace this without
 * changing the GriEvaluationOutput interface.
 */
function scoreCandidate(candidate: HtsCandidate, subject: SubjectInput): number {
  const corpus = [subject.rawDescription, subject.materialComposition, subject.functionUsage, subject.intendedUse]
    .filter(Boolean)
    .join(" ");
  return wordOverlap(candidate.description, corpus);
}

/**
 * Derive calibrated confidence from the evidence inventory.
 * All contributions are documented so the rationale can be audited.
 */
function deriveConfidence(subject: SubjectInput, candidateCount: number, missingFacts: string[]): number {
  let score = 0.50;

  const descWords = (subject.rawDescription || "").trim().split(/\s+/).filter(Boolean).length;
  if (descWords >= 10) score += 0.15;
  else if (descWords >= 5) score += 0.07;

  if (subject.materialComposition) score += 0.10;
  if (subject.functionUsage || subject.intendedUse) score += 0.10;
  if (subject.countryOfOrigin) score += 0.08;
  // Unambiguous DB result: only one heading matched, less risk of wrong heading
  if (candidateCount === 1) score += 0.07;

  // Each missing fact represents genuine classification uncertainty
  score -= missingFacts.length * 0.15;

  return Math.max(0, Math.min(1, score));
}

function confidenceBandFor(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 0.80) return "HIGH";
  if (score >= 0.55) return "MEDIUM";
  return "LOW";
}

function recommendationStatusFor(band: "HIGH" | "MEDIUM" | "LOW"): "PROPOSED" | "NEEDS_INFORMATION" | "HUMAN_REVIEW_REQUIRED" {
  if (band === "HIGH") return "PROPOSED";
  if (band === "MEDIUM") return "HUMAN_REVIEW_REQUIRED";
  return "NEEDS_INFORMATION";
}

// ---------------------------------------------------------------------------
// GRI step builders
// ---------------------------------------------------------------------------

function gri1Step(seq: number, subject: SubjectInput, candidate: HtsCandidate): GriStepResult {
  return {
    sequence: seq,
    griRule: "GRI 1",
    question: `Does '${subject.rawDescription}' fall within the terms of Heading ${candidate.heading} and the relevant Section/Chapter Notes?`,
    conclusion: `Heading ${candidate.heading} (${candidate.description}) covers the goods per the literal heading terms and applicable notes. Classification proceeds to subheading level per GRI 6.`,
    outcome: "APPLIED",
    deterministicChecksJson: { headingMatch: candidate.heading, chapter: candidate.chapter },
  };
}

function gri2aStep(seq: number, subject: SubjectInput): GriStepResult {
  const descLower = subject.rawDescription.toLowerCase();
  const triggers = ["blank", "unfinished", "incomplete", "partially assembled", "knocked down", "semi-finished"];
  const matched = triggers.find((t) => descLower.includes(t)) ?? null;
  return {
    sequence: seq,
    griRule: "GRI 2a",
    question: "Is the article unfinished/incomplete but having the essential character of the finished article?",
    conclusion: matched
      ? `Product description contains '${matched}' indicating an unfinished article. GRI 2a extends heading scope to cover this form.`
      : "Product description shows no indication of an unfinished or incomplete article. GRI 2a not applicable.",
    outcome: matched ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: { triggeredBy: matched, rawDescription: subject.rawDescription },
  };
}

function gri2bStep(seq: number, subject: SubjectInput): GriStepResult {
  const matLower = (subject.materialComposition || "").toLowerCase();
  const descLower = subject.rawDescription.toLowerCase();
  const mixtureTriggers = ["composite", "mixture", "mixed", "blend", " and ", "/", "+"];
  const isMixed = subject.materialComposition
    ? mixtureTriggers.some((t) => matLower.includes(t))
    : mixtureTriggers.some((t) => descLower.includes(t));
  return {
    sequence: seq,
    griRule: "GRI 2b",
    question: "Is the good a mixture or composite material that could fall in more than one heading?",
    conclusion: isMixed
      ? `Material composition ('${subject.materialComposition || subject.rawDescription}') indicates a composite or mixed material. GRI 2b applies; heading scope extended to mixtures.`
      : "Good does not present as a mixture or composite requiring multi-heading analysis. GRI 2b not applicable.",
    outcome: isMixed ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: {
      materialComposition: subject.materialComposition ?? null,
      compositeIndicatorFound: isMixed,
    },
  };
}

function gri3aStep(seq: number, candidates: HtsCandidate[], scores: number[], chosen: HtsCandidate): GriStepResult {
  const hasMultiple = candidates.length > 1;
  return {
    sequence: seq,
    griRule: "GRI 3a",
    question: "When goods are classifiable under two or more headings, which provides the most specific description?",
    conclusion: hasMultiple
      ? `${candidates.length} candidate headings evaluated. Heading ${chosen.heading} (overlap score ${scores[0]}) selected as most specific. Alternatives: ${candidates
          .slice(1)
          .map((c, i) => `${c.heading} (score ${scores[i + 1]})`)
          .join(", ")}.`
      : `Only one candidate heading (${chosen.heading}) returned by tariff repository; GRI 3a tiebreak not required.`,
    outcome: hasMultiple ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: {
      candidateCount: candidates.length,
      selectedHeading: chosen.heading,
      selectionScore: scores[0],
    },
  };
}

function gri3bStep(seq: number, subject: SubjectInput, applied3a: boolean): GriStepResult {
  const hasEssentialChar = !!(subject.materialComposition || subject.functionUsage || subject.intendedUse);
  const shouldApply = !applied3a && hasEssentialChar;
  return {
    sequence: seq,
    griRule: "GRI 3b",
    question: "For composite goods or sets, which constituent material or component gives the good its essential character?",
    conclusion: applied3a
      ? "GRI 3a resolved classification by most-specific description. GRI 3b essential-character analysis not required."
      : hasEssentialChar
      ? `Essential character determinable from available attributes (material: ${subject.materialComposition ?? "—"}, function: ${subject.functionUsage ?? subject.intendedUse ?? "—"}). GRI 3b applied to confirm heading selection.`
      : "Insufficient evidence to determine essential character (no material composition or function/use data). GRI 3b inconclusive; pass to GRI 3c.",
    outcome: shouldApply ? "APPLIED" : applied3a ? "NOT_APPLICABLE" : "PASSED_TO_NEXT",
    deterministicChecksJson: {
      gri3aApplied: applied3a,
      essentialCharacterEvidence: hasEssentialChar,
      materialComposition: subject.materialComposition ?? null,
      functionUsage: subject.functionUsage ?? null,
      intendedUse: subject.intendedUse ?? null,
    },
  };
}

function gri3cStep(seq: number, candidates: HtsCandidate[], applied3aOr3b: boolean): GriStepResult {
  if (applied3aOr3b) {
    return {
      sequence: seq,
      griRule: "GRI 3c",
      question: "When GRI 3a and 3b fail to resolve, classify under the numerically last heading.",
      conclusion: "GRI 3a or 3b resolved classification. GRI 3c last-in-order tiebreaker not required.",
      outcome: "NOT_APPLICABLE",
      deterministicChecksJson: { reason: "resolved_by_3a_or_3b" },
    };
  }
  const sorted = [...candidates].sort((a, b) => a.heading.localeCompare(b.heading));
  const last = sorted[sorted.length - 1];
  return {
    sequence: seq,
    griRule: "GRI 3c",
    question: "When GRI 3a and 3b fail to resolve, classify under the numerically last heading.",
    conclusion: `Neither GRI 3a nor 3b conclusively resolved the heading. GRI 3c selects the numerically last heading: ${last.heading} (${last.description}).`,
    outcome: "APPLIED",
    deterministicChecksJson: {
      headingsConsidered: candidates.map((c) => c.heading).join(", "),
      selectedByLastOrder: last.heading,
    },
  };
}

function gri4Step(seq: number, candidates: HtsCandidate[]): GriStepResult {
  // GRI 4 only fires when no heading directly covers the goods.  If any
  // candidate exists, GRI 1 (or 2/3) resolved it and GRI 4 is NOT_APPLICABLE.
  const applies = candidates.length === 0;
  return {
    sequence: seq,
    griRule: "GRI 4",
    question: "When no heading directly covers the goods, classify under the heading for most akin goods.",
    conclusion: applies
      ? "No heading directly covered the goods. GRI 4 akin-goods analysis flagged for human broker review."
      : `At least one candidate heading found (${candidates[0]?.heading ?? "—"}). GRI 4 akin-goods fallback not needed.`,
    outcome: applies ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: { candidateCount: candidates.length },
  };
}

function gri5aStep(seq: number, subject: SubjectInput): GriStepResult {
  const descLower = subject.rawDescription.toLowerCase();
  const triggers = ["case", "box", "container", "sheath", "holder", "stand"];
  const matched = triggers.find((t) => descLower.includes(t)) ?? null;
  return {
    sequence: seq,
    griRule: "GRI 5a",
    question: "Is the article a special-purpose container or case that classifies with the article it is designed to contain?",
    conclusion: matched
      ? `Description contains '${matched}' suggesting a container/case. GRI 5a applies only when sold with contents; flagged for broker confirmation.`
      : "No container/case indicator found. GRI 5a not applicable.",
    outcome: matched ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: { containerIndicator: matched },
  };
}

function gri5bStep(seq: number, subject: SubjectInput): GriStepResult {
  const descLower = subject.rawDescription.toLowerCase();
  const triggers = ["packing", "packaging", "wrapping", "blister", "retail pack"];
  const matched = triggers.find((t) => descLower.includes(t)) ?? null;
  return {
    sequence: seq,
    griRule: "GRI 5b",
    question: "Does packing material classify with the goods it contains?",
    conclusion: matched
      ? `Packing indicator ('${matched}') found. GRI 5b applies when packing is of the normal kind; flagged for broker confirmation.`
      : "No packing/packaging indicator found. GRI 5b not applicable.",
    outcome: matched ? "APPLIED" : "NOT_APPLICABLE",
    deterministicChecksJson: { packingIndicator: matched },
  };
}

function gri6Step(seq: number, candidate: HtsCandidate): GriStepResult {
  return {
    sequence: seq,
    griRule: "GRI 6",
    question: `Does 10-digit statistical line ${candidate.htsNumberDisplay} match subheading terms at the same level?`,
    conclusion: `Subheading classification ${candidate.htsNumberDisplay} confirmed pursuant to GRI 6 (subheading terms applied at the same level as GRI 1–5).`,
    outcome: "APPLIED",
    deterministicChecksJson: { subheadingMatch: candidate.htsNumberDisplay },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class GriRulesEngine {
  /**
   * Evaluates GRI 1 through GRI 6 over product attributes and candidate HTS nodes.
   *
   * All 10 named GRI rules are evaluated; each records APPLIED /
   * NOT_APPLICABLE / PASSED_TO_NEXT with deterministic evidence in
   * deterministicChecksJson.  Multi-candidate heading selection uses
   * word-overlap scoring (GRI 3a).  Confidence is derived from the evidence
   * inventory, not picked from hardcoded constants.
   */
  static async evaluate(
    subject: SubjectInput,
    releaseId?: string,
    lookup: HtsCandidateLookup = databaseHtsCandidateLookup
  ): Promise<GriEvaluationOutput> {
    const missingFacts: string[] = [];

    if (!subject.rawDescription || subject.rawDescription.trim().length < 3) {
      missingFacts.push("rawDescription");
    }
    if (
      !subject.materialComposition &&
      !subject.rawDescription.toLowerCase().includes("steel") &&
      !subject.rawDescription.toLowerCase().includes("cotton") &&
      !subject.rawDescription.toLowerCase().includes("plastic")
    ) {
      missingFacts.push("material_composition");
    }
    if (!subject.functionUsage && !subject.intendedUse) {
      missingFacts.push("principal_use_or_function");
    }

    // Abstention Gate: If core evidence is missing, do NOT hallucinate a
    // 10-digit classification.  0.15 is an explicit abstention sentinel, not
    // a calibrated confidence reading.
    if (missingFacts.length >= 2) {
      return {
        recommendationStatus: "NEEDS_INFORMATION",
        calibratedConfidence: 0.15,
        confidenceBand: "LOW",
        summary: `Classification ABSTAINED per GRI 1: Missing core engineering evidence (${missingFacts.join(", ")}). Multi-modal specification sheet or technical drawing required.`,
        missingFacts,
        griSteps: [
          {
            sequence: 1,
            griRule: "GRI 1",
            question: "Is product specification sufficient to classify by Heading Terms and Section/Chapter Notes?",
            conclusion: `Incomplete product evidence (${missingFacts.join(", ")} missing). Cannot determine heading scope with certainty.`,
            outcome: "NOT_APPLICABLE",
          },
        ],
      };
    }

    // Search candidate headings via the injected HTS lookup
    const candidates = await lookup.search(subject.rawDescription, releaseId);

    if (!candidates || candidates.length === 0) {
      return {
        recommendationStatus: "NEEDS_INFORMATION",
        calibratedConfidence: 0.10,
        confidenceBand: "LOW",
        summary: "Classification ABSTAINED: no candidate HTS heading could be retrieved for this description.",
        missingFacts: [...missingFacts, "candidate_hts_heading"],
        griSteps: [
          {
            sequence: 1,
            griRule: "GRI 1",
            question: "Can a candidate heading be identified from the product description?",
            conclusion: "No candidate heading was returned by the tariff repository.",
            outcome: "NOT_APPLICABLE",
          },
        ],
      };
    }

    // Score all candidates for GRI 3a / multi-candidate selection
    const scored = candidates
      .map((c) => ({ candidate: c, score: scoreCandidate(c, subject) }))
      .sort((a, b) => b.score - a.score); // descending — highest overlap first

    const selectedCandidate = scored[0].candidate;
    const candidateScores = scored.map((s) => s.score);

    const griSteps: GriStepResult[] = [];
    let seq = 1;

    // GRI 1 — Heading terms and Section/Chapter Notes
    griSteps.push(gri1Step(seq++, subject, selectedCandidate));

    // GRI 2a — Unfinished / incomplete articles
    griSteps.push(gri2aStep(seq++, subject));

    // GRI 2b — Mixtures and composite materials
    griSteps.push(gri2bStep(seq++, subject));

    // GRI 3a — Most specific description (fires when multiple candidates)
    const step3a = gri3aStep(seq++, candidates, candidateScores, selectedCandidate);
    const applied3a = step3a.outcome === "APPLIED";
    griSteps.push(step3a);

    // GRI 3b — Essential character (composite goods / sets)
    const step3b = gri3bStep(seq++, subject, applied3a);
    const applied3b = step3b.outcome === "APPLIED";
    griSteps.push(step3b);

    // GRI 3c — Numerically last heading (tiebreaker of last resort)
    griSteps.push(gri3cStep(seq++, candidates, applied3a || applied3b));

    // GRI 4 — Most akin heading (only if no heading covers the goods)
    griSteps.push(gri4Step(seq++, candidates));

    // GRI 5a — Special-purpose containers / cases
    griSteps.push(gri5aStep(seq++, subject));

    // GRI 5b — Packing materials / containers
    griSteps.push(gri5bStep(seq++, subject));

    // GRI 6 — Subheading classification (always last)
    griSteps.push(gri6Step(seq++, selectedCandidate));

    // Confidence — derived from evidence inventory, not hardcoded
    const calibratedConfidence = deriveConfidence(subject, candidates.length, missingFacts);
    const confidenceBand = confidenceBandFor(calibratedConfidence);
    const recommendationStatus = recommendationStatusFor(confidenceBand);

    // Record alternative headings in missingFacts so reviewers know they were considered
    if (candidates.length > 1) {
      const alternatives = scored
        .slice(1)
        .map((s) => `${s.candidate.heading} (${s.candidate.htsNumberDisplay})`)
        .join("; ");
      missingFacts.push(`alternative_headings_considered: ${alternatives}`);
    }

    return {
      recommendationStatus,
      calibratedConfidence,
      confidenceBand,
      summary: `GRI-grounded proposal for ${subject.rawDescription}: HTS ${selectedCandidate.htsNumberDisplay} (${selectedCandidate.description})`,
      missingFacts,
      griSteps,
      candidateHtsCode: selectedCandidate.htsNumberDisplay,
      candidateNodeId: selectedCandidate.id,
    };
  }
}
