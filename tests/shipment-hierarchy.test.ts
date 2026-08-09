import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../src/lib/db";

describe("Master / House Shipment Hierarchy Integration Suite", () => {
  let accountId: string;
  let masterId: string;
  let houseId: string;

  beforeEach(async () => {
    // 1. Create a unique account context
    const suffix = Math.floor(Math.random() * 1000000).toString();
    const account = await db.account.create({
      data: {
        name: `Hierarchy Test Account ${suffix}`,
        slug: `hierarchy-test-slug-${suffix}`,
      },
    });
    accountId = account.id;

    // 2. Seed a parent Master Shipment
    const master = await db.shipment.create({
      data: {
        account: { connect: { id: accountId } },
        shipmentNumber: `MBL-TEST-${suffix}`,
        importerName: "Apex Global Logistics",
        entryType: "01",
        portOfEntry: "Port of Seattle",
        carrierName: "CMA CGM",
        incoterm: "FOB",
      },
    });
    masterId = master.id;
  });

  afterEach(async () => {
    // Clean up
    if (accountId) {
      await db.account.delete({ where: { id: accountId } });
    }
  });

  it("should create a House shipment linked to a Master shipment successfully", async () => {
    const suffix = Math.floor(Math.random() * 1000000).toString();
    
    // 1. Create a House child shipment connected to our Master parent
    const house = await db.shipment.create({
      data: {
        account: { connect: { id: accountId } },
        masterShipment: { connect: { id: masterId } },
        shipmentNumber: `HBL-TEST-${suffix}`,
        importerName: "Apex Child Co",
        entryType: "01",
        portOfEntry: "Port of Seattle",
        carrierName: "CMA CGM",
        incoterm: "FOB",
      },
    });
    houseId = house.id;

    expect(house.masterShipmentId).toBe(masterId);

    // 2. Fetch the Master shipment including its child house shipments
    const fetchedMaster = await db.shipment.findUnique({
      where: { id: masterId },
      include: { houseShipments: true },
    });

    expect(fetchedMaster).not.toBeNull();
    expect(fetchedMaster!.houseShipments.length).toBe(1);
    expect(fetchedMaster!.houseShipments[0].id).toBe(houseId);
    expect(fetchedMaster!.houseShipments[0].importerName).toBe("Apex Child Co");
  }, 30000);
});
