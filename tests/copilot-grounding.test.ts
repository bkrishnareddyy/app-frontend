import { describe, it, expect } from "vitest";
import { CopilotLedger } from "@/modules/copilot/copilotLedger";
import { actionHref, actionSubject, openActionFor } from "@/modules/copilot/copilotActions";
import {
  COPILOT_ACTION_TYPES,
  COPILOT_ENTITY_TYPES,
  copilotAnswerSchema,
  modelAnswerSchema,
  type ModelAnswer,
} from "@/modules/copilot/copilotContract";

/**
 * Grounding and action safety.
 *
 * Two guarantees are tested here. A citation the tools never produced does not
 * reach the user, and a route is never a string the model wrote. Both are
 * properties of the ledger and the action map, so they hold whatever the model
 * emits — which is the point of putting them in code rather than the prompt.
 */

function modelAnswer(overrides: Partial<ModelAnswer> = {}): ModelAnswer {
  return modelAnswerSchema.parse({
    status: "ANSWERED",
    answer: "Widget A is active.",
    entities: [],
    evidence: [],
    suggestedActions: [],
    warnings: [],
    ...overrides,
  });
}

const GROUND = { requestId: "req-1", steps: ["Looking up product"] };

describe("entity citations are checked against retrieved records", () => {
  it("keeps an entity a tool actually returned", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({ entities: [{ type: "PRODUCT", id: "prod_1", label: "Widget A" }] }),
      GROUND
    );

    expect(answer.entities).toEqual([{ type: "PRODUCT", id: "prod_1", label: "Widget A" }]);
    expect(droppedCitations).toBe(0);
    expect(answer.warnings).toEqual([]);
  });

  it("drops an id no tool returned and warns the user", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({
        entities: [
          { type: "PRODUCT", id: "prod_1", label: "Widget A" },
          { type: "PRODUCT", id: "prod_invented", label: "Widget Q" },
        ],
      }),
      GROUND
    );

    expect(answer.entities.map((e) => e.id)).toEqual(["prod_1"]);
    expect(droppedCitations).toBe(1);
    expect(answer.warnings.join(" ")).toContain("did not match a record retrieved from your account");
  });

  it("replaces a label the model rewrote with the one the service recorded", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer } = ledger.ground(
      modelAnswer({
        entities: [{ type: "PRODUCT", id: "prod_1", label: "Widget A (origin: Germany)" }],
      }),
      GROUND
    );

    // A product cannot be renamed on its way through an answer.
    expect(answer.entities[0].label).toBe("Widget A");
  });

  it("does not let an id recorded under one type satisfy another", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("SHIPMENT", "shared_id", "SHP-1");

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({ entities: [{ type: "PRODUCT", id: "shared_id", label: "SHP-1" }] }),
      GROUND
    );

    expect(answer.entities).toEqual([]);
    expect(droppedCitations).toBe(1);
  });

  it("de-duplicates repeated citations", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PARTY", "party_1", "Acme GmbH");

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({
        entities: [
          { type: "PARTY", id: "party_1", label: "Acme GmbH" },
          { type: "PARTY", id: "party_1", label: "Acme GmbH" },
        ],
      }),
      GROUND
    );

    expect(answer.entities).toHaveLength(1);
    expect(droppedCitations).toBe(0);
  });

  it("keeps the first recorded label when a later tool relabels the same record", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");
    ledger.recordEntity("PRODUCT", "prod_1", "WIDGET-A-SKU");

    const { answer } = ledger.ground(
      modelAnswer({ entities: [{ type: "PRODUCT", id: "prod_1", label: "anything" }] }),
      GROUND
    );

    expect(answer.entities[0].label).toBe("Widget A");
  });
});

describe("evidence is never fabricated", () => {
  it("drops an invented evidence id and says the evidence was removed", () => {
    const ledger = new CopilotLedger();
    ledger.recordEvidence("ev_1", "Supplier declaration", "Page 2", {
      type: "PRODUCT",
      id: "prod_1",
    });

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({
        evidence: [
          { evidenceId: "ev_1", label: "Supplier declaration", detail: "Page 2" },
          { evidenceId: "ev_made_up", label: "Origin certificate", detail: null },
        ],
      }),
      GROUND
    );

    expect(answer.evidence.map((e) => e.evidenceId)).toEqual(["ev_1"]);
    expect(droppedCitations).toBe(1);
    expect(answer.warnings.join(" ")).toContain("was not found in Qubere");
  });

  it("uses the recorded label and detail, not the cited ones", () => {
    const ledger = new CopilotLedger();
    ledger.recordEvidence("ev_1", "Supplier declaration", "Page 2", null);

    const { answer } = ledger.ground(
      modelAnswer({
        evidence: [{ evidenceId: "ev_1", label: "Verified origin proof", detail: "Page 9" }],
      }),
      GROUND
    );

    expect(answer.evidence[0]).toEqual({
      evidenceId: "ev_1",
      label: "Supplier declaration",
      detail: "Page 2",
    });
  });
});

describe("actions are typed, grounded and routed by the server", () => {
  it("builds the href itself for a grounded action", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "OPEN_PRODUCT", entityId: "prod_1", label: "Open product" }],
      }),
      GROUND
    );

    expect(answer.suggestedActions).toEqual([
      {
        type: "OPEN_PRODUCT",
        entityId: "prod_1",
        label: "Open product",
        href: "/app/products/prod_1",
      },
    ]);
  });

  it("rejects an action whose subject was retrieved under a different type", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("SHIPMENT", "shp_1", "SHP-1");

    const { answer, droppedCitations } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "OPEN_PRODUCT", entityId: "shp_1", label: "Open product" }],
      }),
      GROUND
    );

    // OPEN_PRODUCT against a shipment id would have produced /app/products/shp_1.
    expect(answer.suggestedActions).toEqual([]);
    expect(droppedCitations).toBe(1);
  });

  it("drops an action against an id that was never retrieved", () => {
    const ledger = new CopilotLedger();

    const { answer } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "OPEN_SHIPMENT", entityId: "shp_guess", label: "Open" }],
      }),
      GROUND
    );

    expect(answer.suggestedActions).toEqual([]);
  });

  it("routes VIEW_EVIDENCE through the record that carries the evidence", () => {
    const ledger = new CopilotLedger();
    ledger.recordEvidence("ev_1", "Supplier declaration", null, { type: "PARTY", id: "party_1" });

    const { answer } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "VIEW_EVIDENCE", entityId: "ev_1", label: "View evidence" }],
      }),
      GROUND
    );

    expect(answer.suggestedActions[0].href).toBe("/app/parties/party_1#evidence-ev_1");
  });

  it("drops VIEW_EVIDENCE when Qubere has no page that shows it", () => {
    const ledger = new CopilotLedger();
    ledger.recordEvidence("ev_1", "Supplier declaration", null, null);

    const { answer } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "VIEW_EVIDENCE", entityId: "ev_1", label: "View evidence" }],
      }),
      GROUND
    );

    expect(answer.suggestedActions).toEqual([]);
  });

  it("truncates an over-long action label rather than rejecting the answer", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer } = ledger.ground(
      modelAnswer({
        suggestedActions: [{ type: "OPEN_PRODUCT", entityId: "prod_1", label: "x".repeat(80) }],
      }),
      GROUND
    );

    expect(answer.suggestedActions[0].label.length).toBeLessThanOrEqual(80);
  });
});

describe("the model cannot express a URL", () => {
  it("has no href field in the schema it emits", () => {
    const parsed = modelAnswerSchema.parse({
      status: "ANSWERED",
      answer: "See the record.",
      suggestedActions: [
        {
          type: "OPEN_PRODUCT",
          entityId: "prod_1",
          label: "Open",
          // An href the model tried to supply. It is not in the schema.
          href: "https://evil.example.com/steal",
        },
      ],
    });

    expect(parsed.suggestedActions[0]).not.toHaveProperty("href");
  });

  it("maps every action type to a subject and every entity type to an action", () => {
    for (const type of COPILOT_ACTION_TYPES) {
      expect(actionSubject(type)).toBeTruthy();
    }
    for (const type of COPILOT_ENTITY_TYPES) {
      expect(actionSubject(openActionFor(type))).toBe(type);
    }
  });

  it("keeps every built route inside the Qubere app", () => {
    for (const type of COPILOT_ACTION_TYPES) {
      const href = actionHref(type, "id_1", { type: "PRODUCT", id: "prod_1" });
      expect(href, type).not.toBeNull();
      expect(href!.startsWith("/app/"), `${type} -> ${href}`).toBe(true);
    }
  });

  it("encodes an id so it cannot escape its route segment", () => {
    expect(actionHref("OPEN_PRODUCT", "../../admin")).toBe("/app/products/..%2F..%2Fadmin");
    expect(actionHref("OPEN_DOCUMENT", "a&b=c")).toBe("/app/documents?documentId=a%26b%3Dc");
  });
});

describe("the grounded answer satisfies the wire contract", () => {
  it("parses cleanly, including the warnings the ledger appended", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "prod_1", "Widget A");

    const { answer } = ledger.ground(
      modelAnswer({
        warnings: ["No approved origin determination is on record for this product."],
        entities: [
          { type: "PRODUCT", id: "prod_1", label: "Widget A" },
          { type: "PRODUCT", id: "nope", label: "Ghost" },
        ],
        evidence: [{ evidenceId: "ghost", label: "Ghost evidence", detail: null }],
      }),
      GROUND
    );

    // Two ledger warnings on top of the model's one: the schema allows the
    // headroom precisely so grounding can never make an answer unparseable.
    expect(answer.warnings).toHaveLength(3);
    expect(() => copilotAnswerSchema.parse(answer)).not.toThrow();
    expect(answer.schemaVersion).toBe("1");
    expect(answer.requestId).toBe("req-1");
    expect(answer.steps).toEqual(["Looking up product"]);
  });

  it("reports an empty ledger, so the service can tell nothing was retrieved", () => {
    const ledger = new CopilotLedger();
    expect(ledger.isEmpty).toBe(true);
    ledger.recordEntity("TASK", "task_1", "Review classification");
    expect(ledger.isEmpty).toBe(false);
    expect(ledger.size).toBe(1);
    expect(ledger.hasEntity("TASK", "task_1")).toBe(true);
    expect(ledger.hasEntity("DECISION", "task_1")).toBe(false);
  });

  it("ignores an empty id rather than recording a citation for it", () => {
    const ledger = new CopilotLedger();
    ledger.recordEntity("PRODUCT", "", "Nameless");
    ledger.recordEvidence("", "Nameless", null, null);
    expect(ledger.isEmpty).toBe(true);
  });
});
