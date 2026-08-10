import { describe, it, expect } from "vitest";
import {
  DECISION_ACTIONABLE_STATUSES,
  DOCUMENT_ACTIONABLE_STATUSES,
  EXCEPTION_ACTIONABLE_STATUSES,
  FILING_ACTIONABLE_STATUSES,
  FINDING_ACTIONABLE_STATUSES,
  WORK_KINDS,
  WORK_PAGE_SIZE,
  buildWorkQueue,
  countByKind,
  countByPriority,
  filterWorkQueue,
  paginateWorkQueue,
  parseWorkFilter,
  truncatedSources,
  type WorkQueueInput,
} from "@/modules/work/workQueue";

const ME = "user_me";
const OTHER = "user_other";

function at(iso: string): Date {
  return new Date(iso);
}

function input(overrides: Partial<WorkQueueInput> = {}): WorkQueueInput {
  return {
    userId: ME,
    decisions: [],
    findings: [],
    filings: [],
    documents: [],
    ...overrides,
  };
}

describe("exceptions in the work queue", () => {
  const base = {
    id: "e1",
    type: "unassigned_intake",
    description: "INV-1.pdf was uploaded without naming a shipment.",
    severity: "High",
    status: "Open",
    createdAt: at("2026-01-01"),
    shipmentId: null,
    shipmentNumber: null,
    assignedToUserId: null,
  };

  it("surfaces an exception that has no shipment, which nothing else in the app shows", () => {
    const queue = buildWorkQueue(input({ exceptions: [base] }));

    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("exception");
    expect(queue[0].title).toBe("unassigned intake");
    expect(queue[0].reason).toBe(base.description);
    expect(queue[0].href).toBe("/app/exceptions?exceptionId=e1");
    expect(queue[0].shipmentNumber).toBeNull();
  });

  it("reads the status whatever casing the row was written in", () => {
    const queue = buildWorkQueue(
      input({
        exceptions: [
          { ...base, id: "e1", status: "Open" },
          { ...base, id: "e2", status: "IN_PROGRESS" },
          { ...base, id: "e3", status: "InProgress" },
        ],
      })
    );

    expect(queue).toHaveLength(3);
  });

  it("drops closed exceptions and statuses it does not recognise", () => {
    const queue = buildWorkQueue(
      input({
        exceptions: [
          { ...base, id: "e1", status: "RESOLVED" },
          { ...base, id: "e2", status: "WAIVED" },
          { ...base, id: "e3", status: "CANCELLED" },
          { ...base, id: "e4", status: "almost done" },
        ],
      })
    );

    expect(queue).toHaveLength(0);
  });

  it("maps severity to priority and raises it when the item is mine", () => {
    const queue = buildWorkQueue(
      input({
        exceptions: [
          { ...base, id: "e1", severity: "Critical" },
          { ...base, id: "e2", severity: "Medium" },
          { ...base, id: "e3", severity: "Medium", assignedToUserId: ME },
        ],
      })
    );

    const byId = Object.fromEntries(queue.map((i) => [i.id, i]));
    expect(byId["exception:e1"].priority).toBe("critical");
    expect(byId["exception:e2"].priority).toBe("normal");
    expect(byId["exception:e3"].priority).toBe("high");
    expect(byId["exception:e3"].assignedToMe).toBe(true);
  });

  it("does not claim an unrecognised severity is low risk by silently ranking it", () => {
    const queue = buildWorkQueue(input({ exceptions: [{ ...base, severity: "Blocker" }] }));

    expect(queue[0].priority).toBe("normal");
  });

  it("counts as its own kind, so the filter pills add up", () => {
    const queue = buildWorkQueue(input({ exceptions: [base] }));

    expect(countByKind(queue).exception).toBe(1);
    expect(WORK_KINDS).toContain("exception");
  });

  it("filters on the exception statuses the queue will actually accept", () => {
    for (const status of EXCEPTION_ACTIONABLE_STATUSES) {
      expect(buildWorkQueue(input({ exceptions: [{ ...base, status }] }))).toHaveLength(1);
    }
    expect(EXCEPTION_ACTIONABLE_STATUSES).not.toContain("RESOLVED");
  });
});

describe("work queue selection", () => {
  it("includes only decisions whose status awaits a person", () => {
    const queue = buildWorkQueue(
      input({
        decisions: [
          { id: "d1", agentName: "Classification Agent", decisionSummary: "2 line items need review", status: "Review Required", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: "SHP-2026-000001" },
          { id: "d2", agentName: "Origin Agent", decisionSummary: "done", status: "Completed", createdAt: at("2026-01-02"), shipmentId: "s1", shipmentNumber: "SHP-2026-000001" },
          { id: "d3", agentName: "Valuation Agent", decisionSummary: "approved", status: "Approved", createdAt: at("2026-01-03"), shipmentId: "s1", shipmentNumber: "SHP-2026-000001" },
        ],
      })
    );
    expect(queue.map((i) => i.id)).toEqual(["decision:d1"]);
  });

  it("ignores records with an unrecognised status rather than guessing", () => {
    const queue = buildWorkQueue(
      input({
        filings: [
          { id: "f1", entryNumber: "5901-26-004872", filingStatus: "SomethingNew", createdAt: at("2026-01-01"), shipmentNumber: null },
        ],
      })
    );
    expect(queue).toHaveLength(0);
  });

  it("excludes resolved findings and closed filings", () => {
    const queue = buildWorkQueue(
      input({
        findings: [
          { id: "x1", rule: "Valuation Variance", severity: "High", status: "Resolved", createdAt: at("2026-01-01"), filingId: "f1", assignedToUserId: null },
        ],
        filings: [
          { id: "f2", entryNumber: "E2", filingStatus: "Closed", createdAt: at("2026-01-01"), shipmentNumber: null },
        ],
      })
    );
    expect(queue).toHaveLength(0);
  });

  it("carries the real reason text rather than an invented summary", () => {
    const queue = buildWorkQueue(
      input({
        decisions: [
          { id: "d1", agentName: "Classification Agent", decisionSummary: "2 line items need review", status: "Review Required", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: "SHP-2026-000001" },
        ],
      })
    );
    expect(queue[0].reason).toBe("2 line items need review");
    expect(queue[0].shipmentNumber).toBe("SHP-2026-000001");
  });
});

describe("work queue ordering", () => {
  it("puts items assigned to me above everything else", () => {
    const queue = buildWorkQueue(
      input({
        filings: [
          { id: "f1", entryNumber: "E1", filingStatus: "CustomsHold", createdAt: at("2026-01-01"), shipmentNumber: null },
        ],
        findings: [
          { id: "x1", rule: "Missing Assists", severity: "Info", status: "Open", createdAt: at("2026-06-01"), filingId: "f1", assignedToUserId: ME },
        ],
      })
    );
    expect(queue[0].id).toBe("finding:x1");
    expect(queue[0].assignedToMe).toBe(true);
  });

  it("orders by priority then oldest first", () => {
    const queue = buildWorkQueue(
      input({
        filings: [
          { id: "a", entryNumber: "A", filingStatus: "Draft", createdAt: at("2026-01-01"), shipmentNumber: null },
          { id: "b", entryNumber: "B", filingStatus: "Rejected", createdAt: at("2026-05-01"), shipmentNumber: null },
          { id: "c", entryNumber: "C", filingStatus: "ValidationFailed", createdAt: at("2026-02-01"), shipmentNumber: null },
          { id: "d", entryNumber: "D", filingStatus: "DocumentsRequested", createdAt: at("2026-03-01"), shipmentNumber: null },
        ],
      })
    );
    expect(queue.map((i) => i.id)).toEqual(["filing:c", "filing:b", "filing:d", "filing:a"]);
  });

  it("raises the priority of a finding assigned to me", () => {
    const assigned = buildWorkQueue(
      input({ findings: [{ id: "x", rule: "R", severity: "Warning", status: "Open", createdAt: at("2026-01-01"), filingId: "f", assignedToUserId: ME }] })
    );
    const unassigned = buildWorkQueue(
      input({ findings: [{ id: "x", rule: "R", severity: "Warning", status: "Open", createdAt: at("2026-01-01"), filingId: "f", assignedToUserId: OTHER }] })
    );
    expect(assigned[0].priority).toBe("high");
    expect(unassigned[0].priority).toBe("normal");
  });

  it("maps finding severity onto priority", () => {
    const queue = buildWorkQueue(
      input({
        findings: [
          { id: "c", rule: "R", severity: "Critical", status: "Open", createdAt: at("2026-01-01"), filingId: "f", assignedToUserId: null },
          { id: "h", rule: "R", severity: "High", status: "Open", createdAt: at("2026-01-01"), filingId: "f", assignedToUserId: null },
          { id: "i", rule: "R", severity: "Info", status: "Open", createdAt: at("2026-01-01"), filingId: "f", assignedToUserId: null },
        ],
      })
    );
    expect(queue.map((i) => i.priority)).toEqual(["critical", "high", "normal"]);
  });
});

describe("work queue counts", () => {
  it("reports zero as zero for an empty queue", () => {
    expect(countByPriority([])).toEqual({ critical: 0, high: 0, normal: 0 });
  });

  it("counts each priority bucket", () => {
    const queue = buildWorkQueue(
      input({
        documents: [
          { id: "doc1", fileName: "INV.pdf", status: "Review Required", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: "SHP-1" },
          { id: "doc2", fileName: "PL.pdf", status: "Missing", createdAt: at("2026-01-02"), shipmentId: "s1", shipmentNumber: "SHP-1" },
          { id: "doc3", fileName: "BL.pdf", status: "Received", createdAt: at("2026-01-03"), shipmentId: "s1", shipmentNumber: "SHP-1" },
        ],
      })
    );
    expect(countByPriority(queue)).toEqual({ critical: 0, high: 2, normal: 0 });
  });
});

describe("work queue links", () => {
  it("points a decision at the parameter the decisions page actually reads", () => {
    // `?decision=` was ignored by the page, so the link opened whichever
    // decision sorted first instead of the one the queue named.
    const [item] = buildWorkQueue(
      input({
        decisions: [
          { id: "d 1/x", agentName: "A", decisionSummary: "s", status: "Review Required", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: null },
        ],
      })
    );
    expect(item.href).toBe("/app/decisions?decisionId=d%201%2Fx");
  });

  it("links a finding to its filing and a document to its shipment", () => {
    const queue = buildWorkQueue(
      input({
        findings: [
          { id: "c1", rule: "R", severity: "High", status: "Open", createdAt: at("2026-01-01"), filingId: "f1", assignedToUserId: null },
        ],
        documents: [
          { id: "doc1", fileName: "f.pdf", status: "Missing", createdAt: at("2026-01-02"), shipmentId: "s9", shipmentNumber: null },
        ],
      })
    );
    expect(queue.find((i) => i.kind === "finding")?.href).toBe("/app/filing?filingId=f1");
    expect(queue.find((i) => i.kind === "document")?.href).toBe("/app/shipments/s9");
  });
});

describe("work queue status allowlists", () => {
  it("exposes exactly the statuses buildWorkQueue accepts, so the query can filter on them", () => {
    // A status in the query filter but not in the builder would load rows the
    // queue then drops; the reverse would hide work the queue can show.
    for (const status of DECISION_ACTIONABLE_STATUSES) {
      const queue = buildWorkQueue(
        input({
          decisions: [
            { id: "d1", agentName: "A", decisionSummary: "s", status, createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: null },
          ],
        })
      );
      expect(queue).toHaveLength(1);
    }

    for (const status of DOCUMENT_ACTIONABLE_STATUSES) {
      const queue = buildWorkQueue(
        input({
          documents: [
            { id: "doc1", fileName: "f.pdf", status, createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: null },
          ],
        })
      );
      expect(queue).toHaveLength(1);
    }

    for (const filingStatus of FILING_ACTIONABLE_STATUSES) {
      const queue = buildWorkQueue(
        input({
          filings: [
            { id: "f1", entryNumber: "E", filingStatus, createdAt: at("2026-01-01"), shipmentNumber: null },
          ],
        })
      );
      expect(queue).toHaveLength(1);
    }

    for (const status of FINDING_ACTIONABLE_STATUSES) {
      const queue = buildWorkQueue(
        input({
          findings: [
            { id: "c1", rule: "R", severity: "High", status, createdAt: at("2026-01-01"), filingId: "f1", assignedToUserId: null },
          ],
        })
      );
      expect(queue).toHaveLength(1);
    }
  });
});

describe("work queue filter", () => {
  function queue(): ReturnType<typeof buildWorkQueue> {
    return buildWorkQueue(
      input({
        decisions: [
          { id: "d1", agentName: "A", decisionSummary: "s", status: "Attention", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: null },
          { id: "d2", agentName: "B", decisionSummary: "s", status: "Pending", createdAt: at("2026-01-02"), shipmentId: "s1", shipmentNumber: null },
        ],
        findings: [
          { id: "c1", rule: "R", severity: "Warning", status: "Open", createdAt: at("2026-01-03"), filingId: "f1", assignedToUserId: ME },
        ],
      })
    );
  }

  it("defaults to no filter and the first page", () => {
    const filter = parseWorkFilter(new URLSearchParams());
    expect(filter).toEqual({
      kind: null,
      priority: null,
      assignedToMe: false,
      page: 1,
      pageSize: WORK_PAGE_SIZE,
    });
    expect(filterWorkQueue(queue(), filter)).toHaveLength(3);
  });

  it("drops a kind or priority it does not recognise instead of showing nothing", () => {
    const filter = parseWorkFilter(new URLSearchParams("kind=invoice&priority=urgent"));
    expect(filter.kind).toBeNull();
    expect(filter.priority).toBeNull();
  });

  it("filters to one kind", () => {
    const filter = parseWorkFilter(new URLSearchParams("kind=finding"));
    expect(filterWorkQueue(queue(), filter).map((i) => i.id)).toEqual(["finding:c1"]);
  });

  it("filters to one priority", () => {
    const filter = parseWorkFilter(new URLSearchParams("priority=critical"));
    expect(filterWorkQueue(queue(), filter).map((i) => i.id)).toEqual(["decision:d1"]);
  });

  it("filters to the caller's own items", () => {
    const filter = parseWorkFilter(new URLSearchParams("mine=1"));
    expect(filterWorkQueue(queue(), filter).map((i) => i.id)).toEqual(["finding:c1"]);
  });

  it("pages without reordering", () => {
    const filter = parseWorkFilter(new URLSearchParams("pageSize=2&page=2"));
    const all = queue();
    expect(paginateWorkQueue(all, filter)).toEqual([all[2]]);
  });

  it("falls back to page one when the page number is not a positive integer", () => {
    expect(parseWorkFilter(new URLSearchParams("page=0")).page).toBe(1);
    expect(parseWorkFilter(new URLSearchParams("page=-3")).page).toBe(1);
    expect(parseWorkFilter(new URLSearchParams("page=two")).page).toBe(1);
  });

  it("caps the page size so one request cannot ask for the whole account", () => {
    expect(parseWorkFilter(new URLSearchParams("pageSize=5000")).pageSize).toBe(100);
  });
});

describe("truncatedSources", () => {
  it("names only the sources that hit the row cap", () => {
    expect(
      truncatedSources({
        decision: { loaded: 200, matching: 431 },
        finding: { loaded: 12, matching: 12 },
        filing: { loaded: 0, matching: 0 },
      })
    ).toEqual(["decision"]);
  });

  it("says nothing when every matching row was loaded", () => {
    expect(
      truncatedSources({
        decision: { loaded: 3, matching: 3 },
        document: { loaded: 0, matching: 0 },
      })
    ).toEqual([]);
  });
});
