import { describe, it, expect } from "vitest";
import {
  DATASET_DEFINITIONS,
  getDatasetById,
  triggerDatasetRefresh,
} from "@/lib/data/datasetRegistry";

describe("Dataset Registry — Real Ingestion Wiring & Compliance Safety", () => {
  it("registers exactly 18 datasets", () => {
    expect(DATASET_DEFINITIONS.length).toBe(18);
  });

  it("contains 11 Public API datasets and 7 Structured Document datasets", () => {
    const publicApis = DATASET_DEFINITIONS.filter((d) => d.category === "Public API");
    const structuredDocs = DATASET_DEFINITIONS.filter((d) => d.category === "Structured Document");
    expect(publicApis.length).toBe(11);
    expect(structuredDocs.length).toBe(7);
  });

  it("has exactly 4 LIVE datasets with genuine REST API fetchers (hts-schedule, federal-register, bis-csl, cbp-cross-rulings) and 14 NOT_YET_IMPLEMENTED", () => {
    const live = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");
    const notYet = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED");
    expect(live.length).toBe(4);
    expect(live.map((d) => d.id).sort()).toEqual(["bis-csl", "cbp-cross-rulings", "federal-register", "hts-schedule"]);
    expect(notYet.length).toBe(14);
  });

  it("all LIVE datasets have a valid cron endpoint configured", () => {
    const live = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "LIVE");
    for (const d of live) {
      expect(d.endpoint).toBeTruthy();
      expect(d.endpoint).toMatch(/^\/api\/cron\//);
    }
  });

  it("all NOT_YET_IMPLEMENTED datasets have no endpoint (no accidental or fake wiring)", () => {
    const notYet = DATASET_DEFINITIONS.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED");
    for (const d of notYet) {
      expect(d.endpoint).toBeUndefined();
    }
  });

  it("no dataset has hardcoded fake statistics or fabricated counts in its definition", () => {
    const fakePatterns = [
      /\d{1,3},\d{3}\s+(?:active|entity|record|order|code)/i,
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

  it("retrieves a dataset by ID and verifies status", () => {
    const hts = getDatasetById("hts-schedule");
    expect(hts).toBeDefined();
    expect(hts?.readinessStatus).toBe("LIVE");
    expect(hts?.endpoint).toBe("/api/cron/hts-refresh");

    const bis = getDatasetById("bis-csl");
    expect(bis).toBeDefined();
    expect(bis?.readinessStatus).toBe("LIVE");
    expect(bis?.endpoint).toBe("/api/cron/bis-csl-ingest");

    const cross = getDatasetById("cbp-cross-rulings");
    expect(cross).toBeDefined();
    expect(cross?.readinessStatus).toBe("LIVE");
    expect(cross?.endpoint).toBe("/api/cron/cbp-cross-rulings-ingest");

    const sec301 = getDatasetById("section-301-rates");
    expect(sec301).toBeDefined();
    expect(sec301?.readinessStatus).toBe("NOT_YET_IMPLEMENTED");
    expect(sec301?.endpoint).toBeUndefined();
  });
});

describe("Dataset Registry — triggerDatasetRefresh safety & zero-fabrication guarantees", () => {
  it("returns NOT_IMPLEMENTED error for un-wired datasets without any side effects", async () => {
    const result = await triggerDatasetRefresh("ofac-sdn");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not yet implemented");
    expect(result.logId).toBeUndefined();
  });

  it("returns NOT_FOUND error for unknown dataset IDs", async () => {
    const result = await triggerDatasetRefresh("nonexistent-dataset-xyz");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("never marks NOT_YET_IMPLEMENTED datasets as success", async () => {
    const ids = ["section-301-rates", "usmca-rules-origin", "ad-cvd-company-rates", "ace-port-codes"];
    for (const id of ids) {
      const result = await triggerDatasetRefresh(id);
      expect(result.success).toBe(false);
      expect(result.message).not.toContain("success");
      expect(result.message).not.toContain("validated");
    }
  });
});
