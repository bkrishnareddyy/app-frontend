import { describe, it, expect, vi, beforeEach } from "vitest";

// Restricted / Denied-Party Screening: partyScreeningLifecycle.ts
// Covers: rescreenParty's current-effective identity resolution, the
// PartyHasNoActiveNameError guard, worst-of-two-outcomes status rollup, and
// markStaleIfChanged's identity-hash comparison (never clock-driven, always
// best-effort/non-throwing).

const partyNameFindFirst = vi.fn();
const partyAddressFindFirst = vi.fn();
const partyContactFindFirst = vi.fn();
const partyScreeningSummaryUpsert = vi.fn();
const partyScreeningSummaryFindUnique = vi.fn();
const partyScreeningSummaryUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    partyName: { findFirst: partyNameFindFirst },
    partyAddress: { findFirst: partyAddressFindFirst },
    partyContact: { findFirst: partyContactFindFirst },
    partyScreeningSummary: {
      upsert: partyScreeningSummaryUpsert,
      findUnique: partyScreeningSummaryFindUnique,
      update: partyScreeningSummaryUpdate,
    },
  },
}));

const runRestrictedPartyScreening = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/restrictedPartyScreening", () => ({
  runRestrictedPartyScreening,
}));

const persistScreeningRun = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/persistResult", () => ({
  persistScreeningRun,
}));

const { rescreenParty, markStaleIfChanged, PartyHasNoActiveNameError } = await import(
  "@/modules/agents/compliance/restrictedParty/partyScreeningLifecycle"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rescreenParty: current-effective identity resolution", () => {
  it("throws PartyHasNoActiveNameError when the party has no active name", async () => {
    partyNameFindFirst.mockResolvedValue(null);
    partyAddressFindFirst.mockResolvedValue(null);
    partyContactFindFirst.mockResolvedValue(null);

    await expect(rescreenParty("acct_1", "party_1")).rejects.toThrow(PartyHasNoActiveNameError);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("builds the identity from the primary-then-most-recent name/address/contact and screens it", async () => {
    partyNameFindFirst.mockResolvedValue({ rawName: "Acme Trading Co" });
    partyAddressFindFirst.mockResolvedValue({ addressLine1: "1 Main St", city: "Springfield", country: "US" });
    partyContactFindFirst.mockResolvedValue({ name: "Jane Doe" });
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([
      { id: "result_1", passType: "PARTY_NAME", status: "CLEAR" },
    ]);

    await rescreenParty("acct_1", "party_1");

    expect(runRestrictedPartyScreening).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct_1",
        source: "PARTY_MASTER",
        partyId: "party_1",
        identity: {
          name: "Acme Trading Co",
          address: "1 Main St",
          city: "Springfield",
          country: "US",
          contactName: "Jane Doe",
        },
      })
    );
  });
});

describe("rescreenParty: worst-of-two-outcomes status rollup", () => {
  it("takes the worse of two pass outcomes for the summary's overall status", async () => {
    partyNameFindFirst.mockResolvedValue({ rawName: "Acme Trading Co" });
    partyAddressFindFirst.mockResolvedValue(null);
    partyContactFindFirst.mockResolvedValue({ name: "Jane Doe" });
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([
      { id: "result_party", passType: "PARTY_NAME", status: "CLEAR" },
      { id: "result_contact", passType: "CONTACT_NAME", status: "HIT" },
    ]);

    const { overallStatus } = await rescreenParty("acct_1", "party_1");

    expect(overallStatus).toBe("HIT");
    expect(partyScreeningSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partyId: "party_1" },
        create: expect.objectContaining({ screeningStatus: "HIT", lastScreeningResultId: "result_party" }),
        update: expect.objectContaining({ screeningStatus: "HIT", lastScreeningResultId: "result_party" }),
      })
    );
  });

  it("rolls up to CLEAR when every pass clears", async () => {
    partyNameFindFirst.mockResolvedValue({ rawName: "Acme Trading Co" });
    partyAddressFindFirst.mockResolvedValue(null);
    partyContactFindFirst.mockResolvedValue(null);
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([{ id: "result_party", passType: "PARTY_NAME", status: "CLEAR" }]);

    const { overallStatus } = await rescreenParty("acct_1", "party_1");
    expect(overallStatus).toBe("CLEAR");
  });
});

describe("markStaleIfChanged", () => {
  it("is a no-op when the party has never been screened", async () => {
    partyScreeningSummaryFindUnique.mockResolvedValue(null);
    await markStaleIfChanged(db(), "acct_1", "party_1");
    expect(partyScreeningSummaryUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when already STALE", async () => {
    partyScreeningSummaryFindUnique.mockResolvedValue({ screeningStatus: "STALE", currentInputHash: "abc" });
    await markStaleIfChanged(db(), "acct_1", "party_1");
    expect(partyScreeningSummaryUpdate).not.toHaveBeenCalled();
  });

  it("flips to STALE when the recomputed identity hash no longer matches", async () => {
    partyScreeningSummaryFindUnique.mockResolvedValue({ screeningStatus: "CLEAR", currentInputHash: "stale-hash" });
    partyNameFindFirst.mockResolvedValue({ rawName: "Acme Trading Co (renamed)" });
    partyAddressFindFirst.mockResolvedValue(null);
    partyContactFindFirst.mockResolvedValue(null);

    await markStaleIfChanged(db(), "acct_1", "party_1");

    expect(partyScreeningSummaryUpdate).toHaveBeenCalledWith({
      where: { partyId: "party_1" },
      data: { screeningStatus: "STALE" },
    });
  });

  it("does not flip to STALE when the identity is unchanged", async () => {
    partyNameFindFirst.mockResolvedValue({ rawName: "Acme Trading Co" });
    partyAddressFindFirst.mockResolvedValue(null);
    partyContactFindFirst.mockResolvedValue(null);

    const crypto = await import("crypto");
    const matchingHash = crypto
      .createHash("sha256")
      .update(["acme trading co", "", "", "", ""].join("|"))
      .digest("hex");

    partyScreeningSummaryFindUnique.mockResolvedValue({ screeningStatus: "CLEAR", currentInputHash: matchingHash });

    await markStaleIfChanged(db(), "acct_1", "party_1");
    expect(partyScreeningSummaryUpdate).not.toHaveBeenCalled();
  });

  it("never throws when the summary lookup itself fails (best-effort)", async () => {
    partyScreeningSummaryFindUnique.mockRejectedValue(new Error("db down"));
    await expect(markStaleIfChanged(db(), "acct_1", "party_1")).resolves.toBeUndefined();
  });
});

function db() {
  return {
    partyName: { findFirst: partyNameFindFirst },
    partyAddress: { findFirst: partyAddressFindFirst },
    partyContact: { findFirst: partyContactFindFirst },
    partyScreeningSummary: {
      upsert: partyScreeningSummaryUpsert,
      findUnique: partyScreeningSummaryFindUnique,
      update: partyScreeningSummaryUpdate,
    },
  } as unknown as Parameters<typeof markStaleIfChanged>[0];
}
