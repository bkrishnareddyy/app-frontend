import { describe, it, expect } from "vitest";
import {
  FILING_STATUSES,
  FilingTransitionError,
  applyTransition,
  availableTransitions,
  canTransition,
  filingStages,
  isFilingStatus,
  isTerminal,
} from "@/modules/filings/filingStateMachine";

describe("filing status vocabulary", () => {
  it("matches the schema comment and rejects values outside it", () => {
    expect(isFilingStatus("Transmitted")).toBe(true);
    // "Submitted" was written by transmitFiling but is not a legal status.
    expect(isFilingStatus("Submitted")).toBe(false);
    expect(isFilingStatus("Filed")).toBe(false);
    expect(isFilingStatus("")).toBe(false);
    expect(isFilingStatus(null)).toBe(false);
  });

  it("covers every status with a timeline position", () => {
    for (const status of FILING_STATUSES) {
      expect(filingStages(status)).toHaveLength(4);
    }
  });
});

describe("transitions", () => {
  it("permits the happy path from draft to closed", () => {
    let status: string = "Draft";
    for (const t of ["validate.pass", "broker.approve", "transmit.send", "cbp.accept", "cbp.release", "close"] as const) {
      status = applyTransition(status, t);
    }
    expect(status).toBe("Closed");
  });

  it("refuses to transmit a filing that has not been broker approved", () => {
    for (const status of ["Draft", "Preparing", "ValidationFailed", "ReadyForBrokerReview"]) {
      expect(canTransition(status, "transmit.send")).toBe(false);
    }
    expect(canTransition("BrokerApproved", "transmit.send")).toBe(true);
  });

  it("refuses to transmit a cancelled, rejected or closed filing", () => {
    for (const status of ["Cancelled", "Closed", "Rejected", "CustomsHold"]) {
      expect(canTransition(status, "transmit.send")).toBe(false);
    }
  });

  it("refuses to re-transmit an already transmitted filing", () => {
    expect(canTransition("Transmitted", "transmit.send")).toBe(false);
    expect(canTransition("Accepted", "transmit.send")).toBe(false);
  });

  it("throws a typed error naming the source status", () => {
    try {
      applyTransition("Cancelled", "transmit.send");
      throw new Error("expected a transition error");
    } catch (err) {
      expect(err).toBeInstanceOf(FilingTransitionError);
      expect((err as FilingTransitionError).from).toBe("Cancelled");
      expect((err as Error).message).toContain("Cancelled");
    }
  });

  it("never transitions an unknown status", () => {
    expect(canTransition("Submitted", "cbp.accept")).toBe(false);
    expect(availableTransitions("Submitted")).toEqual([]);
  });

  it("quarantines simulated filings from every transition", () => {
    expect(availableTransitions("Simulation")).toEqual([]);
    expect(canTransition("Simulation", "cbp.accept")).toBe(false);
  });

  it("allows cancelling only before transmission", () => {
    expect(canTransition("Draft", "cancel")).toBe(true);
    expect(canTransition("BrokerApproved", "cancel")).toBe(true);
    expect(canTransition("Transmitted", "cancel")).toBe(false);
  });

  it("treats Closed and Cancelled as terminal", () => {
    expect(isTerminal("Closed")).toBe(true);
    expect(isTerminal("Cancelled")).toBe(true);
    expect(isTerminal("Released")).toBe(false);
    for (const terminal of ["Closed", "Cancelled"]) {
      expect(availableTransitions(terminal)).toEqual([]);
    }
  });

  it("lets a failed validation be re-run but not skipped", () => {
    expect(canTransition("ValidationFailed", "validate.pass")).toBe(true);
    expect(canTransition("ValidationFailed", "broker.approve")).toBe(false);
  });
});

describe("timeline derivation", () => {
  it("claims nothing has happened for a draft", () => {
    const stages = filingStages("Draft");
    expect(stages[0].state).toBe("current");
    expect(stages.slice(1).every((s) => s.state === "pending")).toBe(true);
  });

  it("marks a rejected filing blocked rather than complete", () => {
    const stages = filingStages("Rejected");
    expect(stages[3].state).toBe("blocked");
    expect(stages.slice(0, 3).every((s) => s.state === "complete")).toBe(true);
  });

  it("marks a validation failure blocked at the review stage", () => {
    const stages = filingStages("ValidationFailed");
    expect(stages[1].state).toBe("blocked");
    expect(stages[2].state).toBe("pending");
  });

  it("reports every stage pending for an unrecognised status", () => {
    expect(filingStages("Submitted").every((s) => s.state === "pending")).toBe(true);
  });
});
