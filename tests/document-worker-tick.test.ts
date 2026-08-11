import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * End-to-end worker behaviour against the mock parser provider and an in-memory
 * stand-in for the run table. This is where the ordering guarantees are actually
 * verified rather than asserted about the source: artifacts land before a run is
 * called successful, the active pointer moves only after that, a failed provider
 * call schedules a retry rather than losing the run, and an empty parse queues a
 * NEW run under an OCR profile instead of mutating the one that just finished.
 *
 * The database mock dispatches on the query's shape rather than on call order, so
 * a change to how many queries a tick makes cannot silently invert what the mock
 * returns.
 */

const ACCOUNT = "acct_1";
const DOCUMENT = "doc_1";

interface FakeRun {
  id: string;
  documentId: string;
  accountId: string;
  version: number;
  status: string;
  profile: string;
  reason: string;
  parserProvider: string;
  externalTaskId: string | null;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
  pollAttemptCount: number;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  nextPollAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
}

/** The run table. Mutated by the mock exactly as the real updates would. */
let runTable: FakeRun[] = [];
let documentRow: { activeParseVersionId: string | null; shipmentId: string | null; version?: number };
/** Ordered record of side effects, so ordering is asserted behaviourally. */
const timeline: string[] = [];
const storedArtifacts: Array<{ name: string; byteSize: number }> = [];

function documentFields() {
  return {
    id: DOCUMENT,
    accountId: ACCOUNT,
    fileName: "INV-1.txt",
    fileUrl: "https://store.public.blob.vercel-storage.com/documents/INV-1.txt",
    checksum: "a".repeat(64),
    mimeType: "text/plain",
    byteSize: 128,
  };
}

/** Applies a Prisma-shaped `data` object to a fake row. */
function applyData(run: FakeRun, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && "increment" in (value as object)) {
      const current = (run as unknown as Record<string, number>)[key] ?? 0;
      (run as unknown as Record<string, number>)[key] =
        current + (value as { increment: number }).increment;
      continue;
    }
    (run as unknown as Record<string, unknown>)[key] = value;
  }
}

function statusMatches(where: Record<string, unknown>, status: string): boolean {
  const expected = where.status;
  if (expected === undefined) return true;
  if (typeof expected === "string") return expected === status;
  if (expected !== null && typeof expected === "object" && "in" in expected) {
    return (expected as { in: string[] }).in.includes(status);
  }
  return false;
}

const dbMock = {
  documentParseVersion: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
      if (where.id !== undefined) return runTable.find((run) => run.id === where.id) ?? null;
      return null;
    }),

    findFirst: vi.fn(async ({ where }: { where: { id: string; documentId?: string; accountId?: string } }) => {
      const run = runTable.find((candidate) => candidate.id === where.id);
      if (!run) return null;
      if (where.accountId !== undefined && run.accountId !== where.accountId) return null;
      return run;
    }),

    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // Exhausted-poll sweep.
      if (where.pollAttemptCount !== undefined) {
        const limit = (where.pollAttemptCount as { gte: number }).gte;
        return runTable.filter(
          (run) => statusMatches(where, run.status) && run.pollAttemptCount >= limit
        );
      }
      const now = Date.now();
      // Awaiting submission: new, or a retry whose backoff has elapsed.
      if (where.status === "QUEUED") {
        return runTable
          .filter(
            (run) =>
              run.status === "QUEUED" &&
              (run.nextRetryAt === null || run.nextRetryAt.getTime() <= now)
          )
          .map((run) => ({ ...run, document: documentFields() }));
      }
      // Awaiting poll: the real query also honours nextPollAt, so the fake does
      // too -- otherwise a run would be polled in the same tick that submitted it
      // and the backoff would look like it does not exist.
      if (where.externalTaskId !== undefined) {
        return runTable
          .filter(
            (run) =>
              statusMatches(where, run.status) &&
              run.externalTaskId !== null &&
              (run.nextPollAt === null || run.nextPollAt.getTime() <= now)
          )
          .map((run) => ({ ...run, document: documentFields() }));
      }
      return [];
    }),

    aggregate: vi.fn(async () => ({
      _max: { version: runTable.reduce((max, run) => Math.max(max, run.version), 0) || null },
    })),

    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      timeline.push(`newRun:${data.reason}:${data.profile}`);
      const run: FakeRun = {
        id: `run_${runTable.length + 1}`,
        documentId: DOCUMENT,
        accountId: ACCOUNT,
        version: data.version as number,
        status: data.status as string,
        profile: data.profile as string,
        reason: data.reason as string,
        parserProvider: data.parserProvider as string,
        externalTaskId: null,
        correlationId: data.correlationId as string,
        attemptCount: 0,
        maxAttempts: data.maxAttempts as number,
        pollAttemptCount: 0,
        startedAt: null,
        heartbeatAt: null,
        nextPollAt: null,
        nextRetryAt: null,
        createdAt: new Date(),
      };
      runTable.push(run);
      return run;
    }),

    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const targets = runTable.filter((run) => {
          if (where.id !== undefined && run.id !== where.id) return false;
          if (!statusMatches(where, run.status)) return false;
          if (where.externalTaskId !== undefined) {
            const wantsTask = (where.externalTaskId as { not?: null } | null) !== null;
            if (wantsTask && run.externalTaskId === null) return false;
            if (!wantsTask && run.externalTaskId !== null) return false;
          }
          if (where.heartbeatAt !== undefined) {
            const cutoff = (where.heartbeatAt as { lt: Date }).lt;
            if (run.heartbeatAt === null || run.heartbeatAt >= cutoff) return false;
          }
          return true;
        });

        for (const run of targets) applyData(run, data);
        if (targets.length > 0 && typeof data.status === "string") {
          timeline.push(`status:${data.status}`);
        }
        return { count: targets.length };
      }
    ),
  },

  shipmentDocument: {
    findFirst: vi.fn(async () => documentRow),
    update: vi.fn(async ({ data }: { data: { activeParseVersionId: string } }) => {
      timeline.push("promoted");
      documentRow.activeParseVersionId = data.activeParseVersionId;
      return {};
    }),
  },

  shipmentEventLog: {
    create: vi.fn(async ({ data }: { data: { eventType: string } }) => {
      timeline.push(`event:${data.eventType}`);
      return {};
    }),
  },

  $transaction: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({
  createAuditLog: async (params: { action: string }) => {
    timeline.push(`audit:${params.action}`);
    return null;
  },
}));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    storeProcessingArtifact: async (params: { name: string; body: Buffer }) => {
      timeline.push(`artifact:${params.name}`);
      storedArtifacts.push({ name: params.name, byteSize: params.body.byteLength });
      return {
        url: `https://store.public.blob.vercel-storage.com/${params.name}`,
        filename: params.name,
        size: params.body.byteLength,
        checksum: "d".repeat(64),
        provider: "vercel-blob" as const,
      };
    },
  };
});

const documentSourceMock = vi.fn();
vi.mock("@/modules/documents/processing/documentSource", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/documents/processing/documentSource")
  >("@/modules/documents/processing/documentSource");
  return { ...actual, readOriginalDocument: async () => documentSourceMock() };
});

// Extraction is its own versioned run, covered in its own suite; here it only
// needs to be observable in the timeline.
vi.mock("@/modules/documents/processing/classificationExtraction", () => ({
  runDocumentExtraction: async () => {
    timeline.push("extraction");
    return { ran: true, usedParsedContext: true, extractionRunId: "ext_1", skippedReason: null };
  },
}));

const worker = await import("@/modules/documents/processing/documentProcessingWorker");
const { resetMockParserTasks } = await import(
  "@/modules/documents/parser/mock/mockDoclingProvider"
);

const TEXT_DOCUMENT = Buffer.from(
  "COMMERCIAL INVOICE\nInvoice No: INV-1\nShipper: ACME GmbH\nConsignee: Target Imports LLC\nCurrency: USD"
);
const SCANNED_PDF = Buffer.from("%PDF-1.7 scanned page bytes\n%%EOF");
const ORIGINAL_ENV = { ...process.env };

/**
 * Ticks until every run reaches a terminal state.
 *
 * Between ticks, any pending poll or retry deadline is moved into the past. That
 * models elapsed wall-clock time without sleeping, and keeps the backoff itself
 * honest in the mock (a tick that submitted a run does not also poll it).
 */
async function drive(maxTicks = 8) {
  const terminal = ["SUCCEEDED", "NEEDS_REVIEW", "FAILED"];
  let last = await worker.runWorkerTick();
  let ticks = 1;
  while (ticks < maxTicks) {
    if (runTable.every((run) => terminal.includes(run.status))) break;
    for (const run of runTable) {
      if (run.nextPollAt !== null) run.nextPollAt = new Date(Date.now() - 1);
      if (run.nextRetryAt !== null) run.nextRetryAt = new Date(Date.now() - 1);
    }
    last = await worker.runWorkerTick();
    ticks += 1;
  }
  return { tick: last, ticks };
}

beforeEach(() => {
  vi.clearAllMocks();
  timeline.length = 0;
  storedArtifacts.length = 0;
  resetMockParserTasks();

  process.env.DOCUMENT_PARSER_PROVIDER = "mock";
  delete process.env.NEXT_PUBLIC_APP_URL;
  // Poll immediately in tests; the real backoff is covered by its own unit test.
  process.env.DOCUMENT_POLL_INITIAL_DELAY_MS = "500";

  documentSourceMock.mockResolvedValue({ bytes: TEXT_DOCUMENT, sha256: "a".repeat(64) });
  documentRow = { activeParseVersionId: null, shipmentId: "shp_1" };
  runTable = [];
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) =>
    fn(dbMock)
  );
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Seeds one QUEUED run, the state the upload path leaves behind. */
function seedQueuedRun(overrides: Partial<FakeRun> = {}): FakeRun {
  const run: FakeRun = {
    id: "run_1",
    documentId: DOCUMENT,
    accountId: ACCOUNT,
    version: 1,
    status: "QUEUED",
    profile: "STANDARD",
    reason: "INITIAL",
    parserProvider: "MOCK_PARSER",
    externalTaskId: null,
    correlationId: "corr_1",
    attemptCount: 0,
    maxAttempts: 4,
    pollAttemptCount: 0,
    startedAt: null,
    heartbeatAt: null,
    nextPollAt: null,
    nextRetryAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  runTable.push(run);
  return run;
}

describe("worker tick: no provider configured", () => {
  it("reports a blocker instead of quietly doing nothing", async () => {
    delete process.env.DOCUMENT_PARSER_PROVIDER;
    seedQueuedRun();
    const tick = await worker.runWorkerTick();
    expect(tick.blocker).toMatch(/No document parser provider/);
    expect(tick.submitted).toBe(0);
    // Nothing was claimed, so no run looks "in progress" while unparseable.
    expect(dbMock.documentParseVersion.findMany).not.toHaveBeenCalled();
    expect(runTable[0].status).toBe("QUEUED");
  });

  it("tells the enqueuing caller that nothing will process the document", async () => {
    delete process.env.DOCUMENT_PARSER_PROVIDER;
    const queued = await worker.enqueueDocumentParse({
      accountId: ACCOUNT,
      documentId: DOCUMENT,
      contentSha256: "a".repeat(64),
    });
    expect(queued.runId).toBeNull();
    expect(queued.blocker).not.toBeNull();
    expect(dbMock.documentParseVersion.create).not.toHaveBeenCalled();
  });
});

describe("worker tick: submission", () => {
  it("submits a queued run and durably records the provider task id", async () => {
    seedQueuedRun();
    const tick = await worker.runWorkerTick();

    expect(tick.submitted).toBe(1);
    expect(runTable[0].status).toBe("SUBMITTED");
    expect(runTable[0].externalTaskId).toMatch(/^mock_/);
    expect(runTable[0].attemptCount).toBe(1);
    expect(timeline).toContain("audit:document.processing.submitted");
  });

  it("reclaims abandoned work before it claims anything new", async () => {
    seedQueuedRun();
    await worker.runWorkerTick();
    const reclaims = dbMock.documentParseVersion.updateMany.mock.invocationCallOrder;
    const claims = dbMock.documentParseVersion.findMany.mock.invocationCallOrder;
    expect(Math.min(...reclaims)).toBeLessThan(Math.max(...claims));
  });

  it("keeps the provider task id when reclaiming stale work, rather than resubmitting", async () => {
    // Resubmitting would pay the provider twice for the same document, so a
    // reclaimed run that still has a live task id keeps polling that task.
    const stale = seedQueuedRun({
      status: "POLLING",
      externalTaskId: "mock_live_task",
      heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
      nextPollAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const reclaim = dbMock.documentParseVersion.updateMany.mock.calls.length;
    await worker.runWorkerTick();

    expect(dbMock.documentParseVersion.updateMany.mock.calls.length).toBeGreaterThan(reclaim);

    // The reclaim preserved the task id and made the run due for a poll rather
    // than re-queueing it for a second submission.
    const reclaimCall = dbMock.documentParseVersion.updateMany.mock.calls.find(
      (call) => (call[0].where.externalTaskId as { not?: null } | undefined)?.not === null
    );
    expect(reclaimCall?.[0].data.nextPollAt).toBeInstanceOf(Date);
    expect(reclaimCall?.[0].data.status).toBeUndefined();
    expect(stale.externalTaskId).toBe("mock_live_task");
    expect(timeline).not.toContain("status:QUEUED");

    // The mock provider does not survive a restart, so polling the reclaimed task
    // now fails honestly instead of inventing a result for it.
    expect(stale.status).toBe("FAILED");
  });

  it("re-queues stale work that was never actually submitted", async () => {
    seedQueuedRun({
      status: "SUBMITTED",
      externalTaskId: null,
      heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await worker.runWorkerTick();
    expect(timeline).toContain("status:QUEUED");
  });

  it("schedules a retry rather than losing a run when the source cannot be read", async () => {
    documentSourceMock.mockRejectedValue(new Error("storage down"));
    seedQueuedRun();

    const tick = await worker.runWorkerTick();
    expect(tick.retriesScheduled).toBe(1);
    expect(tick.failed).toBe(0);
    // FAILED then back to QUEUED as the SAME run's next attempt.
    expect(timeline.filter((entry) => entry.startsWith("status:"))).toEqual([
      "status:FAILED",
      "status:QUEUED",
    ]);
    expect(runTable).toHaveLength(1);
    expect(timeline).toContain("audit:document.processing.failed");
  });

  it("does not retry an unreadable document", async () => {
    const { DocumentParserError } = await import("@/modules/documents/parser/contracts");
    documentSourceMock.mockRejectedValue(
      new DocumentParserError("PDF_ENCRYPTED", "encrypted", { retryable: false })
    );
    seedQueuedRun();

    const tick = await worker.runWorkerTick();
    expect(tick.failed).toBe(1);
    expect(tick.retriesScheduled).toBe(0);
    expect(runTable[0].status).toBe("FAILED");
  });

  it("gives up once the attempt budget is spent instead of retrying forever", async () => {
    documentSourceMock.mockRejectedValue(new Error("storage down"));
    seedQueuedRun({ attemptCount: 4, maxAttempts: 4 });

    const tick = await worker.runWorkerTick();
    expect(tick.failed).toBe(1);
    expect(runTable[0].status).toBe("FAILED");
  });
});

describe("worker tick: polling through to completion", () => {
  it("polls before the provider reports success", async () => {
    seedQueuedRun();
    const { ticks } = await drive();
    expect(ticks).toBeGreaterThan(1);
    expect(timeline).toContain("status:POLLING");
    expect(runTable[0].pollAttemptCount).toBeGreaterThan(0);
  });

  it("reaches SUCCEEDED", async () => {
    seedQueuedRun();
    await drive();
    expect(runTable[0].status).toBe("SUCCEEDED");
  });

  it("stores every artifact before the run is called successful", async () => {
    seedQueuedRun();
    await drive();

    const succeededAt = timeline.indexOf("status:SUCCEEDED");
    const artifactIndices = timeline
      .map((entry, index) => (entry.startsWith("artifact:") ? index : -1))
      .filter((index) => index >= 0);

    expect(artifactIndices.length).toBeGreaterThan(0);
    // A run that claims success always has its evidence already stored.
    expect(Math.max(...artifactIndices)).toBeLessThan(succeededAt);
  });

  it("stores the canonical payload, the normalisation, the Markdown and the quality report", async () => {
    seedQueuedRun();
    await drive();
    const names = storedArtifacts.map((artifact) => artifact.name);
    expect(names).toContain("parser-canonical.json");
    expect(names).toContain("parser-normalized.json");
    expect(names).toContain("document.md");
    expect(names).toContain("quality.json");
    // One artifact per type per run.
    expect(new Set(names).size).toBe(names.length);
  });

  it("moves the active pointer only after the run completed", async () => {
    seedQueuedRun();
    await drive();
    const succeededAt = timeline.indexOf("status:SUCCEEDED");
    const promotedAt = timeline.indexOf("promoted");
    expect(succeededAt).toBeGreaterThan(-1);
    expect(promotedAt).toBeGreaterThan(succeededAt);
    expect(documentRow.activeParseVersionId).toBe("run_1");
  });

  it("dispatches downstream work only after promotion", async () => {
    seedQueuedRun();
    await drive();
    const promotedAt = timeline.indexOf("promoted");
    const eventAt = timeline.indexOf("event:DOCUMENT_READY_FOR_CLASSIFICATION");
    const extractionAt = timeline.indexOf("extraction");
    expect(eventAt).toBeGreaterThan(promotedAt);
    expect(extractionAt).toBeGreaterThan(eventAt);
  });

  it("does not promote or dispatch a late run when a newer one is already active", async () => {
    // Run A is still converting when a reprocess creates run B; B is accepted
    // first, then A finally finishes.
    seedQueuedRun({ id: "run_A", version: 1 });
    runTable.push({
      ...seedQueuedRun({ id: "run_B", version: 2, status: "SUCCEEDED" }),
    });
    runTable = runTable.filter((run, index) => runTable.indexOf(run) === index);
    documentRow.activeParseVersionId = "run_B";

    await drive();

    const runA = runTable.find((run) => run.id === "run_A");
    // A is still fully persisted for audit...
    expect(runA?.status).toBe("SUCCEEDED");
    expect(storedArtifacts.length).toBeGreaterThan(0);
    // ...but the pointer still names B, and nothing downstream ran off A.
    expect(documentRow.activeParseVersionId).toBe("run_B");
    expect(timeline).not.toContain("promoted");
    expect(timeline).not.toContain("extraction");
  });

  it("treats a duplicate completion by another worker as a no-op", async () => {
    seedQueuedRun();
    // Drive to the point of completion, then make the completing update lose.
    await worker.runWorkerTick();
    const realUpdate = dbMock.documentParseVersion.updateMany.getMockImplementation();
    dbMock.documentParseVersion.updateMany.mockImplementation(async (args) => {
      if (args.data.status === "SUCCEEDED") return { count: 0 };
      return realUpdate!(args);
    });

    const { tick } = await drive(4);
    expect(tick.completed).toBe(0);
    expect(timeline).not.toContain("promoted");
    expect(timeline).not.toContain("extraction");
  });
});

describe("worker tick: OCR escalation", () => {
  it("queues a NEW run under an OCR profile when the parse recovered no text", async () => {
    // The mock parser cannot read a PDF, so it yields an empty parse -- exactly
    // what a scanned, image-only document produces.
    documentSourceMock.mockResolvedValue({ bytes: SCANNED_PDF, sha256: "a".repeat(64) });
    seedQueuedRun();

    await drive(4);

    const original = runTable.find((run) => run.id === "run_1");
    // The completed run is real and recorded, but not authoritative.
    expect(original?.status).toBe("NEEDS_REVIEW");
    expect(timeline).not.toContain("promoted");
    expect(documentRow.activeParseVersionId).toBeNull();

    // A separate new run carries the OCR profile; the old one was not mutated.
    expect(timeline).toContain("newRun:OCR_RETRY:FULL_PAGE_OCR");
    expect(timeline).toContain("audit:document.processing.ocr_retry");
    const retry = runTable.find((run) => run.reason === "OCR_RETRY");
    expect(retry?.profile).toBe("FULL_PAGE_OCR");
    expect(retry?.version).toBe(2);
    expect(retry?.id).not.toBe(original?.id);
  });

  it("records the quality reasons that drove the escalation", async () => {
    documentSourceMock.mockResolvedValue({ bytes: SCANNED_PDF, sha256: "a".repeat(64) });
    seedQueuedRun();
    await drive(4);
    expect(timeline).toContain("audit:document.processing.needs_review");
  });
});

describe("worker tick: idempotent enqueue", () => {
  it("returns the existing run for a repeated request instead of creating a second", async () => {
    const first = await worker.enqueueDocumentParse({
      accountId: ACCOUNT,
      documentId: DOCUMENT,
      contentSha256: "a".repeat(64),
    });
    expect(first.created).toBe(true);

    // The findUnique-by-idempotencyKey path is what deduplicates; the fake table
    // resolves it by the key the repository computed.
    dbMock.documentParseVersion.findUnique.mockImplementationOnce(async () => runTable[0]);
    const second = await worker.enqueueDocumentParse({
      accountId: ACCOUNT,
      documentId: DOCUMENT,
      contentSha256: "a".repeat(64),
    });
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(runTable).toHaveLength(1);
  });
});
