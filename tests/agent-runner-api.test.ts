import { describe, it, expect, vi, beforeEach } from "vitest";

// POST /api/agents/[agentId] used to fill any omitted field with a hardcoded
// demo shipment — a $48,500 invoice of stainless fasteners supplied by
// "Shenzhen Hardware Manufacturing Corp" classified 7318.15.2065 from MX.
// The agents write AgentDecision, ComplianceFinding and CustomsFiling rows
// against the caller's real tenant and their most recent real shipment, so an
// under-specified request fabricated compliance history on a live entry.

const ctxMock = vi.fn();
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/modules/shipments/resolveShipment", () => ({
  resolveTenantShipmentId: async () => "shp_real",
  shipmentResolutionStatus: () => 404,
  ShipmentResolutionError: class extends Error {},
}));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ requests: 1 }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

const agentModule = () => ({
  DocumentIntakeAgent: { execute },
  DocumentIntelligenceAgent: { execute },
  ProductIntelligenceAgent: { execute },
  HTSClassificationAgent: { execute },
  OriginRulesAgent: { execute },
  ValuationAssistsAgent: { execute },
  ComplianceAuditAgent: { execute },
  FilingReadinessAgent: { execute },
  CustomsFilingAgent: { execute },
  ResponseManagementAgent: { execute },
});

vi.mock("@/modules/intake/documentIntakeAgent", () => agentModule());
vi.mock("@/modules/agents/documentIntelligenceAgent", () => agentModule());
vi.mock("@/modules/agents/productIntelligenceAgent", () => agentModule());
vi.mock("@/modules/agents/htsClassificationAgent", () => agentModule());
vi.mock("@/modules/agents/originRulesAgent", () => agentModule());
vi.mock("@/modules/agents/valuationAssistsAgent", () => agentModule());
vi.mock("@/modules/agents/complianceAuditAgent", () => agentModule());
vi.mock("@/modules/agents/filingReadinessAgent", () => agentModule());
vi.mock("@/modules/demo/customsFilingAgent", () => agentModule());
vi.mock("@/modules/demo/responseManagementAgent", () => agentModule());

const route = await import("@/app/api/agents/[agentId]/route");

function post(agentId: string, body: unknown) {
  return route.POST(
    new Request(`http://localhost/api/agents/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ agentId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
    ctxMock.mockResolvedValue({
      userId: "u_1",
      accountId: "acc_1",
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
  execute.mockResolvedValue({ status: "Completed" });
});

describe("POST /api/agents/[agentId] input requirements", () => {
  const underSpecified: Array<[string, string, Record<string, unknown>]> = [
    ["1", "fileName", {}],
    ["3", "lineItems", {}],
    ["4", "productProfiles", {}],
    ["5", "lineItems", {}],
    ["6", "invoiceSubtotal", {}],
    ["7", "lineItems", {}],
    ["8", "enteredValue", {}],
    ["9", "enteredValue", {}],
    ["10", "entryNumber", {}],
  ];

  for (const [agentId, field, body] of underSpecified) {
    it(`agent ${agentId} refuses to run without ${field} instead of substituting demo data`, async () => {
      const res = await post(agentId, body);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("MISSING_AGENT_INPUT");
      expect(json.missingFields).toContain(field);
      expect(execute).not.toHaveBeenCalled();
    });
  }

  it("runs the agent once the caller supplies the real values", async () => {
    const res = await post("7", {
      lineItems: [{ lineNumber: 1, htsCode: "8481.80.1050", countryOfOrigin: "DE" }],
      supplierName: "Acme Valve GmbH",
    });

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: "shp_real",
        lineItems: [{ lineNumber: 1, htsCode: "8481.80.1050", countryOfOrigin: "DE" }],
        supplierName: "Acme Valve GmbH",
      })
    );
  });

  it("passes a real zero duty through rather than treating it as missing", async () => {
    const res = await post("9", { enteredValue: 46800, dutyDue: 0 });

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ dutyDue: 0 }));
  });

  it("reports an omitted duty as null, not as $0.00", async () => {
    const res = await post("9", { enteredValue: 46800 });

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ dutyDue: null }));
  });
});
