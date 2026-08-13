/**
 * Shipment lifecycle stages — F04-G-1.
 *
 * Each stage has an entry condition, the set of agent decisions that must be
 * present (not necessarily approved), the set of ExceptionItem categories that
 * must be resolved before the stage can complete, and a completion check.
 *
 * Ordering is strict: a shipment must pass every prior stage before entering
 * the next one. The Inngest `shipment.stage.advance` function evaluates these
 * conditions and advances the stage or creates a NEEDS_REVIEW decision when a
 * human gate is configured in AgentPolicyConfig.
 */

export const SHIPMENT_STAGES = [
  "DOCUMENT_INTAKE",
  "CLASSIFICATION",
  "VALUATION",
  "ORIGIN",
  "COMPLIANCE",
  "FILING_PREP",
  "READY_TO_FILE",
] as const;

export type ShipmentStage = (typeof SHIPMENT_STAGES)[number];

export const STAGE_INDEX = new Map<ShipmentStage, number>(
  SHIPMENT_STAGES.map((stage, i) => [stage, i])
);

export interface StageDefinition {
  stage: ShipmentStage;
  /** Human-readable label shown in the progress stepper. */
  label: string;
  /** Agent names whose decisions are expected in this stage. */
  agentNames: string[];
  /**
   * ExceptionItem categories that must all be resolved/waived before this
   * stage can be marked complete.
   */
  blockingExceptionCategories: string[];
  /**
   * Returns true when all stage-level completion criteria are met
   * (decisions present, blocking exceptions cleared).
   *
   * This is evaluated by the Inngest function; UI uses the fields above
   * to render status without re-implementing the logic.
   */
  isComplete: (ctx: StageCheckContext) => boolean;
}

export interface StageCheckContext {
  /** Agent names with at least one non-BLOCKED decision for this shipment. */
  completedAgents: Set<string>;
  /** Open (non-terminal) ExceptionItem categories on this shipment. */
  openExceptionCategories: Set<string>;
}

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  {
    stage: "DOCUMENT_INTAKE",
    label: "Document Intake",
    agentNames: ["Document Intake Agent", "Document Intelligence Agent"],
    blockingExceptionCategories: ["DOCUMENT"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Document Intake Agent") &&
      !openExceptionCategories.has("DOCUMENT"),
  },
  {
    stage: "CLASSIFICATION",
    label: "Classification",
    agentNames: ["Classification Agent", "Product Intelligence Agent"],
    blockingExceptionCategories: ["CLASSIFICATION", "MISSING_DATA"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Classification Agent") &&
      !openExceptionCategories.has("CLASSIFICATION") &&
      !openExceptionCategories.has("MISSING_DATA"),
  },
  {
    stage: "VALUATION",
    label: "Valuation",
    agentNames: ["Valuation Agent"],
    blockingExceptionCategories: ["VALUATION"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Valuation Agent") &&
      !openExceptionCategories.has("VALUATION"),
  },
  {
    stage: "ORIGIN",
    label: "Origin",
    agentNames: ["Origin Agent"],
    blockingExceptionCategories: ["CONFLICT"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Origin Agent") &&
      !openExceptionCategories.has("CONFLICT"),
  },
  {
    stage: "COMPLIANCE",
    label: "Compliance",
    agentNames: ["Compliance Agent"],
    blockingExceptionCategories: ["COMPLIANCE"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Compliance Agent") &&
      !openExceptionCategories.has("COMPLIANCE"),
  },
  {
    stage: "FILING_PREP",
    label: "Filing Prep",
    agentNames: ["Filing Readiness Agent"],
    blockingExceptionCategories: ["FILING", "VALIDATION"],
    isComplete: ({ completedAgents, openExceptionCategories }) =>
      completedAgents.has("Filing Readiness Agent") &&
      !openExceptionCategories.has("FILING") &&
      !openExceptionCategories.has("VALIDATION"),
  },
  {
    stage: "READY_TO_FILE",
    label: "Ready to File",
    agentNames: [],
    blockingExceptionCategories: [],
    isComplete: () => true,
  },
];

/** The first stage — where new shipments start. */
export const INITIAL_STAGE: ShipmentStage = "DOCUMENT_INTAKE";

/** The terminal stage — nothing more to do after this. */
export const TERMINAL_STAGE: ShipmentStage = "READY_TO_FILE";

export function stageDefinition(stage: ShipmentStage): StageDefinition {
  const def = STAGE_DEFINITIONS.find((d) => d.stage === stage);
  if (!def) throw new Error(`Unknown stage: ${stage}`);
  return def;
}

export function nextStage(stage: ShipmentStage): ShipmentStage | null {
  const idx = STAGE_INDEX.get(stage) ?? -1;
  return SHIPMENT_STAGES[idx + 1] ?? null;
}

export function isTerminalStage(stage: ShipmentStage): boolean {
  return stage === TERMINAL_STAGE;
}

/**
 * Returns stages in order with their completion status given the current context.
 * Used by the stage progress stepper.
 */
export function evaluateStages(
  currentStage: ShipmentStage | null,
  ctx: StageCheckContext
): Array<{ stage: ShipmentStage; label: string; status: "complete" | "active" | "pending" | "blocked" }> {
  const current = currentStage ?? INITIAL_STAGE;
  const currentIdx = STAGE_INDEX.get(current) ?? 0;

  return STAGE_DEFINITIONS.map((def, i) => {
    if (i < currentIdx) return { stage: def.stage, label: def.label, status: "complete" as const };
    if (i === currentIdx) {
      const done = def.isComplete(ctx);
      return { stage: def.stage, label: def.label, status: done ? "complete" : "active" };
    }
    return { stage: def.stage, label: def.label, status: "pending" as const };
  });
}
