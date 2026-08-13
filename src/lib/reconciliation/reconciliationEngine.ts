/**
 * Cross-document reconciliation engine (B-1).
 *
 * Takes ExtractionField rows grouped by document type and applies the rule
 * table from reconciliationRules.ts. Returns one ReconciliationResult per
 * rule that could be evaluated (both document types present and field
 * extracted from each).
 *
 * Pure and database-free — callers supply the data, this module only compares.
 */

import { RECONCILIATION_RULES, type DiscrepancyType, type NormalizationFn } from "./reconciliationRules";

export interface FieldRow {
  fieldName: string;
  value: string;
  confidence?: number | null;
}

export interface DocumentGroup {
  documentId: string;
  docType: string;
  fields: FieldRow[];
}

export interface ReconciliationResult {
  ruleId: string;
  fieldName: string;
  docTypeA: string;
  valueA: string;
  docTypeB: string;
  valueB: string;
  match: boolean;
  discrepancyType: DiscrepancyType;
  /** BLOCKING maps to "Critical", WARNING to "Warning", INFO to "Info". */
  severity: "BLOCKING" | "WARNING" | "INFO";
  description: string;
}

export interface EngineOutput {
  results: ReconciliationResult[];
  /** Rules that ran but found no discrepancy. */
  evaluatedRuleIds: string[];
  /** Rules that could not run because a document type or field was absent. */
  skippedRuleIds: string[];
}

// ── Normalization ─────────────────────────────────────────────────────────────

const LEGAL_SUFFIX_MAP: Record<string, string> = {
  " ltd": " limited",
  " llc": " limited liability company",
  " inc": " incorporated",
  " corp": " corporation",
  " co\\.": " company",
  " pvt": " private",
};

function applyNorm(value: string, fn: NormalizationFn): string | null {
  const raw = value.trim();
  if (raw === "") return null;

  switch (fn) {
    case "text":
      return raw.toLowerCase().replace(/\s+/g, " ");

    case "number": {
      const cleaned = raw.replace(/[^0-9.\-]/g, "");
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) && cleaned !== "" ? String(parsed) : null;
    }

    case "currency_amount": {
      // Strip currency symbols, codes (USD, EUR, CNY …), commas, spaces
      const stripped = raw.replace(/[^0-9.\-]/g, "");
      const parsed = Number(stripped);
      return Number.isFinite(parsed) && stripped !== "" ? String(parsed) : null;
    }

    case "party_name": {
      let s = raw.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
      for (const [abbr, full] of Object.entries(LEGAL_SUFFIX_MAP)) {
        s = s.replace(new RegExp(`${abbr}$`, "i"), full);
      }
      return s.trim();
    }

    case "container_id":
      return raw.toUpperCase().replace(/[\s\-]/g, "");
  }
}

function withinTolerance(a: string, b: string, tolerancePct: number): boolean {
  if (tolerancePct === 0) return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na === 0) return a === b;
  return Math.abs(na - nb) / Math.abs(na) <= tolerancePct / 100;
}

// ── Engine ────────────────────────────────────────────────────────────────────

function docTypeMatches(docType: string, pattern: string): boolean {
  return docType.toLowerCase().includes(pattern.toLowerCase());
}

function pickField(group: DocumentGroup, fieldKey: string): string | null {
  const row = group.fields.find((f) => f.fieldName === fieldKey);
  return row?.value?.trim() || null;
}

export function runReconciliationEngine(documents: DocumentGroup[]): EngineOutput {
  const results: ReconciliationResult[] = [];
  const evaluatedRuleIds: string[] = [];
  const skippedRuleIds: string[] = [];

  for (const rule of RECONCILIATION_RULES) {
    const groupsA = documents.filter((d) => docTypeMatches(d.docType, rule.docTypeA));
    const groupsB = documents.filter((d) => docTypeMatches(d.docType, rule.docTypeB));

    if (groupsA.length === 0 || groupsB.length === 0) {
      skippedRuleIds.push(rule.id);
      continue;
    }

    // Compare across the first matching document of each type. When a shipment
    // carries two invoices, only the first is used — multi-document sets are
    // handled by calling the engine separately per unique document pair.
    const groupA = groupsA[0];
    const groupB = groupsB[0];

    // Skip a rule where both sides matched the same document.
    if (groupA.documentId === groupB.documentId) {
      skippedRuleIds.push(rule.id);
      continue;
    }

    const rawA = pickField(groupA, rule.fieldKey);
    const rawB = pickField(groupB, rule.fieldKey);

    if (rawA === null || rawB === null) {
      skippedRuleIds.push(rule.id);
      continue;
    }

    const normA = applyNorm(rawA, rule.normalizationFn);
    const normB = applyNorm(rawB, rule.normalizationFn);

    if (normA === null || normB === null) {
      skippedRuleIds.push(rule.id);
      continue;
    }

    const match = withinTolerance(normA, normB, rule.tolerancePct);
    const severity: ReconciliationResult["severity"] = match
      ? "INFO"
      : rule.blocksFiling
        ? "BLOCKING"
        : "WARNING";

    evaluatedRuleIds.push(rule.id);

    if (!match) {
      results.push({
        ruleId: rule.id,
        fieldName: rule.fieldKey,
        docTypeA: groupA.docType,
        valueA: rawA,
        docTypeB: groupB.docType,
        valueB: rawB,
        match: false,
        discrepancyType: rule.discrepancyType,
        severity,
        description: rule.description,
      });
    }
  }

  return { results, evaluatedRuleIds, skippedRuleIds };
}
