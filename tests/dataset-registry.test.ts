import { describe, it, expect } from "vitest";
import {
  DATASET_DEFINITIONS,
  getDatasetById,
} from "@/lib/data/datasetRegistry";

describe("Dataset Registry — Integrity & Wiring", () => {
  it("registers exactly 18 datasets", () => {
    expect(DATASET_DEFINITIONS.length).toBe(18);
  });

  it("contains 11 Public API datasets and 7 Structured Document datasets", () => {
    const publicApis = DATASET_DEFINITIONS.filter((d) => d.category === "Public API");
    const structuredDocs = DATASET_DEFINITIONS.filter((d) => d.category === "Structured Document");
    expect(publicApis.length).toBe(11);
    expect(structuredDocs.length).toBe(7);
  });

  it("all 18 datasets are LIVE with real ingestion endpoints", () => {
    const live = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");
    expect(live.length).toBe(18);
    for (const d of live) {
      expect(d.endpoint).toBeTruthy();
      expect(d.endpoint).toMatch(/^\/api\/cron\//);
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

  it("retrieves a dataset by ID and verifies live status", () => {
    const hts = getDatasetById("hts-schedule");
    expect(hts).toBeDefined();
    expect(hts?.readinessStatus).toBe("LIVE");
    expect(hts?.endpoint).toBe("/api/cron/hts-refresh");

    const sec301 = getDatasetById("section-301-rates");
    expect(sec301).toBeDefined();
    expect(sec301?.readinessStatus).toBe("LIVE");
    expect(sec301?.endpoint).toBe("/api/cron/section-301-rates-ingest");

    const bis = getDatasetById("bis-csl");
    expect(bis).toBeDefined();
    expect(bis?.readinessStatus).toBe("LIVE");
    expect(bis?.endpoint).toBe("/api/cron/bis-csl-ingest");
  });
});
