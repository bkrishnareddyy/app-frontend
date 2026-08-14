import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionDataFieldEntry } from "@/lib/canonicalMessaging/actionDataRequirements";

/**
 * Covers the recursive resolution logic: scalar fields, a flat grid, a
 * GoodsItem -> Packages nested grid (arbitrary depth), row-local "shipment."
 * scoping inside a grid row, and required-field/required-row enforcement --
 * both for cancelFiling()/amendFiling()'s eventual real use and to prove the
 * "required lives on the field definition, never on a data row" rule holds
 * for every depth.
 */

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: { filingActionDataRequirement: { findMany: (...args: unknown[]) => findManyMock(...args) } } }));

const { resolveActionDataFields, buildActionExtensions, MissingActionFieldError } = await import(
  "@/lib/canonicalMessaging/actionDataRequirements"
);

const CONTEXT = { country: "DE", procedureCode: "T1", messageName: "CUSTOMS_DECLARATION_CANCELLATION" };

function row(fields: ActionDataFieldEntry[]) {
  return { id: "row_1", country: "DE", procedureCode: "T1", messageName: "*", action: "CANCELLATION", fields };
}

beforeEach(() => {
  findManyMock.mockReset();
});

describe("resolveActionDataFields", () => {
  it("resolves the most specific row and returns its field tree", async () => {
    findManyMock.mockResolvedValue([row([{ key: "note", label: "Note", type: "text", required: false, source: "prompt" }])]);
    const fields = await resolveActionDataFields(CONTEXT, "CANCELLATION");
    expect(fields).toEqual([{ key: "note", label: "Note", type: "text", required: false, source: "prompt" }]);
  });

  it("returns an empty list when nothing matches -- a safe default, not an error", async () => {
    findManyMock.mockResolvedValue([]);
    expect(await resolveActionDataFields(CONTEXT, "CANCELLATION")).toEqual([]);
  });
});

describe("buildActionExtensions -- scalar fields", () => {
  it("resolves a shipment-sourced field automatically, never asking the operator", async () => {
    findManyMock.mockResolvedValue([
      row([{ key: "guaranteeRef", label: "Guarantee Reference", type: "text", required: true, source: "shipment.filing.guaranteeRef" }]),
    ]);
    const extensions = await buildActionExtensions(CONTEXT, "CANCELLATION", { filing: { guaranteeRef: "GRN-123" } }, {});
    expect(extensions).toEqual({ guaranteeRef: "GRN-123" });
  });

  it("takes a prompt field from the operator's supplied values, not the shipment context", async () => {
    findManyMock.mockResolvedValue([row([{ key: "reason", label: "Reason", type: "text", required: true, source: "prompt" }])]);
    const extensions = await buildActionExtensions(CONTEXT, "CANCELLATION", {}, { reason: "Duplicate filing" });
    expect(extensions).toEqual({ reason: "Duplicate filing" });
  });

  it("throws MissingActionFieldError for a required field with no resolvable value", async () => {
    findManyMock.mockResolvedValue([row([{ key: "reason", label: "Reason", type: "text", required: true, source: "prompt" }])]);
    await expect(buildActionExtensions(CONTEXT, "CANCELLATION", {}, {})).rejects.toThrow(MissingActionFieldError);
  });

  it("silently omits an optional field that has no value -- never a blank placeholder", async () => {
    findManyMock.mockResolvedValue([row([{ key: "note", label: "Note", type: "text", required: false, source: "prompt" }])]);
    const extensions = await buildActionExtensions(CONTEXT, "CANCELLATION", {}, {});
    expect(extensions).toEqual({});
    expect("note" in extensions).toBe(false);
  });
});

describe("buildActionExtensions -- flat grid", () => {
  const gridField: ActionDataFieldEntry = {
    key: "containers",
    label: "Containers",
    type: "grid",
    required: true,
    source: "prompt",
    columns: [
      { key: "containerNumber", label: "Container #", type: "text", required: true, source: "prompt" },
      { key: "sealNumber", label: "Seal #", type: "text", required: false, source: "prompt" },
    ],
  };

  it("resolves each row's columns from the row's own prompted data", async () => {
    findManyMock.mockResolvedValue([row([gridField])]);
    const extensions = await buildActionExtensions(CONTEXT, "CANCELLATION", {}, {
      containers: [
        { containerNumber: "MSKU1234567", sealNumber: "SEAL-1" },
        { containerNumber: "MSKU7654321" },
      ],
    });
    expect(extensions.containers).toEqual([
      { containerNumber: "MSKU1234567", sealNumber: "SEAL-1" },
      { containerNumber: "MSKU7654321" },
    ]);
  });

  it("enforces 'required' as at-least-one-row for the grid as a whole, not per row", async () => {
    findManyMock.mockResolvedValue([row([gridField])]);
    await expect(buildActionExtensions(CONTEXT, "CANCELLATION", {}, { containers: [] })).rejects.toThrow(MissingActionFieldError);
  });

  it("still enforces a required column within each row independently", async () => {
    findManyMock.mockResolvedValue([row([gridField])]);
    await expect(
      buildActionExtensions(CONTEXT, "CANCELLATION", {}, { containers: [{ sealNumber: "SEAL-1" }] })
    ).rejects.toThrow(MissingActionFieldError);
  });
});

describe("buildActionExtensions -- nested tree (GoodsItem -> Packages)", () => {
  const goodsItemsField: ActionDataFieldEntry = {
    key: "goodsItems",
    label: "Goods Items",
    type: "grid",
    required: true,
    source: "shipment.lineItems",
    columns: [
      { key: "description", label: "Description", type: "text", required: true, source: "shipment.description" },
      {
        key: "packages",
        label: "Packages",
        type: "grid",
        required: true,
        source: "shipment.packages",
        columns: [
          { key: "packageType", label: "Package Type", type: "text", required: true, source: "shipment.packageType" },
          { key: "weightKg", label: "Weight (kg)", type: "number", required: false, source: "shipment.weightKg" },
        ],
      },
    ],
  };

  it("resolves an arbitrarily deep tree, each level scoped to its own row -- not the top-level shipment", async () => {
    findManyMock.mockResolvedValue([row([goodsItemsField])]);
    const shipmentContext = {
      lineItems: [
        {
          description: "Steel valves",
          packages: [
            { packageType: "Pallet", weightKg: 120 },
            { packageType: "Crate", weightKg: 80 },
          ],
        },
        { description: "Snowboard boots", packages: [{ packageType: "Box", weightKg: 15 }] },
      ],
    };

    const extensions = await buildActionExtensions(CONTEXT, "AMENDMENT", shipmentContext, {});

    expect(extensions.goodsItems).toEqual([
      {
        description: "Steel valves",
        packages: [
          { packageType: "Pallet", weightKg: 120 },
          { packageType: "Crate", weightKg: 80 },
        ],
      },
      { description: "Snowboard boots", packages: [{ packageType: "Box", weightKg: 15 }] },
    ]);
  });

  it("throws when a nested required column is missing on one specific row, not just at the top level", async () => {
    findManyMock.mockResolvedValue([row([goodsItemsField])]);
    const shipmentContext = {
      lineItems: [{ description: "Steel valves", packages: [{ weightKg: 120 }] }], // packageType missing
    };
    await expect(buildActionExtensions(CONTEXT, "AMENDMENT", shipmentContext, {})).rejects.toThrow(MissingActionFieldError);
  });

  it("requires at least one top-level row and, independently, at least one nested row per required nested grid", async () => {
    findManyMock.mockResolvedValue([row([goodsItemsField])]);
    // Top-level goodsItems has one row, but that row's required "packages" grid is empty.
    await expect(
      buildActionExtensions(CONTEXT, "AMENDMENT", { lineItems: [{ description: "Steel valves", packages: [] }] }, {})
    ).rejects.toThrow(MissingActionFieldError);
  });
});
