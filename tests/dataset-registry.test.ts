import { describe, it, expect } from "vitest";
import {
  DATASET_DEFINITIONS,
  getDatasetById,
  triggerDatasetRefresh,
} from "@/lib/data/datasetRegistry";

describe("Dataset Registry — Integrity", () => {
  it("registers exactly 18 datasets", () => {
    expect(DATASET_DEFINITIONS.length).toBe(18);
  });

  it("contains 11 Public API datasets and 7 Structured Document datasets", () => {
    const publicApis = DATASET_DEFINITIONS.filter((d) => d.category === "Public API");
    const structuredDocs = DATASET_DEFINITIONS.filter((d) => d.category === "Structured Document");
    expect(publicApis.length).toBe(11);
    expect(structuredDocs.length).toBe(7);
  });

  it("has exactly 2 LIVE datasets (hts-schedule, federal-register) and 16 NOT_YET_IMPLEMENTED", () => {
    const live = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");
    const notYet = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED");
    expect(live.length).toBe(2);
    expect(live.map((d) => d.id).sort()).toEqual(["federal-register", "hts-schedule"]);
    expect(notYet.length).toBe(16);
  });

  it("all LIVE datasets have an endpoint configured", () => {
    const live = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");
    for (const d of live) {
      expect(d.endpoint).toBeTruthy();
    }
  });

  it("all NOT_YET_IMPLEMENTED datasets have no endpoint (no accidental wiring)", () => {
    const notYet = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED");
    for (const d of notYet) {
      expect(d.endpoint).toBeUndefined();
    }
  });

  it("no dataset has fake hardcoded statistics in its definition", () => {
    const fakePatterns = [
      /\d{1,3},\d{3}\s+(?:active|entity|record|order|code)/i, // e.g. "14,200 active entity records"
      /All source data validated/i,
      /Manual refresh completed successfully/i,
    ];
    for (const d of DATASET_DEFINITIONS) {
      for (const pattern of fakePatterns) {
        expect(d.refreshMethod).not.toMatch(pattern);
        if (d.lastRunDetails) {
          expect(d.lastRunDetails).not.toMatch(pattern);
        }
      }
    }
  });

  it("all datasets have required fields with no empty strings", () => {
    for (const d of DATASET_DEFINITIONS) {
      expect(d.id).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.powers).toBeTruthy();
      expect(d.source).toBeTruthy();
      expect(d.cost).toBe("Free");
      expect(d.refreshMethod).toBeTruthy();
      expect(d.frequency).toBeTruthy();
      expect(typeof d.scheduledFrequencyHours).toBe("number");
      expect(typeof d.staleThresholdHours).toBe("number");
      expect(d.staleThresholdHours).toBeGreaterThan(d.scheduledFrequencyHours);
    }
  });

  it("retrieves a dataset by ID", () => {
    const hts = getDatasetById("hts-schedule");
    expect(hts).toBeDefined();
    expect(hts?.readinessStatus).toBe("LIVE");
    expect(hts?.endpoint).toBe("/api/cron/hts-refresh");

    const sec301 = getDatasetById("section-301-rates");
    expect(sec301).toBeDefined();
    expect(sec301?.readinessStatus).toBe("NOT_YET_IMPLEMENTED");
    expect(sec301?.endpoint).toBeUndefined();
  });
});

describe("Dataset Registry — triggerDatasetRefresh safety", () => {
  it("returns NOT_IMPLEMENTED error for un-wired datasets without any side effects", async () => {
    const result = await triggerDatasetRefresh("ofac-sdn");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not yet implemented");
    expect(result.logId).toBeUndefined(); // no DB log row written for un-wired datasets
  });

  it("returns NOT_FOUND error for unknown dataset IDs", async () => {
    const result = await triggerDatasetRefresh("nonexistent-dataset-xyz");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("does not mark NOT_YET_IMPLEMENTED datasets as success", async () => {
    const ids = ["bis-csl", "section-301-rates", "usmca-rules-origin", "ad-cvd-company-rates"];
    for (const id of ids) {
      const result = await triggerDatasetRefresh(id);
      expect(result.success).toBe(false);
      // Critically: no fake success status
      expect(result.message).not.toContain("success");
      expect(result.message).not.toContain("validated");
    }
  });
});
