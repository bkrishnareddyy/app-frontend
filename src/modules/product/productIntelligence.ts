/**
 * Extension points for the customs engines Qubere does not have.
 *
 * The product master is built to receive classification proposals, origin
 * determinations, and regulatory findings from engines that know how to make
 * them. None of those engines exists in this repository, and this file does not
 * pretend otherwise: every provider here is optional, the default registry
 * returns `null` for all of them, and callers get an explicit
 * "no provider is configured" rather than an empty result that reads like a
 * clean bill of health.
 *
 * That distinction is the whole point of the file. A UI that shows "no
 * restrictions found" when nothing was checked is worse than one that shows
 * "not checked", because a broker acts on the first and investigates the second.
 *
 * What a provider may and may not do is fixed by the return types below:
 *
 *   - A classification provider returns a *proposal*. It cannot express APPROVED,
 *     because `ProposedClassification` has no status field, and the service that
 *     records it uses `initialClassificationStatus("AGENT_PROPOSED")`, which is
 *     CANDIDATE.
 *   - An origin provider returns a *determination with its rule and its inputs*.
 *     It cannot return a bare country, so nothing can produce an origin claim
 *     without saying which rule it applied and what it applied it to.
 *   - Every provider must return evidence references. A finding with no evidence
 *     is not accepted by the recording service.
 */

import type { ProductDetail } from "./productService";

export interface ProviderEvidenceRef {
  /** How this was known. Mirrors ProductSourceType. */
  sourceType: string;
  sourceDocumentId?: string | null;
  sourceExtractedFactId?: string | null;
  sourceReference?: string | null;
  sourceUrl?: string | null;
  description: string;
}

export interface ProposedClassification {
  jurisdiction: string;
  nomenclature: string;
  classificationCode: string;
  /** The reasoning a reviewer reads before deciding. Required, not optional. */
  rationale: string;
  /** Evidence the proposal rests on. An empty list is rejected on recording. */
  evidence: readonly ProviderEvidenceRef[];
  /**
   * The provider's own confidence, for display and triage only. It has no
   * bearing on status: no confidence value causes a proposal to be approved.
   */
  confidence?: number;
}

export interface ClassificationProvider {
  readonly name: string;
  /** Jurisdictions this provider will answer for. */
  readonly jurisdictions: readonly string[];
  proposeClassification(
    product: ProductDetail,
    jurisdiction: string
  ): Promise<readonly ProposedClassification[]>;
}

export interface OriginDetermination {
  jurisdiction: string;
  /** The country determined, as ISO alpha-2. */
  countryCode: string;
  /** The rule applied, named specifically enough to be checked. */
  ruleApplied: string;
  /** The facts the rule was applied to. */
  inputs: readonly string[];
  rationale: string;
  evidence: readonly ProviderEvidenceRef[];
}

export interface OriginProvider {
  readonly name: string;
  readonly jurisdictions: readonly string[];
  determineOrigin(product: ProductDetail, jurisdiction: string): Promise<OriginDetermination | null>;
}

export interface RegulatoryFinding {
  jurisdiction: string;
  programme: string;
  /** What the programme requires, or that it does not apply. */
  outcome: "APPLIES" | "DOES_NOT_APPLY" | "INDETERMINATE";
  detail: string;
  evidence: readonly ProviderEvidenceRef[];
}

export interface RegulatoryProvider {
  readonly name: string;
  readonly jurisdictions: readonly string[];
  screen(product: ProductDetail, jurisdiction: string): Promise<readonly RegulatoryFinding[]>;
}

export interface ProductIntelligenceRegistry {
  classification: ClassificationProvider | null;
  origin: OriginProvider | null;
  regulatory: RegulatoryProvider | null;
}

/**
 * The registry as shipped: nothing is wired up.
 *
 * Wiring a provider in is a deliberate act — assign it here (or replace this
 * module's export in a composition root) and the product detail screens will
 * start offering the corresponding action. Until then they show the capability
 * as unavailable.
 */
export const productIntelligence: ProductIntelligenceRegistry = {
  classification: null,
  origin: null,
  regulatory: null,
};

export type CapabilityName = "classification" | "origin" | "regulatory";

export interface CapabilityStatus {
  capability: CapabilityName;
  available: boolean;
  providerName: string | null;
  /** What the UI says when it is unavailable. Never "no issues found". */
  message: string;
}

const UNAVAILABLE_MESSAGES: Record<CapabilityName, string> = {
  classification:
    "No classification engine is connected. Classifications on this product are the ones people entered or imported; nothing has proposed a code.",
  origin:
    "No rules-of-origin engine is connected. Origin claims on this product are as recorded and have not been determined against any rule.",
  regulatory:
    "No regulatory screening engine is connected. This product has not been screened against any control, sanctions, or licensing programme.",
};

export function capabilityStatus(
  capability: CapabilityName,
  registry: ProductIntelligenceRegistry = productIntelligence
): CapabilityStatus {
  const provider = registry[capability];
  return {
    capability,
    available: provider !== null,
    providerName: provider?.name ?? null,
    message:
      provider === null
        ? UNAVAILABLE_MESSAGES[capability]
        : `Provided by ${provider.name}.`,
  };
}

export function allCapabilityStatuses(
  registry: ProductIntelligenceRegistry = productIntelligence
): CapabilityStatus[] {
  return (["classification", "origin", "regulatory"] as const).map((capability) =>
    capabilityStatus(capability, registry)
  );
}

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: CapabilityName) {
    super(UNAVAILABLE_MESSAGES[capability]);
    this.name = "CapabilityUnavailableError";
  }
}
