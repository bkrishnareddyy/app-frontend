import { describe, it, expect } from "vitest";
import {
  extractIdentifierCandidates,
  matchShipmentForDocument,
  type ShipmentIdentifierLookup,
  type CandidateRecord,
} from "@/modules/shipments/shipmentMatching";

describe("extractIdentifierCandidates", () => {
  it("finds a literal shipment number in the exact generated format", () => {
    const { shipmentNumbers } = extractIdentifierCandidates("Re: docs for SHP-2026-000042 attached");
    expect(shipmentNumbers).toEqual(["SHP-2026-000042"]);
  });

  it("does not match a malformed shipment-number-like token", () => {
    const { shipmentNumbers } = extractIdentifierCandidates("SHP-26-42 or SHP-2026-42 are not real ids");
    expect(shipmentNumbers).toEqual([]);
  });

  it("dedupes repeated shipment numbers", () => {
    const { shipmentNumbers } = extractIdentifierCandidates("SHP-2026-000042 ... again SHP-2026-000042");
    expect(shipmentNumbers).toEqual(["SHP-2026-000042"]);
  });

  it("finds PO references in common formats and normalizes punctuation away", () => {
    const { poReferences } = extractIdentifierCandidates("Invoice for PO-778899 and P.O. 445566");
    expect(poReferences).toContain("PO778899");
    expect(poReferences).toContain("PO445566");
  });

  it("finds no identifiers in unrelated text", () => {
    const result = extractIdentifierCandidates("Hey, here's the forwarding instructions doc.");
    expect(result).toEqual({ shipmentNumbers: [], poReferences: [] });
  });
});

function makeLookup(overrides?: Partial<ShipmentIdentifierLookup>): {
  lookup: ShipmentIdentifierLookup;
  recorded: CandidateRecord[];
} {
  const recorded: CandidateRecord[] = [];
  const lookup: ShipmentIdentifierLookup = {
    async findByShipmentNumber() {
      return null;
    },
    async findByPoReference() {
      return [];
    },
    async recordCandidate(record) {
      recorded.push(record);
    },
    ...overrides,
  };
  return { lookup, recorded };
}

describe("matchShipmentForDocument", () => {
  it("auto-selects a single unambiguous shipment-number match", async () => {
    const { lookup, recorded } = makeLookup({
      async findByShipmentNumber(accountId, shipmentNumber) {
        return shipmentNumber === "SHP-2026-000042" ? { id: "shp_1" } : null;
      },
    });

    const result = await matchShipmentForDocument(
      { accountId: "acct_a", documentId: "doc_1", emailSubject: "Docs for SHP-2026-000042", parsedText: null },
      lookup
    );

    expect(result.matchedShipmentId).toBe("shp_1");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      shipmentId: "shp_1",
      matchedIdentifierType: "SHIPMENT_NUMBER",
      matchedSource: "EMAIL_SUBJECT",
      autoSelected: true,
    });
  });

  it("returns null and records nothing when no identifiers are found", async () => {
    const { lookup, recorded } = makeLookup();
    const result = await matchShipmentForDocument(
      { accountId: "acct_a", documentId: "doc_1", emailSubject: "no identifiers here", parsedText: "still none" },
      lookup
    );
    expect(result.matchedShipmentId).toBeNull();
    expect(recorded).toHaveLength(0);
  });

  it("persists conflicting candidates but auto-selects neither -- never a silent guess", async () => {
    const { lookup, recorded } = makeLookup({
      async findByShipmentNumber(_accountId, shipmentNumber) {
        if (shipmentNumber === "SHP-2026-000042") return { id: "shp_1" };
        if (shipmentNumber === "SHP-2026-000099") return { id: "shp_2" };
        return null;
      },
    });

    const result = await matchShipmentForDocument(
      {
        accountId: "acct_a",
        documentId: "doc_1",
        emailSubject: "SHP-2026-000042",
        parsedText: "Reference: SHP-2026-000099",
      },
      lookup
    );

    expect(result.matchedShipmentId).toBeNull();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((r) => r.autoSelected === false)).toBe(true);
    expect(new Set(recorded.map((r) => r.shipmentId))).toEqual(new Set(["shp_1", "shp_2"]));
  });

  it("only tries PO-reference matching when no shipment-number candidate resolved", async () => {
    let poLookupCalled = false;
    const { lookup } = makeLookup({
      async findByShipmentNumber(_accountId, shipmentNumber) {
        return shipmentNumber === "SHP-2026-000042" ? { id: "shp_1" } : null;
      },
      async findByPoReference() {
        poLookupCalled = true;
        return [];
      },
    });

    await matchShipmentForDocument(
      { accountId: "acct_a", documentId: "doc_1", emailSubject: "SHP-2026-000042 re PO-778899", parsedText: null },
      lookup
    );

    expect(poLookupCalled).toBe(false);
  });

  it("falls back to PO-reference matching and auto-selects a single match", async () => {
    const { lookup, recorded } = makeLookup({
      async findByPoReference(_accountId, normalized) {
        return normalized === "PO778899" ? [{ id: "shp_9" }] : [];
      },
    });

    const result = await matchShipmentForDocument(
      { accountId: "acct_a", documentId: "doc_1", emailSubject: null, parsedText: "Please see PO-778899 attached." },
      lookup
    );

    expect(result.matchedShipmentId).toBe("shp_9");
    expect(recorded[0]).toMatchObject({ matchedIdentifierType: "PO_REFERENCE", matchedSource: "PARSED_DOCUMENT_TEXT" });
  });

  it("a PO reference matching two shipments is a conflict, not a guess", async () => {
    const { lookup, recorded } = makeLookup({
      async findByPoReference() {
        return [{ id: "shp_a" }, { id: "shp_b" }];
      },
    });

    const result = await matchShipmentForDocument(
      { accountId: "acct_a", documentId: "doc_1", emailSubject: null, parsedText: "PO-778899" },
      lookup
    );

    expect(result.matchedShipmentId).toBeNull();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((r) => r.autoSelected === false)).toBe(true);
  });
});
