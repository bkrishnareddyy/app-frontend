import { describe, it, expect } from "vitest";
import {
  UNASSIGNED_INTAKE_SEVERITY,
  UNASSIGNED_INTAKE_TYPE,
  recordUnassignedIntake,
  unassignedIntakeDescription,
  type UnassignedIntakeStore,
} from "@/modules/intake/unassignedIntake";

function store(): UnassignedIntakeStore & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async create(input) {
      calls.push(input);
      return { id: "exc_1" };
    },
  };
}

describe("unassigned intake description", () => {
  it("names the file and says what has to happen next", () => {
    expect(
      unassignedIntakeDescription({ source: "document_upload", fileName: "INV-4471.pdf" })
    ).toBe(
      "INV-4471.pdf was uploaded through the document upload form without naming a shipment. " +
        "Assign it to a shipment, or close this item if it should not be filed."
    );
  });

  it("includes a stated document type but not the auto-detect placeholder", () => {
    expect(
      unassignedIntakeDescription({
        source: "intake_agent",
        fileName: "doc.pdf",
        docType: "Commercial Invoice",
      })
    ).toContain("doc.pdf (Commercial Invoice)");

    expect(
      unassignedIntakeDescription({
        source: "intake_agent",
        fileName: "doc.pdf",
        docType: "AUTO_DETECT",
      })
    ).not.toContain("AUTO_DETECT");
  });

  it("does not invent a file name when none was supplied", () => {
    const text = unassignedIntakeDescription({ source: "agent_run", fileName: "   " });
    expect(text).toContain("An intake item");
    expect(text).not.toContain("undefined");
  });

  it("names the route the item arrived on, since the fix differs per source", () => {
    expect(unassignedIntakeDescription({ source: "document_upload" })).toContain(
      "document upload form"
    );
    expect(unassignedIntakeDescription({ source: "intake_agent" })).toContain("intake agent");
    expect(unassignedIntakeDescription({ source: "agent_run" })).toContain("agent run");
  });
});

describe("recordUnassignedIntake", () => {
  it("opens a high severity exception with no shipment attached", async () => {
    const s = store();

    const result = await recordUnassignedIntake(
      "acct_1",
      { source: "document_upload", fileName: "PL.pdf" },
      s
    );

    expect(result.id).toBe("exc_1");
    expect(s.calls[0]).toEqual({
      accountId: "acct_1",
      type: UNASSIGNED_INTAKE_TYPE,
      severity: UNASSIGNED_INTAKE_SEVERITY,
      description: result.description,
      status: "Open",
    });
  });

  it("does not attach a shipment id, because that is the fact being reported", async () => {
    const s = store();

    await recordUnassignedIntake("acct_1", { source: "intake_agent" }, s);

    expect(s.calls[0]).not.toHaveProperty("shipmentId");
  });

  it("scopes the exception to the account that sent the intake", async () => {
    const s = store();

    await recordUnassignedIntake("acct_other", { source: "agent_run" }, s);

    expect((s.calls[0] as { accountId: string }).accountId).toBe("acct_other");
  });
});
