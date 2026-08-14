import { describe, it, expect } from "vitest";
import { availableAssistantTools, getToolByName, ASSISTANT_TOOLS } from "@/modules/assistant/tools";
import type { AccountContext } from "@/lib/auth";

describe("Assistant Tool Registry & Permission Unit Tests", () => {
  const fullCtx = {
    accountId: "acc-123",
    userId: "usr-123",
    roleIds: ["ADMIN"],
    roleNames: ["ADMIN"],
    permissions: [
      "shipments.read",
      "shipments.write",
      "products.read",
      "products.classification.approve",
      "decisions.approve",
      "decisions.reject",
      "exceptions.resolve",
      "documents.read",
      "regulatory.review",
      "analytics.read",
      "filing.validate",
    ],
  } as unknown as AccountContext;

  const restrictedCtx = {
    accountId: "acc-123",
    userId: "usr-restricted",
    roleIds: ["VIEWER"],
    roleNames: ["VIEWER"],
    permissions: ["shipments.read"],
  } as unknown as AccountContext;

  it("exports all 27 assistant tools with valid Zod schemas and declarations", () => {
    expect(ASSISTANT_TOOLS.length).toBeGreaterThanOrEqual(27);
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.declaration.name).toBeDefined();
      expect(tool.declaration.description).toBeDefined();
      expect(tool.schema).toBeDefined();
    }
  });

  it("correctly gates tools by RBAC permissions", () => {
    const fullTools = availableAssistantTools(fullCtx).map((t) => t.declaration.name);
    const restrictedTools = availableAssistantTools(restrictedCtx).map((t) => t.declaration.name);

    expect(fullTools).toContain("reject_decision");
    expect(fullTools).toContain("generate_reasonable_care_record");
    expect(fullTools).toContain("run_impact_analysis");
    expect(fullTools).toContain("get_classification_rationale");
    expect(fullTools).toContain("get_duty_exposure_risks");
    expect(fullTools).toContain("validate_shipment_filing");

    expect(restrictedTools).not.toContain("reject_decision");
    expect(restrictedTools).not.toContain("generate_reasonable_care_record");
    expect(restrictedTools).not.toContain("run_impact_analysis");
  });

  it("matches reject_decision tool access permission with decisions.reject", () => {
    const rejectTool = getToolByName("reject_decision");
    expect(rejectTool).toBeDefined();
    expect(rejectTool?.access?.permission).toBe("decisions.reject");
  });

  it("matches generate_reasonable_care_record tool access permission with documents.read", () => {
    const recTool = getToolByName("generate_reasonable_care_record");
    expect(recTool).toBeDefined();
    expect(recTool?.access?.permission).toBe("documents.read");
  });

  it("validates Zod input arguments on tool execution", async () => {
    const tool = getToolByName("approve_decision");
    expect(tool).toBeDefined();

    const res = await tool!.execute(fullCtx, {});
    expect(res).toHaveProperty("error");
    expect(String((res as any).error)).toBeDefined();
  });
});
