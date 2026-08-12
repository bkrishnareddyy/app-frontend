/**
 * Extension points for the party engines Qubere does not have.
 *
 * The party master is built to receive registry-verification findings and
 * screening results from engines that know how to produce them. Neither
 * engine exists in this repository, and this file does not pretend
 * otherwise: every provider here is optional, the default registry returns
 * `null` for both, and callers get an explicit "not checked" rather than an
 * empty result that reads like a clean bill of health.
 *
 * That distinction is the whole point of the file, for the same reason it is
 * the point of `productIntelligence.ts`. A UI that shows "no matches found"
 * when nothing was screened is worse than one that shows "not screened",
 * because a compliance analyst acts on the first and investigates the second.
 *
 * This is also where two of the spec's binding out-of-scope rules are made
 * concrete rather than merely documented:
 *
 *   - "Never treat screening as a simple permanent Party flag." A
 *     `ScreeningFinding` is a point-in-time result with a timestamp and a
 *     provider name; there is nowhere on `Party` to write it as a lasting
 *     status, and none of the party service's mutation functions accept one.
 *   - "Never fabricate verification." A `RegistryVerificationFinding` has no
 *     status field — it cannot express VERIFIED. Recording a registration as
 *     VERIFIED still goes through `canVerifyRegistration`, which requires a
 *     named human reviewer and an evidence record regardless of what any
 *     provider reported.
 */

import type { PartyDetail } from "./partyService";

export interface ProviderEvidenceRef {
  /** How this was known. Mirrors PartySourceType. */
  sourceType: string;
  sourceDocumentId?: string | null;
  sourceExtractedFactId?: string | null;
  sourceReference?: string | null;
  sourceUrl?: string | null;
  description: string;
}

export interface RegistryVerificationFinding {
  country: string;
  registryName: string;
  /** Whether the registry's record matches what this party has on file. */
  matched: boolean;
  /** What the registry actually returned, for a reviewer to compare. */
  registryRecord: string;
  asOf: string;
  rationale: string;
  evidence: readonly ProviderEvidenceRef[];
}

export interface RegistryVerificationProvider {
  readonly name: string;
  /** Countries whose registries this provider can query. */
  readonly countries: readonly string[];
  verifyRegistration(party: PartyDetail, country: string): Promise<RegistryVerificationFinding | null>;
}

export interface ScreeningFinding {
  programme: string;
  outcome: "POTENTIAL_MATCH" | "NO_MATCH" | "INDETERMINATE";
  detail: string;
  /** When the screen was run. A screening finding is a point in time, never a standing status. */
  screenedAt: string;
  evidence: readonly ProviderEvidenceRef[];
}

export interface ScreeningProvider {
  readonly name: string;
  screen(party: PartyDetail): Promise<readonly ScreeningFinding[]>;
}

export interface PartyIntelligenceRegistry {
  registryVerification: RegistryVerificationProvider | null;
  screening: ScreeningProvider | null;
}

/**
 * The registry as shipped: nothing is wired up.
 *
 * Wiring a provider in is a deliberate act — assign it here (or replace this
 * module's export in a composition root) and the party detail screens will
 * start offering the corresponding action. Until then they show the
 * capability as unavailable.
 */
export const partyIntelligence: PartyIntelligenceRegistry = {
  registryVerification: null,
  screening: null,
};

export type CapabilityName = "registryVerification" | "screening";

export interface CapabilityStatus {
  capability: CapabilityName;
  available: boolean;
  providerName: string | null;
  /** What the UI says when it is unavailable. Never "no issues found". */
  message: string;
}

const UNAVAILABLE_MESSAGES: Record<CapabilityName, string> = {
  registryVerification:
    "No external registry lookup is connected. Registrations on this party are as recorded, and their status reflects only a person's own review, never an automatic registry check.",
  screening:
    "No sanctions, PEP, or denied-party screening engine is connected. This party has not been screened against any list. A resolved revalidation flag means a person looked again, not that a screen was run.",
};

export function capabilityStatus(
  capability: CapabilityName,
  registry: PartyIntelligenceRegistry = partyIntelligence
): CapabilityStatus {
  const provider = registry[capability];
  return {
    capability,
    available: provider !== null,
    providerName: provider?.name ?? null,
    message: provider === null ? UNAVAILABLE_MESSAGES[capability] : `Provided by ${provider.name}.`,
  };
}

export function allCapabilityStatuses(
  registry: PartyIntelligenceRegistry = partyIntelligence
): CapabilityStatus[] {
  return (["registryVerification", "screening"] as const).map((capability) => capabilityStatus(capability, registry));
}

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: CapabilityName) {
    super(UNAVAILABLE_MESSAGES[capability]);
    this.name = "CapabilityUnavailableError";
  }
}
