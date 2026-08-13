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
  timePressure,
  truncatedSources,
  type DeadlineRow,
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
    expect(queue[0].href).toBe("/app/actions?exceptionId=e1");
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
    expect(item.href).toBe("/app/actions?decisionId=d%201%2Fx");
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
          // BLOCKED_DEPENDENCY → triaged as blocked → critical priority
          { id: "d1", agentName: "A", decisionSummary: "s", status: "BLOCKED_DEPENDENCY", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: null },
          // Needs Review → triaged as review → high priority
          { id: "d2", agentName: "B", decisionSummary: "s", status: "Needs Review", createdAt: at("2026-01-02"), shipmentId: "s1", shipmentNumber: null },
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

// ── timePressure monotonicity ──────────────────────────────────────────────

describe("timePressure", () => {
  it("returns 2 when breached (msRemaining <= 0)", () => {
    expect(timePressure(0)).toBe(2);
    expect(timePressure(-1)).toBe(2);
  });

  it("is monotonically decreasing as time remaining grows", () => {
    const samples = [
      1 * 3_600_000,   // 1h
      24 * 3_600_000,  // 24h
      3 * 24 * 3_600_000, // 3d
      30 * 24 * 3_600_000, // 30d
    ];
    for (let i = 0; i < samples.length - 1; i++) {
      expect(timePressure(samples[i])).toBeGreaterThan(timePressure(samples[i + 1]));
    }
  });

  it("never returns a value below 0", () => {
    expect(timePressure(365 * 24 * 3_600_000)).toBeGreaterThan(0);
  });
});

// ── Deadline urgency in the work queue ────────────────────────────────────

describe("deadline urgency and scoring", () => {
  const baseDecision = {
    id: "d1",
    agentName: "Classification Agent",
    decisionSummary: "review needed",
    status: "Review Required",
    createdAt: at("2026-01-01"),
    shipmentId: "s1",
    shipmentNumber: "SHP-001",
  };

  function deadline(overrides: Partial<DeadlineRow> = {}): DeadlineRow {
    return {
      shipmentId: "s1",
      type: "ISF_10_2",
      dueAt: at("2026-06-01T12:00:00Z"),
      estimated: false,
      penaltyEstimate: 5_000,
      ...overrides,
    };
  }

  it("attaches urgency context to a decision on a shipment with an open deadline", () => {
    const queue = buildWorkQueue(
      input({ decisions: [baseDecision], deadlines: [deadline()] })
    );
    expect(queue[0].urgency).not.toBeNull();
    expect(queue[0].urgency?.deadlineType).toBe("ISF_10_2");
    expect(queue[0].urgency?.exposureUsd).toBe(5_000);
  });

  it("leaves urgency null for items with no matching shipment deadline", () => {
    const queue = buildWorkQueue(
      input({
        decisions: [baseDecision],
        deadlines: [deadline({ shipmentId: "other-shipment" })],
      })
    );
    expect(queue[0].urgency).toBeNull();
  });

  it("breached deadline outranks a critical item without a deadline", () => {
    const now = Date.now();
    const breachedDeadline: DeadlineRow = {
      shipmentId: "s2",
      type: "ENTRY_FILING",
      dueAt: new Date(now - 3_600_000), // 1h ago — breached
      estimated: false,
      penaltyEstimate: null,
    };
    const queue = buildWorkQueue(
      input({
        decisions: [
          { ...baseDecision, id: "d1", shipmentId: "s1" }, // critical, no deadline
          { ...baseDecision, id: "d2", shipmentId: "s2", status: "BLOCKED_DEPENDENCY" }, // critical + breached deadline
        ],
        deadlines: [breachedDeadline],
      })
    );
    // d2 has a breached deadline → higher score → first in queue
    expect(queue[0].id).toBe("decision:d2");
    expect(queue[0].urgency?.breached).toBe(true);
  });

  it("deadline urgency raises priority from high to critical at <24h", () => {
    const now = Date.now();
    const urgentDeadline: DeadlineRow = {
      shipmentId: "s1",
      type: "ISF_10_2",
      dueAt: new Date(now + 2 * 3_600_000), // 2h away
      estimated: false,
      penaltyEstimate: 5_000,
    };
    const queue = buildWorkQueue(
      input({ decisions: [baseDecision], deadlines: [urgentDeadline] })
    );
    expect(queue[0].priority).toBe("critical");
  });

  it("deadline urgency does not demote an already-critical item", () => {
    const now = Date.now();
    const farDeadline: DeadlineRow = {
      shipmentId: "s1",
      type: "ENTRY_FILING",
      dueAt: new Date(now + 30 * 24 * 3_600_000), // 30 days away
      estimated: false,
      penaltyEstimate: null,
    };
    // The decision is "critical" due to BLOCKED status.
    const blockedDecision = { ...baseDecision, status: "BLOCKED_DEPENDENCY" };
    const queue = buildWorkQueue(
      input({ decisions: [blockedDecision], deadlines: [farDeadline] })
    );
    expect(queue[0].priority).toBe("critical");
  });

  it("shipment rollup: a breached deadline on a shipment lifts all that shipment's items", () => {
    const now = Date.now();
    const breached: DeadlineRow = {
      shipmentId: "s1",
      type: "ISF_10_2",
      dueAt: new Date(now - 1_000),
      estimated: false,
      penaltyEstimate: 5_000,
    };
    const queue = buildWorkQueue(
      input({
        decisions: [
          { ...baseDecision, id: "d1", shipmentId: "s1", status: "Review Required" }, // high base
        ],
        documents: [
          { id: "doc1", fileName: "INV.pdf", status: "Review Required", createdAt: at("2026-01-01"), shipmentId: "s1", shipmentNumber: "SHP-001" },
        ],
        deadlines: [breached],
      })
    );
    for (const item of queue) {
      if (item.id === "decision:d1" || item.id === "document:doc1") {
        expect(item.priority).toBe("critical");
      }
    }
  });

  it("score monotonicity: lower msRemaining → higher score for otherwise identical items", () => {
    const now = Date.now();
    const soon: DeadlineRow = { shipmentId: "s1", type: "ISF_10_2", dueAt: new Date(now + 2 * 3_600_000), estimated: false, penaltyEstimate: 5_000 };
    const later: DeadlineRow = { shipmentId: "s2", type: "ISF_10_2", dueAt: new Date(now + 72 * 3_600_000), estimated: false, penaltyEstimate: 5_000 };

    const q1 = buildWorkQueue(input({ decisions: [{ ...baseDecision, shipmentId: "s1" }], deadlines: [soon] }));
    const q2 = buildWorkQueue(input({ decisions: [{ ...baseDecision, shipmentId: "s2" }], deadlines: [later] }));
    expect(q1[0].score).toBeGreaterThan(q2[0].score);
  });

  it("score is never exposed in the item's title, reason, or href", () => {
    const queue = buildWorkQueue(input({ decisions: [baseDecision] }));
    const item = queue[0];
    expect(String(item.title)).not.toContain("score");
    expect(String(item.reason)).not.toContain("score");
    expect(String(item.href)).not.toContain("score");
  });

  it("tenant isolation: deadline from a different shipment never attaches to an unrelated item", () => {
    const queue = buildWorkQueue(
      input({
        decisions: [{ ...baseDecision, shipmentId: "tenant-a-s1" }],
        deadlines: [deadline({ shipmentId: "tenant-b-s99" })],
      })
    );
    expect(queue[0].urgency).toBeNull();
  });
});
