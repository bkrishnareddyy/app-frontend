import { describe, it, expect } from "vitest";
import { getAllDatasets, getDatasetById, refreshDataset } from "@/lib/data/datasetRegistry";

describe("Dataset Registry & Refresh Policy", () => {
  it("registers exactly 18 datasets", () => {
    const datasets = getAllDatasets();
    expect(datasets.length).toBe(18);
  });

  it("contains 11 Free Public APIs and 7 Structured Documents", () => {
    const datasets = getAllDatasets();
    const publicApis = datasets.filter((d) => d.category === "Public API");
    const structuredDocs = datasets.filter((d) => d.category === "Structured Document");

    expect(publicApis.length).toBe(11);
    expect(structuredDocs.length).toBe(7);
  });

  it("ensures all 18 datasets have non-empty required attributes", () => {
    const datasets = getAllDatasets();
    for (const d of datasets) {
      expect(d.id).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.powers).toBeTruthy();
      expect(d.source).toBeTruthy();
      expect(d.cost).toBe("Free");
      expect(d.refreshMethod).toBeTruthy();
      expect(d.frequency).toBeTruthy();
      expect(d.lastRun).toBeTruthy();
      expect(d.status).toBeTruthy();
      expect(d.engineeringEffort).toBeTruthy();
    }
  });

  it("retrieves a dataset by ID", () => {
    const hts = getDatasetById("hts-schedule");
    expect(hts).toBeDefined();
    expect(hts?.name).toContain("HTSUS Schedule");

    const sec301 = getDatasetById("section-301-rates");
    expect(sec301).toBeDefined();
    expect(sec301?.category).toBe("Structured Document");
  });

  it("triggers manual refresh for a dataset", async () => {
    const result = await refreshDataset("section-301-exclusions");
    expect(result.success).toBe(true);
    expect(result.dataset.status).toBe("success");
    expect(result.dataset.lastRun).toBeTruthy();
  });
});
