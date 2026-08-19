import { describe, it, expect, vi, beforeEach } from "vitest";
import { RulingService } from "./rulingService";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    ruling: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe("RulingService.searchRulings term-relevance similarity engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("ranks candidates based on title phrase matches, term frequencies, and HTS alignment", async () => {
    const mockRulings = [
      {
        id: "r1",
        rulingNumber: "NY N301234",
        title: "Classification of merchandise",
        issuedAt: new Date("2023-01-01"),
        modifiedOrRevokedStatus: "EFFECTIVE",
        htsReferences: [{ htsNumberDisplay: "6205.20.2065" }],
        fragments: [
          {
            fragmentType: "FACTS",
            text: "The merchandise is a men's woven cotton shirt with long sleeves and printed graphic patterns.",
          },
        ],
      },
      {
        id: "r2",
        rulingNumber: "HQ H123456",
        title: "Classification of Printed Cotton Woven Shirt",
        issuedAt: new Date("2025-05-10"),
        modifiedOrRevokedStatus: "EFFECTIVE",
        htsReferences: [{ htsNumberDisplay: "6205.20.2050" }],
        fragments: [
          {
            fragmentType: "LEGAL_ANALYSIS",
            text: "Printed cotton shirt classified under heading 6205 as men's woven shirt.",
          },
        ],
      },
      {
        id: "r3",
        rulingNumber: "NY N000001",
        title: "Classification of Plastic Toys",
        issuedAt: new Date("2020-01-01"),
        modifiedOrRevokedStatus: "EFFECTIVE",
        htsReferences: [{ htsNumberDisplay: "9503.00.0000" }],
        fragments: [
          {
            fragmentType: "FACTS",
            text: "Plastic toy figurine.",
          },
        ],
      },
    ];

    vi.mocked(db.ruling.findMany).mockResolvedValue(mockRulings as any);

    const results = await RulingService.searchRulings({
      query: "printed cotton shirt",
      htsCode: "6205.20",
      limit: 5,
    });

    expect(results).toHaveLength(3);
    // Ruling r2 has title phrase match + title token matches + HTS alignment + recent date -> top score
    expect(results[0].rulingNumber).toBe("HQ H123456");
    expect(results[0].relevanceScore!).toBeGreaterThan(results[1].relevanceScore!);
    expect(results[1].rulingNumber).toBe("NY N301234");
  });
});
