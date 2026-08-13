/**
 * Filing lifecycle. The status vocabulary matches CustomsFiling.filingStatus in
 * prisma/schema.prisma; any value outside FILING_STATUSES is not persistable.
 */

export const FILING_STATUSES = [
  "Draft",
  "Preparing",
  "ValidationFailed",
  "ReadyForBrokerReview",
  "BrokerApproved",
  "TransmissionPending",
  "Transmitted",
  "Accepted",
  "Rejected",
  "DocumentsRequested",
  "CustomsHold",
  "Released",
  "CancellationRequested",
  "Cancelled",
  "Closed",
  "Simulation",
] as const;

export type FilingStatus = (typeof FILING_STATUSES)[number];

export function isFilingStatus(value: unknown): value is FilingStatus {
  return typeof value === "string" && (FILING_STATUSES as readonly string[]).includes(value);
}

/** Statuses from which no further transition is legal. */
export const TERMINAL_STATUSES: readonly FilingStatus[] = ["Closed", "Cancelled"];

/** Statuses reached by a CBP response rather than by an operator action. */
export const CBP_CONTROLLED_STATUSES: readonly FilingStatus[] = [
  "Accepted",
  "Rejected",
  "DocumentsRequested",
  "CustomsHold",
  "Released",
];

export type FilingTransition =
  | "prepare"
  | "validate.pass"
  | "validate.fail"
  | "broker.approve"
  | "broker.reject"
  | "transmit.queue"
  | "transmit.send"
  | "cbp.accept"
  | "cbp.reject"
  | "cbp.requestDocuments"
  | "cbp.hold"
  | "cbp.release"
  | "cancel.request"
  | "cbp.cancel"
  | "cancel"
  | "close"
  | "resubmit";

interface TransitionRule {
  from: readonly FilingStatus[];
  to: FilingStatus;
}

const TRANSITIONS: Record<FilingTransition, TransitionRule> = {
  prepare: { from: ["Draft", "ValidationFailed"], to: "Preparing" },
  "validate.pass": { from: ["Draft", "Preparing", "ValidationFailed"], to: "ReadyForBrokerReview" },
  "validate.fail": { from: ["Draft", "Preparing", "ReadyForBrokerReview"], to: "ValidationFailed" },
  "broker.approve": { from: ["ReadyForBrokerReview"], to: "BrokerApproved" },
  "broker.reject": { from: ["ReadyForBrokerReview"], to: "ValidationFailed" },
  "transmit.queue": { from: ["BrokerApproved"], to: "TransmissionPending" },
  "transmit.send": { from: ["BrokerApproved", "TransmissionPending"], to: "Transmitted" },
  "cbp.accept": { from: ["Transmitted"], to: "Accepted" },
  "cbp.reject": { from: ["Transmitted"], to: "Rejected" },
  "cbp.requestDocuments": { from: ["Transmitted", "Accepted"], to: "DocumentsRequested" },
  "cbp.hold": { from: ["Transmitted", "Accepted"], to: "CustomsHold" },
  "cbp.release": { from: ["Accepted", "CustomsHold", "DocumentsRequested"], to: "Released" },
  cancel: {
    from: [
      "Draft",
      "Preparing",
      "ValidationFailed",
      "ReadyForBrokerReview",
      "BrokerApproved",
      "TransmissionPending",
    ],
    to: "Cancelled",
  },
  // Sending a CANCELLATION message is itself an operator action with an
  // immediate, visible effect -- the filing is now mid-cancellation, not
  // silently still "Transmitted" until a response happens to arrive.
  // FilingChildActionRule decides *which* statuses offer CANCEL at all (see
  // resolveChildActions()); this transition is what firing it actually does.
  "cancel.request": {
    from: ["TransmissionPending", "Transmitted", "Accepted", "Rejected", "DocumentsRequested", "CustomsHold"],
    to: "CancellationRequested",
  },
  // A confirmed cancellation, applied once the CANCELLED response actually
  // arrives -- via FilingResponseStatusMapping, exactly like
  // cbp.accept/cbp.reject/etc. Distinct from `cancel` above (which withdraws
  // a filing before CBP ever saw it): this one only ever follows
  // cancel.request, never fires directly from a live status.
  "cbp.cancel": {
    from: ["CancellationRequested"],
    to: "Cancelled",
  },
  close: { from: ["Released", "Rejected"], to: "Closed" },
  // Correcting and resending after CBP (or pre-transmission validation)
  // flagged a problem. Added for the canonical-messaging RESUBMIT message
  // type -- deliberately does not touch any existing transition's from/to list.
  resubmit: { from: ["ValidationFailed", "Rejected", "DocumentsRequested"], to: "Transmitted" },
};

export class FilingTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly transition: FilingTransition
  ) {
    super(`Filing cannot ${transition} from status "${from}".`);
    this.name = "FilingTransitionError";
  }
}

export function canTransition(from: string, transition: FilingTransition): boolean {
  // "Simulation" filings are excluded so practice runs never reach a real CBP status.
  if (!isFilingStatus(from) || from === "Simulation") return false;
  return TRANSITIONS[transition].from.includes(from);
}

/** Returns the status to persist, or throws if the transition is not legal from `from`. */
export function applyTransition(from: string, transition: FilingTransition): FilingStatus {
  if (!canTransition(from, transition)) {
    throw new FilingTransitionError(from, transition);
  }
  return TRANSITIONS[transition].to;
}

export function availableTransitions(from: string): FilingTransition[] {
  return (Object.keys(TRANSITIONS) as FilingTransition[]).filter((t) => canTransition(from, t));
}

export function isTerminal(status: string): boolean {
  return isFilingStatus(status) && TERMINAL_STATUSES.includes(status);
}

export type FilingStageState = "complete" | "current" | "blocked" | "pending";

export interface FilingStage {
  key: string;
  label: string;
  state: FilingStageState;
}

const STAGE_ORDER = ["prepare", "review", "transmit", "clearance"] as const;
type StageKey = (typeof STAGE_ORDER)[number];

const STAGE_LABELS: Record<StageKey, string> = {
  prepare: "Prepare filing package",
  review: "Validation & broker review",
  transmit: "Transmit to customs authority",
  clearance: "Customs response & closure",
};

/** How far each status has progressed: index of the stage it currently sits in. */
const STATUS_STAGE: Record<FilingStatus, { index: number; blocked: boolean }> = {
  Draft: { index: 0, blocked: false },
  Preparing: { index: 0, blocked: false },
  ValidationFailed: { index: 1, blocked: true },
  ReadyForBrokerReview: { index: 1, blocked: false },
  BrokerApproved: { index: 1, blocked: false },
  TransmissionPending: { index: 2, blocked: false },
  Transmitted: { index: 2, blocked: false },
  Accepted: { index: 3, blocked: false },
  Rejected: { index: 3, blocked: true },
  DocumentsRequested: { index: 3, blocked: true },
  CustomsHold: { index: 3, blocked: true },
  Released: { index: 3, blocked: false },
  CancellationRequested: { index: 3, blocked: false },
  Cancelled: { index: 3, blocked: true },
  Closed: { index: 3, blocked: false },
  Simulation: { index: 0, blocked: false },
};

/**
 * Derives the timeline from the stored status. Stages after the current one are
 * "pending" and carry no claim about having happened.
 */
export function filingStages(status: string): FilingStage[] {
  const position = isFilingStatus(status) ? STATUS_STAGE[status] : null;

  return STAGE_ORDER.map((key, index) => {
    if (!position) return { key, label: STAGE_LABELS[key], state: "pending" as const };
    if (index < position.index) return { key, label: STAGE_LABELS[key], state: "complete" as const };
    if (index > position.index) return { key, label: STAGE_LABELS[key], state: "pending" as const };
    return {
      key,
      label: STAGE_LABELS[key],
      state: position.blocked ? ("blocked" as const) : ("current" as const),
    };
  });
}
