import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Durable run lifecycle: idempotency under duplicate delivery, legal transitions
 * only, retry accounting, stale reclaim, and the stale-run guard that stops a
 * slow older parse from displacing a newer accepted one.
 */

const dbMock = {
  documentParseVersion: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  shipmentDocument: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const runs = await import("@/modules/documents/processing/processingRuns");

const ACCOUNT = "acct_1";
const DOCUMENT = "doc_1";
const SHA = "c".repeat(64);

const CREATE_INPUT = {
  accountId: ACCOUNT,
  documentId: DOCUMENT,
  contentSha256: SHA,
  parserProvider: "IBM_DOCLING",
  profile: "STANDARD" as const,
  configHash: "cfg1",
  reason: "INITIAL" as const,
  correlationId: "corr_1",
};

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run_1",
    documentId: DOCUMENT,
    accountId: ACCOUNT,
    version: 1,
    status: "QUEUED",
    profile: "STANDARD",
    reason: "INITIAL",
    parserProvider: "IBM_DOCLING",
    externalTaskId: null,
    correlationId: "corr_1",
    attemptCount: 0,
    maxAttempts: 4,
    pollAttemptCount: 0,
    startedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.documentParseVersion.findUnique.mockResolvedValue(null);
  dbMock.documentParseVersion.aggregate.mockResolvedValue({ _max: { version: null } });
  dbMock.documentParseVersion.create.mockResolvedValue(runRow());
  dbMock.documentParseVersion.updateMany.mockResolvedValue({ count: 1 });
  dbMock.documentParseVersion.findMany.mockResolvedValue([]);
  // Run the transaction body against the same mock client.
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) =>
    fn(dbMock)
  );
});

describe("run creation is idempotent", () => {
  it("creates one QUEUED run for new work", async () => {
    const { run, created } = await runs.createOrFindRun(CREATE_INPUT);
    expect(created).toBe(true);
    expect(run.id).toBe("run_1");

    const data = dbMock.documentParseVersion.create.mock.calls[0][0].data;
    expect(data.status).toBe("QUEUED");
    expect(data.version).toBe(1);
    expect(data.idempotencyKey).toBe(runs.buildIdempotencyKey(CREATE_INPUT));
    // No parse has happened, so no confidence is invented to fill the column.
    expect(data.confidence).toBeNull();
  });

  it("returns the existing run for a duplicate queue delivery instead of a second one", async () => {
    dbMock.documentParseVersion.findUnique.mockResolvedValue(runRow({ id: "run_existing" }));
    const { run, created } = await runs.createOrFindRun(CREATE_INPUT);
    expect(created).toBe(false);
    expect(run.id).toBe("run_existing");
    expect(dbMock.documentParseVersion.create).not.toHaveBeenCalled();
  });

  it("yields to the winner when two workers race the unique constraint", async () => {
    dbMock.documentParseVersion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "6.19.3",
      })
    );
    dbMock.documentParseVersion.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(runRow({ id: "run_winner" }));

    const { run, created } = await runs.createOrFindRun(CREATE_INPUT);
    expect(created).toBe(false);
    expect(run.id).toBe("run_winner");
  });

  it("numbers a reprocess as a new higher version rather than reusing the old one", async () => {
    dbMock.documentParseVersion.aggregate.mockResolvedValue({ _max: { version: 3 } });
    await runs.createOrFindRun({ ...CREATE_INPUT, profile: "FULL_PAGE_OCR", reason: "MANUAL_REPROCESS" });
    expect(dbMock.documentParseVersion.create.mock.calls[0][0].data.version).toBe(4);
  });
});

describe("transitions", () => {
  it("applies a legal transition conditionally on the current status", async () => {
    const moved = await runs.transitionRun({ runId: "run_1", from: "QUEUED", to: "SUBMITTED" });
    expect(moved).toBe(true);
    const call = dbMock.documentParseVersion.updateMany.mock.calls[0][0];
    // Conditional on `status`, so two racing workers cannot both apply it.
    expect(call.where).toEqual({ id: "run_1", status: "QUEUED" });
    expect(call.data.status).toBe("SUBMITTED");
  });

  it("reports a lost race rather than claiming success", async () => {
    dbMock.documentParseVersion.updateMany.mockResolvedValue({ count: 0 });
    expect(await runs.transitionRun({ runId: "run_1", from: "QUEUED", to: "SUBMITTED" })).toBe(false);
  });

  it("refuses an illegal transition without touching the database", async () => {
    await expect(
      runs.transitionRun({ runId: "run_1", from: "SUCCEEDED", to: "QUEUED" })
    ).rejects.toThrow(/Illegal processing state transition/);
    expect(dbMock.documentParseVersion.updateMany).not.toHaveBeenCalled();
  });

  it("persists the provider task id at the moment of submission", async () => {
    await runs.recordSubmission({
      runId: "run_1",
      externalTaskId: "task_abc",
      providerStatus: "pending",
      nextPollAt: new Date("2026-01-01T00:00:00Z"),
      unsupportedOptions: ["ocrUsed"],
    });
    const data = dbMock.documentParseVersion.updateMany.mock.calls[0][0].data;
    expect(data.externalTaskId).toBe("task_abc");
    expect(data.attemptCount).toEqual({ increment: 1 });
    expect(data.startedAt).toBeInstanceOf(Date);
    // Unverifiable profile options become a recorded warning, not a silent assumption.
    expect(JSON.stringify(data.warningsJson)).toContain("PROVIDER_OPTION_NOT_VERIFIABLE");
  });

  it("advances the poll counter and next-poll time on each poll", async () => {
    await runs.recordPoll({
      runId: "run_1",
      from: "SUBMITTED",
      providerStatus: "started",
      nextPollAt: new Date("2026-01-01T00:01:00Z"),
    });
    const data = dbMock.documentParseVersion.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("POLLING");
    expect(data.pollAttemptCount).toEqual({ increment: 1 });
    expect(data.heartbeatAt).toBeInstanceOf(Date);
  });

  it("records the artifact index rather than the parser payload in the row", async () => {
    const artifacts = {
      contractVersion: "qubere.parser/1",
      artifacts: [
        {
          artifactType: "DOCLING_JSON" as const,
          storageRef: "https://store.public.blob.vercel-storage.com/a.json",
          mimeType: "application/json",
          byteSize: 10,
          sha256: "f".repeat(64),
          schemaVersion: "qubere.parser/1",
          tableId: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const quality = {
      outcome: "PASS" as const,
      pageCount: 2,
      textCoverage: 1,
      blankPageCount: 0,
      lowTextPageCount: 0,
      tableCount: 1,
      sectionCount: 2,
      totalTextLength: 500,
      warningCount: 0,
      warningCodes: [],
      ocrUsed: null,
      fullPageOcrUsed: null,
      reasons: ["ok"],
      suggestedRetryProfile: null,
      assessedAt: new Date().toISOString(),
    };

    await runs.completeRun({
      runId: "run_1",
      from: "POLLING",
      providerStatus: "success",
      quality,
      artifacts,
      parserName: "DoclingDocument",
      parserVersion: "1.3.0",
      pageCount: 2,
      ocrUsed: null,
      fullPageOcrUsed: null,
      durationMs: 1200,
      warnings: [],
      finalState: "SUCCEEDED",
    });

    const data = dbMock.documentParseVersion.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("SUCCEEDED");
    expect(data.pageCount).toBe(2);
    // Unknown OCR usage stays unknown.
    expect(data.ocrUsed).toBeNull();
    expect(data.nextPollAt).toBeNull();
    expect(data.errorCode).toBeNull();
  });
});

describe("retries", () => {
  it("re-queues the same run when a retryable failure has attempts left", async () => {
    dbMock.documentParseVersion.findUnique.mockResolvedValue({
      attemptCount: 1,
      maxAttempts: 4,
      status: "POLLING",
    });

    const { willRetry } = await runs.failRun({
      runId: "run_1",
      from: "POLLING",
      code: "PARSER_TIMEOUT",
      message: "timed out",
      retryable: true,
    });

    expect(willRetry).toBe(true);
    const failCall = dbMock.documentParseVersion.updateMany.mock.calls[0][0].data;
    expect(failCall.status).toBe("FAILED");
    expect(failCall.nextRetryAt).toBeInstanceOf(Date);
    // Still the same run: a retry is a new attempt, not a new run.
    const requeue = dbMock.documentParseVersion.updateMany.mock.calls[1][0];
    expect(requeue.where).toEqual({ id: "run_1", status: "FAILED" });
    expect(requeue.data.status).toBe("QUEUED");
    // The dead task id is cleared so a later poll cannot read someone else's job.
    expect(requeue.data.externalTaskId).toBeNull();
    expect(requeue.data.pollAttemptCount).toBe(0);
  });

  it("stops at a non-retryable failure however many attempts remain", async () => {
    dbMock.documentParseVersion.findUnique.mockResolvedValue({
      attemptCount: 0,
      maxAttempts: 4,
      status: "QUEUED",
    });
    const { willRetry } = await runs.failRun({
      runId: "run_1",
      from: "QUEUED",
      code: "PDF_ENCRYPTED",
      message: "encrypted",
      retryable: false,
    });
    expect(willRetry).toBe(false);
    expect(dbMock.documentParseVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(dbMock.documentParseVersion.updateMany.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it("stops once the attempt budget is exhausted, and does not disguise it as pending", async () => {
    dbMock.documentParseVersion.findUnique.mockResolvedValue({
      attemptCount: 4,
      maxAttempts: 4,
      status: "POLLING",
    });
    const { willRetry } = await runs.failRun({
      runId: "run_1",
      from: "POLLING",
      code: "PARSER_TIMEOUT",
      message: "timed out",
      retryable: true,
    });
    expect(willRetry).toBe(false);
    expect(dbMock.documentParseVersion.updateMany.mock.calls[0][0].data.nextRetryAt).toBeNull();
  });
});

describe("stale-run recovery", () => {
  it("resumes polling for abandoned work the provider still holds", async () => {
    dbMock.documentParseVersion.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await runs.reclaimStaleRuns();
    expect(result).toEqual({ resumedPolling: 2, requeued: 1 });

    // A run with a live provider task keeps polling: resubmitting would pay twice.
    const polling = dbMock.documentParseVersion.updateMany.mock.calls[0][0];
    expect(polling.where.externalTaskId).toEqual({ not: null });
    expect(polling.data.status).toBeUndefined();

    // A run with no task id has nothing to poll, so it goes back to the queue.
    const requeue = dbMock.documentParseVersion.updateMany.mock.calls[1][0];
    expect(requeue.where.externalTaskId).toBeNull();
    expect(requeue.data.status).toBe("QUEUED");
  });

  it("only reclaims runs whose heartbeat actually went stale", async () => {
    await runs.reclaimStaleRuns();
    for (const call of dbMock.documentParseVersion.updateMany.mock.calls) {
      expect(call[0].where.heartbeatAt.lt).toBeInstanceOf(Date);
      expect(call[0].where.heartbeatAt.lt.getTime()).toBeLessThan(Date.now());
    }
  });
});

describe("stale-run protection on the active pointer", () => {
  it("promotes a successful run when the document has no active version", async () => {
    dbMock.documentParseVersion.findFirst.mockResolvedValue({
      id: "run_2",
      version: 2,
      status: "SUCCEEDED",
      pageCount: 3,
    });
    dbMock.shipmentDocument.findFirst.mockResolvedValue({ activeParseVersionId: null });

    const result = await runs.promoteToActive({
      runId: "run_2",
      documentId: DOCUMENT,
      accountId: ACCOUNT,
    });
    expect(result.promoted).toBe(true);
    const update = dbMock.shipmentDocument.update.mock.calls[0][0];
    expect(update.data.activeParseVersionId).toBe("run_2");
    expect(update.data.pageCount).toBe(3);
  });

  it("refuses a late older run that finished after a newer one was accepted", async () => {
    // Run A starts, reprocess creates run B, B succeeds and becomes active, then
    // A finally finishes. A is kept for audit but must not claim the pointer.
    dbMock.documentParseVersion.findFirst.mockResolvedValue({
      id: "run_A",
      version: 1,
      status: "SUCCEEDED",
      pageCount: 3,
    });
    dbMock.shipmentDocument.findFirst.mockResolvedValue({ activeParseVersionId: "run_B" });
    dbMock.documentParseVersion.findUnique.mockResolvedValue({ version: 2 });

    const result = await runs.promoteToActive({
      runId: "run_A",
      documentId: DOCUMENT,
      accountId: ACCOUNT,
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toMatch(/newer or equal run \(version 2\)/);
    expect(dbMock.shipmentDocument.update).not.toHaveBeenCalled();
  });

  it("refuses to re-promote the run that is already active", async () => {
    dbMock.documentParseVersion.findFirst.mockResolvedValue({
      id: "run_1",
      version: 1,
      status: "SUCCEEDED",
      pageCount: null,
    });
    dbMock.shipmentDocument.findFirst.mockResolvedValue({ activeParseVersionId: "run_1" });
    dbMock.documentParseVersion.findUnique.mockResolvedValue({ version: 1 });

    expect(
      (await runs.promoteToActive({ runId: "run_1", documentId: DOCUMENT, accountId: ACCOUNT }))
        .promoted
    ).toBe(false);
  });

  it("never points the document at an incomplete or failed run", async () => {
    for (const status of ["QUEUED", "POLLING", "FAILED", "NEEDS_REVIEW"]) {
      vi.clearAllMocks();
      dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) =>
        fn(dbMock)
      );
      dbMock.documentParseVersion.findFirst.mockResolvedValue({
        id: "run_x",
        version: 5,
        status,
        pageCount: null,
      });

      const result = await runs.promoteToActive({
        runId: "run_x",
        documentId: DOCUMENT,
        accountId: ACCOUNT,
      });
      expect(result.promoted, status).toBe(false);
      expect(result.reason).toMatch(/Only a SUCCEEDED run/);
      expect(dbMock.shipmentDocument.update).not.toHaveBeenCalled();
    }
  });

  it("refuses a run that does not belong to the document, and says nothing more", async () => {
    dbMock.documentParseVersion.findFirst.mockResolvedValue(null);
    const result = await runs.promoteToActive({
      runId: "run_other_tenant",
      documentId: DOCUMENT,
      accountId: ACCOUNT,
    });
    expect(result.promoted).toBe(false);
    // The lookup is tenant-scoped, so a foreign run is indistinguishable from a
    // missing one.
    expect(dbMock.documentParseVersion.findFirst.mock.calls[0][0].where).toMatchObject({
      documentId: DOCUMENT,
      accountId: ACCOUNT,
    });
  });

  it("scopes promotion to the caller's tenant on both the run and the document", async () => {
    dbMock.documentParseVersion.findFirst.mockResolvedValue({
      id: "run_1",
      version: 1,
      status: "SUCCEEDED",
      pageCount: null,
    });
    dbMock.shipmentDocument.findFirst.mockResolvedValue({ activeParseVersionId: null });
    await runs.promoteToActive({ runId: "run_1", documentId: DOCUMENT, accountId: ACCOUNT });
    expect(dbMock.shipmentDocument.findFirst.mock.calls[0][0].where).toEqual({
      id: DOCUMENT,
      accountId: ACCOUNT,
    });
  });
});

describe("due-work queries", () => {
  it("claims queued runs whose backoff has elapsed", async () => {
    await runs.findRunsAwaitingSubmission(5);
    const where = dbMock.documentParseVersion.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("QUEUED");
    expect(where.OR[0]).toEqual({ nextRetryAt: null });
    expect(where.OR[1].nextRetryAt.lte).toBeInstanceOf(Date);
  });

  it("only polls runs that actually have a provider task id", async () => {
    await runs.findRunsAwaitingPoll(5);
    const where = dbMock.documentParseVersion.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["SUBMITTED", "POLLING"] });
    expect(where.externalTaskId).toEqual({ not: null });
  });

  it("reads the document's stored hash and location alongside the run", async () => {
    await runs.findRunsAwaitingSubmission(1);
    const select = dbMock.documentParseVersion.findMany.mock.calls[0][0].select;
    expect(select.document.select.checksum).toBe(true);
    expect(select.document.select.accountId).toBe(true);
  });
});

describe("terminal state helper", () => {
  it("treats accepted outcomes as terminal and failure as not", () => {
    expect(runs.isTerminal("SUCCEEDED")).toBe(true);
    expect(runs.isTerminal("NEEDS_REVIEW")).toBe(true);
    expect(runs.isTerminal("FAILED")).toBe(false);
    expect(runs.isTerminal(null)).toBe(false);
  });
});
