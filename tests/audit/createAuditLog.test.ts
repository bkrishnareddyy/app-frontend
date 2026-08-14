import { describe, it, expect, vi, beforeEach } from "vitest";

// createAuditLog's beforeJson/afterJson params must actually be persisted and
// retrievable — the AuditLog table has no dedicated columns for them, so
// createAuditLog is responsible for folding them into `metadata`.

const dbMock = {
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { createAuditLog } = await import("@/lib/audit");

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.auditLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "audit_1",
    ...data,
  }));
});

describe("createAuditLog beforeJson/afterJson persistence", () => {
  it("persists beforeJson and afterJson snapshots so they're retrievable afterward", async () => {
    const created = await createAuditLog({
      accountId: "acc_1",
      userId: "user_1",
      action: "EXTRACTION_FIELD_CORRECTED",
      entity: "ExtractionField",
      entityId: "field_1",
      metadata: { fieldName: "htsCode" },
      beforeJson: { value: "8481.80", confidence: 62 },
      afterJson: { value: "8481.80.9020", source: "HUMAN" },
    });

    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(1);

    const persisted = created as { metadata: Record<string, unknown> };
    expect(persisted.metadata).toEqual({
      fieldName: "htsCode",
      beforeJson: { value: "8481.80", confidence: 62 },
      afterJson: { value: "8481.80.9020", source: "HUMAN" },
    });
  });

  it("omits beforeJson/afterJson keys entirely when not provided", async () => {
    const created = await createAuditLog({
      accountId: "acc_1",
      action: "DECISION_APPROVED",
      entity: "Decision",
      entityId: "dec_1",
      metadata: { note: "looks good" },
    });

    const persisted = created as { metadata: Record<string, unknown> };
    expect(persisted.metadata).toEqual({ note: "looks good" });
    expect(persisted.metadata).not.toHaveProperty("beforeJson");
    expect(persisted.metadata).not.toHaveProperty("afterJson");
  });

  it("still persists beforeJson/afterJson when no metadata is passed", async () => {
    const created = await createAuditLog({
      accountId: "acc_1",
      action: "DECISION_APPROVED",
      entity: "Decision",
      entityId: "dec_1",
      beforeJson: { status: "PENDING" },
      afterJson: { status: "APPROVED" },
    });

    const persisted = created as { metadata: Record<string, unknown> };
    expect(persisted.metadata).toEqual({
      beforeJson: { status: "PENDING" },
      afterJson: { status: "APPROVED" },
    });
  });
});
