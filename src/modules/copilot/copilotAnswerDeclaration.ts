/**
 * The answer shape, declared for the model.
 *
 * This is the provider-facing twin of `modelAnswerSchema` in copilotContract.ts.
 * The declaration constrains what the model is able to emit; the zod schema
 * decides what the server accepts. Both exist on purpose — a provider that
 * quietly ignores a response schema, or a future provider with a weaker one,
 * must not become a way for an unvalidated answer to reach the panel.
 *
 * The two are kept in step by sharing the same constant enumerations, so a new
 * status or action type cannot be added to one and forgotten in the other.
 */

import { Type, type Schema } from "@google/genai";
import {
  COPILOT_ACTION_TYPES,
  COPILOT_ENTITY_TYPES,
  COPILOT_STATUSES,
  MAX_ANSWER_CHARS,
} from "./copilotContract";

const entityRef: Schema = {
  type: Type.OBJECT,
  description: "A Qubere record this answer is about. Ids must come from tool results.",
  properties: {
    type: { type: Type.STRING, enum: [...COPILOT_ENTITY_TYPES], description: "Record type." },
    id: { type: Type.STRING, description: "The Qubere id exactly as returned by a tool." },
    label: { type: Type.STRING, description: "How the record should be named to the user." },
  },
  required: ["type", "id", "label"],
};

const evidenceRef: Schema = {
  type: Type.OBJECT,
  description: "Provenance already recorded in Qubere. Never composed.",
  properties: {
    evidenceId: { type: Type.STRING, description: "An evidenceId seen in a tool result." },
    label: { type: Type.STRING, description: "What this evidence is, e.g. the source document." },
    detail: {
      type: Type.STRING,
      nullable: true,
      description: "Optional locator taken from the evidence row, e.g. a page reference.",
    },
  },
  required: ["evidenceId", "label"],
};

const action: Schema = {
  type: Type.OBJECT,
  description:
    "A navigation the user may want next. Qubere builds the route from the type and id; there is no URL to supply.",
  properties: {
    type: { type: Type.STRING, enum: [...COPILOT_ACTION_TYPES], description: "Action type." },
    entityId: { type: Type.STRING, description: "The id of the record to open." },
    label: { type: Type.STRING, description: "Short button text, e.g. \"Open product\"." },
  },
  required: ["type", "entityId", "label"],
};

export const COPILOT_ANSWER_DECLARATION: Schema = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: [...COPILOT_STATUSES],
      description: "How completely the question was answered from retrieved data.",
    },
    answer: {
      type: Type.STRING,
      description: `The answer to show the user, in markdown, at most ${MAX_ANSWER_CHARS} characters. No reasoning, no process narration.`,
    },
    entities: { type: Type.ARRAY, items: entityRef },
    evidence: { type: Type.ARRAY, items: evidenceRef },
    suggestedActions: { type: Type.ARRAY, items: action },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Compliance-relevant facts the user should know regardless of what was asked. One sentence each. Not disclaimers.",
    },
  },
  required: ["status", "answer"],
  propertyOrdering: ["status", "answer", "entities", "evidence", "suggestedActions", "warnings"],
};
