import { describe, it, expect, vi } from "vitest";

// buildAgentContext() must populate ShipmentAgentContext.parties for Country
// Embargo Screening: ShipmentParty -> LegalEntity (+ Party/PartyAddress where
// LegalEntity.partyId backfills to the Global Party Master), SHIP_TO
// identification, party country, and an explicitly-undefined militaryEndUse
// (no such field exists in the schema).

const dbMock = {
  shipment: { findFirst: vi.fn() },
  shipmentLineItem: { findMany: vi.fn() },
  shipmentDocument: { findMany: vi.fn() },
  shipmentParty: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/shipment/factService", () => ({
  FactService: { latestByField: vi.fn().mockResolvedValue(new Map()) },
}));

const { buildAgentContext } = await import("@/modules/agents/agentContext");

function baseMocks() {
  dbMock.shipment.findFirst.mockResolvedValue({ accountId: "acct_1", countryOfExport: "US" });
  dbMock.shipmentLineItem.findMany.mockResolvedValue([]);
  dbMock.shipmentDocument.findMany.mockResolvedValue([]);
}

describe("buildAgentContext parties", () => {
  it("maps ShipmentParty/LegalEntity rows to EmbargoParty with country and undefined militaryEndUse", async () => {
    baseMocks();
    dbMock.shipmentParty.findMany.mockResolvedValue([
      {
        role: "EXPORTER",
        legalEntity: { id: "le_1", country: "US", legalName: "Acme Exports", party: null },
      },
    ]);

    const context = await buildAgentContext("ship_1", "acct_1");

    expect(context.parties).toEqual([
      {
        partyId: "le_1",
        partyType: "EXPORTER",
        country: "US",
        userDefined: "Acme Exports",
        militaryEndUse: undefined,
        isShipTo: false,
      },
    ]);
  });

  it("identifies DELIVERY_TO as the SHIP_TO party", async () => {
    baseMocks();
    dbMock.shipmentParty.findMany.mockResolvedValue([
      { role: "DELIVERY_TO", legalEntity: { id: "le_2", country: "IR", legalName: "Delivery Co", party: null } },
      { role: "EXPORTER", legalEntity: { id: "le_1", country: "US", legalName: "Acme Exports", party: null } },
    ]);

    const context = await buildAgentContext("ship_1", "acct_1");

    const shipTo = context.parties.find((p) => p.isShipTo);
    expect(shipTo?.partyId).toBe("le_2");
    expect(shipTo?.country).toBe("IR");
    expect(context.parties.filter((p) => p.isShipTo)).toHaveLength(1);
  });

  it("falls back to the primary PartyAddress country when LegalEntity has no direct country match available via Party", async () => {
    baseMocks();
    dbMock.shipmentParty.findMany.mockResolvedValue([
      {
        role: "CONSIGNEE",
        legalEntity: {
          id: "le_3",
          country: null,
          legalName: "Consignee Co",
          party: {
            addresses: [
              { country: "MX", isPrimary: false },
              { country: "CU", isPrimary: true },
            ],
          },
        },
      },
    ]);

    const context = await buildAgentContext("ship_1", "acct_1");

    expect(context.parties[0].country).toBe("CU");
    expect(context.parties[0].isShipTo).toBe(true);
  });
});
