import { describe, it, expect, beforeEach } from "vitest";

// =============================================================================
// EXCEPTIONS LIFECYCLE & RESOLUTION WORKSPACE TEST SUITE
// =============================================================================

interface ExceptionItemPayload {
  id: string;
  accountId: string;
  shipmentId: string;
  type: string;
  severity: string;
  description: string;
  status: "Open" | "Resolved";
  version: number;
}

interface LineItemPayload {
  id: string;
  description: string;
  htsCode: string;
  countryOfOrigin: string;
  quantity: number;
}

class ExceptionResolutionMockService {
  exceptions: ExceptionItemPayload[] = [];
  lineItems: LineItemPayload[] = [];
  accountId = "acc_target_enterprise";
  shipmentId = "shp_controller_01";

  constructor() {
    this.reset();
  }

  reset() {
    this.exceptions = [];
    this.lineItems = [
      {
        id: "line_2",
        description: "Electronic Controller",
        htsCode: "8481.80.5090",
        countryOfOrigin: "",
        quantity: 20,
      }
    ];
  }

  // Seed default exceptions
  seedDefaultExceptions() {
    this.exceptions = [
      {
        id: "ex_hts",
        accountId: this.accountId,
        shipmentId: this.shipmentId,
        type: "compliance_flag",
        severity: "High",
        description: "HTS Classification Review: Line 2: Electronic Controller low confidence (76%)",
        status: "Open",
        version: 1,
      },
      {
        id: "ex_cert",
        accountId: this.accountId,
        shipmentId: this.shipmentId,
        type: "missing_document",
        severity: "Medium",
        description: "Certificate of Origin Missing: Required for US entry & preferential duty rules",
        status: "Open",
        version: 1,
      },
      {
        id: "ex_coo",
        accountId: this.accountId,
        shipmentId: this.shipmentId,
        type: "missing_document",
        severity: "Medium",
        description: "Country of Origin Missing: Line 2: Electronic Controller origin required",
        status: "Open",
        version: 1,
      },
      {
        id: "ex_qty",
        accountId: this.accountId,
        shipmentId: this.shipmentId,
        type: "data_mismatch",
        severity: "High",
        description: "Quantity Mismatch: Invoice: 20 PCS vs Packing List: 18 PCS",
        status: "Open",
        version: 1,
      },
      {
        id: "ex_poa",
        accountId: this.accountId,
        shipmentId: this.shipmentId,
        type: "compliance_flag",
        severity: "Critical",
        description: "Importer POA Expired: Power of Attorney on file expired on May 1, 2026",
        status: "Open",
        version: 1,
      },
    ];
  }

  // Map to UI exceptions
  mapToUi() {
    const openExceptions = this.exceptions.filter((ex) => ex.status !== "Resolved");
    return openExceptions.map((dbEx) => {
      const descLower = dbEx.description.toLowerCase();
      const isHts = descLower.includes("hts");
      const isCo = descLower.includes("certificate of origin");
      const isCoo = descLower.includes("country of origin");
      const isQty = descLower.includes("quantity") || descLower.includes("pcs") || descLower.includes("mismatch");
      const isPoa = descLower.includes("poa") || descLower.includes("power of attorney");

      let category = "VALIDATION";
      let title = dbEx.description.split(":")[0]?.trim() || "Compliance Exception";
      let desc = dbEx.description.split(":").slice(1).join(":")?.trim() || dbEx.description;
      let actionType = "DEFAULT";

      if (isHts) {
        category = "VALIDATION";
        title = "HTS Classification Review";
        actionType = "HTS";
      } else if (isCo) {
        category = "MISSING";
        title = "Certificate of Origin Missing";
        actionType = "UPLOAD";
      } else if (isCoo) {
        category = "MISSING";
        title = "Country of Origin Missing";
        actionType = "COO";
      } else if (isQty) {
        category = "CONFLICTS";
        title = "Quantity Mismatch";
        actionType = "MISMATCH";
      } else if (isPoa) {
        category = "CONFLICTS";
        title = "Importer POA Expired";
        actionType = "POA";
      }

      return {
        id: dbEx.id,
        dbId: dbEx.id,
        version: dbEx.version,
        category,
        title,
        desc,
        actionType,
      };
    });
  }

  // Update exception (mock PATCH handler)
  patchException(id: string, expectedVersion: number, status: "Open" | "Resolved") {
    const ex = this.exceptions.find((e) => e.id === id);
    if (!ex) return { status: 404, error: "NOT_FOUND" };
    if (ex.version !== expectedVersion) return { status: 409, error: "STALE_VERSION" };

    ex.status = status;
    ex.version += 1;
    return { status: 200, exception: ex };
  }

  // Update line item details (mock shipment line item updates)
  patchLineItem(id: string, updates: Partial<LineItemPayload>) {
    const item = this.lineItems.find((li) => li.id === id);
    if (!item) return { status: 404, error: "NOT_FOUND" };
    
    if (updates.htsCode !== undefined) item.htsCode = updates.htsCode;
    if (updates.countryOfOrigin !== undefined) item.countryOfOrigin = updates.countryOfOrigin;
    if (updates.quantity !== undefined) item.quantity = updates.quantity;

    return { status: 200, lineItem: item };
  }
}

describe("Qubere Exceptions Resolution Hub Test Suite", () => {
  let service: ExceptionResolutionMockService;

  beforeEach(() => {
    service = new ExceptionResolutionMockService();
    service.seedDefaultExceptions();
  });

  it("1. Should seed exactly 5 default open exceptions if none exist initially", () => {
    const fresh = new ExceptionResolutionMockService();
    expect(fresh.exceptions).toHaveLength(0);

    fresh.seedDefaultExceptions();
    expect(fresh.exceptions).toHaveLength(5);
    expect(fresh.exceptions.every((e) => e.status === "Open")).toBe(true);
  });

  it("2. Should correctly map database exceptions to their UI categories and action forms", () => {
    const uiList = service.mapToUi();
    expect(uiList).toHaveLength(5);

    const htsEx = uiList.find((u) => u.actionType === "HTS");
    expect(htsEx?.category).toBe("VALIDATION");
    expect(htsEx?.title).toBe("HTS Classification Review");

    const qtyEx = uiList.find((u) => u.actionType === "MISMATCH");
    expect(qtyEx?.category).toBe("CONFLICTS");
    expect(qtyEx?.title).toBe("Quantity Mismatch");

    const cooEx = uiList.find((u) => u.actionType === "COO");
    expect(cooEx?.category).toBe("MISSING");
  });

  it("3. Should successfully resolve an exception, increments version and filters from UI list", () => {
    const exToResolve = service.exceptions[0];
    expect(exToResolve.status).toBe("Open");

    const res = service.patchException(exToResolve.id, exToResolve.version, "Resolved");
    expect(res.status).toBe(200);
    expect(res.exception?.status).toBe("Resolved");
    expect(res.exception?.version).toBe(2);

    const uiList = service.mapToUi();
    expect(uiList).toHaveLength(4); // Decreased by 1
    expect(uiList.find((u) => u.id === exToResolve.id)).toBeUndefined();
  });

  it("4. Should reject stale updates when version tags mismatch (concurrency control)", () => {
    const ex = service.exceptions[0];
    const staleRes = service.patchException(ex.id, ex.version - 1, "Resolved");
    expect(staleRes.status).toBe(409);
    expect(staleRes.error).toBe("STALE_VERSION");
  });

  it("5. Should update quantity value of a line item during mismatch resolution", () => {
    const res = service.patchLineItem("line_2", { quantity: 18 });
    expect(res.status).toBe(200);
    expect(res.lineItem?.quantity).toBe(18);
  });

  it("6. Should update HTS code and Country of Origin of a line item during broker overrides", () => {
    const res = service.patchLineItem("line_2", { htsCode: "8504.40.9570", countryOfOrigin: "Germany" });
    expect(res.status).toBe(200);
    expect(res.lineItem?.htsCode).toBe("8504.40.9570");
    expect(res.lineItem?.countryOfOrigin).toBe("Germany");
  });
});
