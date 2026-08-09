import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A failed pipeline run is terminal: the queue only reclaims runs that stall
 * mid-flight. These tests pin the retry down to that one case, because
 * re-queueing a job that is still PROCESSING would hand the same state to two
 * workers.
 */

const ctxMock = vi.fn();
const auditMock = vi.fn();

const dbMock = {
  shipment: { findFirst: vi.fn() },
  pipelineJob: { findFirst: vi.fn(), updateMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: async () => true,
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: (p: unknown) => auditMock(p) }));

const retry = await import("@/app/api/shipments/[id]/pipeline-retry/route");

const ACCOUNT = "acc_1";
const SHIPMENT = "shp_1";
const JOB = "job_1";

function context(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u_1",
    accountId: ACCOUNT,
    firstName: "Jane",
    lastName: "Broker",
    roleNames: ["ADMIN"],
    isPlatformAdmin: false,
    ...overrides,
  };
}

function call(id = SHIPMENT) {
  return retry.POST(
    new Request(`http://localhost/api/shipments/${id}/pipeline-retry`, { method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ctxMock.mockResolvedValue(context());
  dbMock.shipment.findFirst.mockResolvedValue({ id: SHIPMENT });
  dbMock.pipelineJob.findFirst.mockResolvedValue({ id: JOB, status: "FAILED" });
  dbMock.pipelineJob.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/shipments/[id]/pipeline-retry", () => {
  it("rejects an unauthenticated caller without touching the queue", async () => {
    ctxMock.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(401);
    expect(dbMock.pipelineJob.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a read-only role", async () => {
    ctxMock.mockResolvedValue(context({ roleNames: ["VIEWER"] }));

    const res = await call();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "READ_ONLY_ROLE" } });
    expect(dbMock.pipelineJob.updateMany).not.toHaveBeenCalled();
  });

  it("does not reach another account's shipment", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(dbMock.shipment.findFirst.mock.calls[0][0].where).toEqual({
      accountId: ACCOUNT,
      id: SHIPMENT,
      deletedAt: null,
    });
    expect(dbMock.pipelineJob.updateMany).not.toHaveBeenCalled();
  });

  it("reports that no run exists rather than inventing one", async () => {
    dbMock.pipelineJob.findFirst.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NO_PIPELINE_JOB" } });
    expect(dbMock.pipelineJob.updateMany).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "PROCESSING", "COMPLETED"])(
    "refuses to re-queue a run that is %s",
    async (status) => {
      dbMock.pipelineJob.findFirst.mockResolvedValue({ id: JOB, status });

      const res = await call();

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "JOB_NOT_FAILED" } });
      expect(dbMock.pipelineJob.updateMany).not.toHaveBeenCalled();
    }
  );

  it("re-queues a failed run and clears the previous failure", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobId: JOB, status: "PENDING" });

    const update = dbMock.pipelineJob.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: JOB, accountId: ACCOUNT, status: "FAILED" });
    expect(update.data).toEqual({
      status: "PENDING",
      errorMessage: null,
      lockedAt: null,
      startedAt: null,
      completedAt: null,
    });
  });

  it("claims the row on FAILED, so a second press does not re-queue twice", async () => {
    dbMock.pipelineJob.updateMany.mockResolvedValue({ count: 0 });

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "JOB_NOT_FAILED" } });
  });

  it("records the retry in the audit trail", async () => {
    await call();

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        userId: "u_1",
        action: "PIPELINE_RETRY",
        entity: "PipelineJob",
        entityId: JOB,
      })
    );
  });
});
