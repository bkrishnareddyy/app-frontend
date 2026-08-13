/**
 * The grounding ledger.
 *
 * This is the mechanism that makes "never invent a Qubere record" enforceable
 * rather than merely instructed.
 *
 * Every id a tool returns during a turn is recorded here, together with the
 * label the *service* gave it. When the model's answer comes back citing
 * entities, evidence and actions, each citation is looked up in the ledger:
 *
 *   - an id the tools never returned is dropped, and a warning is added;
 *   - a label the model rewrote is replaced with the recorded one, so a product
 *     cannot be renamed on its way through the answer;
 *   - an action is only rendered once its subject id is in the ledger under the
 *     matching type, and its href is built by copilotActions.ts, never by the
 *     model.
 *
 * The prose is not rewritten. A model that describes a record it never retrieved
 * still produces prose that says so, which is why the system prompt carries the
 * grounding rules too — the ledger is the second line, not the only one.
 */

import {
  COPILOT_SCHEMA_VERSION,
  type CopilotAction,
  type CopilotAnswer,
  type CopilotEntityRef,
  type CopilotEntityType,
  type CopilotEvidenceRef,
  type ModelAnswer,
} from "./copilotContract";
import { actionHref, actionSubject } from "./copilotActions";

interface LedgerEvidence {
  evidenceId: string;
  label: string;
  detail: string | null;
  /** The record whose page shows this evidence, so VIEW_EVIDENCE can route. */
  owner: { type: "PRODUCT" | "PARTY"; id: string } | null;
}

export class CopilotLedger {
  private readonly entities = new Map<string, CopilotEntityRef>();
  private readonly evidence = new Map<string, LedgerEvidence>();

  private static entityKey(type: CopilotEntityType, id: string): string {
    return `${type}:${id}`;
  }

  /** Records a record a tool actually returned, from this account. */
  recordEntity(type: CopilotEntityType, id: string, label: string): void {
    if (!id) return;
    const key = CopilotLedger.entityKey(type, id);
    // First writer wins: the detail tool's label is no better than the search
    // tool's, and re-labelling mid-turn would make the answer inconsistent with
    // what the user already saw stream past.
    if (!this.entities.has(key)) {
      this.entities.set(key, { type, id, label: label || id });
    }
  }

  recordEvidence(
    evidenceId: string,
    label: string,
    detail: string | null,
    owner: LedgerEvidence["owner"]
  ): void {
    if (!evidenceId) return;
    if (!this.evidence.has(evidenceId)) {
      this.evidence.set(evidenceId, { evidenceId, label: label || evidenceId, detail, owner });
    }
  }

  hasEntity(type: CopilotEntityType, id: string): boolean {
    return this.entities.has(CopilotLedger.entityKey(type, id));
  }

  hasEvidence(evidenceId: string): boolean {
    return this.evidence.has(evidenceId);
  }

  /** True when no tool returned anything: the answer cannot cite a Qubere record. */
  get isEmpty(): boolean {
    return this.entities.size === 0 && this.evidence.size === 0;
  }

  get size(): number {
    return this.entities.size + this.evidence.size;
  }

  private lookupEntity(type: CopilotEntityType, id: string): CopilotEntityRef | null {
    return this.entities.get(CopilotLedger.entityKey(type, id)) ?? null;
  }

  private lookupEvidence(evidenceId: string): LedgerEvidence | null {
    return this.evidence.get(evidenceId) ?? null;
  }

  /**
   * Any entity of any type carrying this id. Actions cite a bare id, so the type
   * is taken from the action rather than the citation — but an id recorded under
   * a *different* type must not satisfy an action, or OPEN_PRODUCT could be made
   * to open a shipment id. This is only used to distinguish "unknown id" from
   * "known id, wrong type" in the warning text.
   */
  private knownUnderAnyType(id: string): CopilotEntityType | null {
    for (const entity of this.entities.values()) {
      if (entity.id === id) return entity.type;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private validateEntities(refs: CopilotEntityRef[]): {
    kept: CopilotEntityRef[];
    dropped: number;
  } {
    const kept: CopilotEntityRef[] = [];
    const seen = new Set<string>();
    let dropped = 0;

    for (const ref of refs) {
      const known = this.lookupEntity(ref.type, ref.id);
      if (!known) {
        dropped += 1;
        continue;
      }
      const key = CopilotLedger.entityKey(known.type, known.id);
      if (seen.has(key)) continue;
      seen.add(key);
      // The recorded ref, not the cited one: the label is the service's.
      kept.push(known);
    }

    return { kept, dropped };
  }

  private validateEvidence(refs: CopilotEvidenceRef[]): {
    kept: CopilotEvidenceRef[];
    dropped: number;
  } {
    const kept: CopilotEvidenceRef[] = [];
    const seen = new Set<string>();
    let dropped = 0;

    for (const ref of refs) {
      const known = this.lookupEvidence(ref.evidenceId);
      if (!known) {
        dropped += 1;
        continue;
      }
      if (seen.has(known.evidenceId)) continue;
      seen.add(known.evidenceId);
      kept.push({ evidenceId: known.evidenceId, label: known.label, detail: known.detail });
    }

    return { kept, dropped };
  }

  private validateActions(actions: ModelAnswer["suggestedActions"]): {
    kept: CopilotAction[];
    dropped: number;
    wrongType: number;
  } {
    const kept: CopilotAction[] = [];
    const seen = new Set<string>();
    let dropped = 0;
    let wrongType = 0;

    for (const action of actions) {
      const subject = actionSubject(action.type);

      if (subject === "EVIDENCE") {
        const known = this.lookupEvidence(action.entityId);
        if (!known) {
          dropped += 1;
          continue;
        }
        const href = actionHref(action.type, action.entityId, known.owner);
        if (!href) {
          // Evidence Qubere holds but cannot show on a page. Saying nothing is
          // better than an action that goes nowhere.
          dropped += 1;
          continue;
        }
        const key = `${action.type}:${action.entityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push({ ...action, label: action.label.slice(0, 80), href });
        continue;
      }

      if (!this.hasEntity(subject, action.entityId)) {
        if (this.knownUnderAnyType(action.entityId)) wrongType += 1;
        else dropped += 1;
        continue;
      }

      const href = actionHref(action.type, action.entityId);
      if (!href) {
        dropped += 1;
        continue;
      }

      const key = `${action.type}:${action.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ ...action, label: action.label.slice(0, 80), href });
    }

    return { kept, dropped, wrongType };
  }

  /**
   * Turns a validated model answer into the answer the client receives.
   *
   * Returns the ungrounded counts alongside it so the caller can record them as
   * telemetry: a rising drop rate is the signal that a prompt or a tool has
   * started encouraging the model to cite what it did not retrieve.
   */
  ground(
    model: ModelAnswer,
    options: { requestId: string; steps: string[] }
  ): { answer: CopilotAnswer; droppedCitations: number } {
    const entities = this.validateEntities(model.entities);
    const evidence = this.validateEvidence(model.evidence);
    const actions = this.validateActions(model.suggestedActions);

    const warnings = [...model.warnings];
    const droppedCitations =
      entities.dropped + evidence.dropped + actions.dropped + actions.wrongType;

    if (entities.dropped > 0 || actions.dropped > 0 || actions.wrongType > 0) {
      warnings.push(
        "Some references in this answer did not match a record retrieved from your account and were removed. Open the record directly to confirm."
      );
    }
    if (evidence.dropped > 0) {
      warnings.push(
        "Supporting evidence referenced in this answer was not found in Qubere and has been removed."
      );
    }

    return {
      droppedCitations,
      answer: {
        schemaVersion: COPILOT_SCHEMA_VERSION,
        status: model.status,
        answer: model.answer,
        entities: entities.kept,
        evidence: evidence.kept,
        suggestedActions: actions.kept,
        warnings,
        steps: options.steps,
        requestId: options.requestId,
      },
    };
  }
}
