import { describe, it, expect, vi, beforeEach } from "vitest";

// bis-csl-ingest used to call fetchAndIngest() with its default staged=true,
// so every ingested BIS CSL row (Entity List, DPL, MEU List, etc.) landed as
// DRAFT. Nothing in the codebase ever calls publishStagedEntities(), so those
// rows were permanently invisible to screening (which only reads PUBLISHED
// rows) -- unlike OFAC SDN and UFLPA Entity List, which publish directly.

const fetchAndIngestMock = vi.fn();

vi.mock("@/lib/api/auth-guards", () => ({
  withCronRoute: (handler: any) => (req: any) => handler({ req, requestId: "test-req-1" }),
}));
vi.mock("@/modules/screening/bisCslIngestionService", () => ({
  BisCslIngestionService: { fetchAndIngest: fetchAndIngestMock },
}));

const { GET } = await import("@/app/api/cron/bis-csl-ingest/route");

beforeEach(() => {
  vi.clearAllMocks();
  fetchAndIngestMock.mockResolvedValue({ success: true, count: 10, supersededCount: 0, note: "ok" });
});

describe("bis-csl-ingest route", () => {
  it("publishes directly (staged=false) instead of leaving rows as DRAFT", async () => {
    await GET(new Request("http://localhost/api/cron/bis-csl-ingest"));

    expect(fetchAndIngestMock).toHaveBeenCalledTimes(1);
    const [, staged] = fetchAndIngestMock.mock.calls[0];
    expect(staged).toBe(false);
  });
});
