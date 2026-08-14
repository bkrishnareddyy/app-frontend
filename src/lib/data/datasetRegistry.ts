import { db } from "@/lib/db";

// ─── Canonical dataset definitions ────────────────────────────────────────────
// readinessStatus distinguishes datasets with real ingestion wiring ("LIVE")
// from those that are planned but not yet implemented ("NOT_YET_IMPLEMENTED").
// "Run Now" is ONLY available for LIVE datasets. NOT_YET_IMPLEMENTED datasets
// show their roadmap status and never fake a success response.
export type ReadinessStatus = "LIVE" | "NOT_YET_IMPLEMENTED";

export interface DatasetDefinition {
  id: string;
  name: string;
  powers: string;
  source: string;
  sourceUrl: string;
  cost: string;
  refreshMethod: string;
  frequency: string;
  scheduledFrequencyHours: number; // used by dispatcher to determine if due
  staleThresholdHours: number; // staleness alert fires after this many hours without success
  category: "Public API" | "Structured Document";
  engineeringEffort: "Low" | "Medium" | "High" | "Very High";
  readinessStatus: ReadinessStatus;
  endpoint?: string; // only set for LIVE datasets with a real route
  // true only for datasets that schedule their own recurring runs via an
  // Inngest-native cron trigger (heavy/long-running ingestion that can't
  // run synchronously inside this dataset's `endpoint`). The dispatcher
  // must never auto-trigger these itself -- `endpoint` exists on them only
  // so admins can enqueue a manual "Run Now", which the endpoint fulfills
  // by sending an Inngest event rather than doing the work inline.
  selfScheduled?: boolean;
  // Runtime state loaded from DatasetRefreshLog — not hardcoded
  lastRun?: string | null;
  lastRunStatus?: "success" | "error" | "running" | null;
  lastRunDetails?: string | null;
}

export const DATASET_DEFINITIONS: DatasetDefinition[] = [
  // ─── Group A: Free — Public Government Sources (Machine-Readable APIs) ──────

  {
    id: "hts-schedule",
    name: "HTSUS Schedule (Full Tariff Schedule)",
    powers: "HTS classification, duty rates, tariff scenarios, landed cost calculation engine",
    source: "usitc.gov (USITC REST API)",
    sourceUrl: "https://hts.usitc.gov/reststop/exportList",
    cost: "Free",
    refreshMethod:
      "Automated JSON REST API fetcher (HtsUsitcFetcher). Node hash delta detection. Staged into HtsRelease (DRAFT) for admin review before publishing to production.",
    frequency: "Daily (02:00 UTC)",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 36,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "LIVE",
    endpoint: "/api/cron/hts-refresh",
  },
  {
    id: "federal-register",
    name: "Federal Register (CBP Notices)",
    powers: "Regulatory monitoring, AD/CVD alerts, tariff changes, retroactive exclusion triggers",
    source: "federalregister.gov/api",
    sourceUrl:
      "https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=u-s-customs-and-border-protection",
    cost: "Free",
    refreshMethod:
      "REST API document fetch + Gemini structured extraction (extractionSchema). Auto-creates RefundOpportunity records on exclusion notices.",
    frequency: "Daily (08:00 UTC)",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 36,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "LIVE",
    endpoint: "/api/cron/regulatory-ingest",
  },

  {
    id: "ofac-sdn",
    name: "OFAC SDN + Consolidated Non-SDN",
    powers: "Specially Designated Nationals (SDN) screening, sanctions enforcement, blocking checks",
    source: "ofac.treasury.gov (Streaming XML: sdn.xml + consolidated.xml)",
    sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml",
    cost: "Free",
    refreshMethod:
      "Streaming SAX (saxes) XML parser (OfacSdnIngestionService) reads Treasury's sdn.xml and consolidated.xml directly, extracting name, AKAs, addresses, and program codes per entry. Circuit breaker: parsed count must match the feed's own Record_Count header or nothing is written. Delisted entities are marked SUPERSEDED rather than deleted, preserving point-in-time screening history. Runs as a durable Inngest background function (own native cron trigger) to avoid Vercel function timeout on the ~29MB SDN file.",
    frequency: "Daily (05:00 UTC)",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 36,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "LIVE",
    endpoint: "/api/cron/ofac-sdn-ingest",
    selfScheduled: true,
  },

  // ─── NOT_YET_IMPLEMENTED — ingestion pipelines planned, not yet wired ────────
  // Do NOT add fake details, entity counts, or success indicators below.

  {
    id: "cbp-cross-rulings",
    name: "CBP CROSS Rulings",
    powers: "Ruling retrieval, classification evidence matching, AI legal precedent analysis",
    source: "rulings.cbp.gov/api (REST API, 1,000 req/day)",
    sourceUrl: "https://rulings.cbp.gov/api/search",
    cost: "Free",
    refreshMethod:
      "Incremental date-window REST API query extracting ruling number, HTS code, subject text, and ruling body. Indexed into pgvector for semantic similarity retrieval.",
    frequency: "Daily",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 48,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "LIVE",
    endpoint: "/api/cron/cbp-cross-rulings-ingest",
  },
  {
    id: "bis-csl",
    name: "BIS Consolidated Screening List (CSL)",
    powers: "Denied party screening, restricted entity checks, sanctions compliance",
    source: "api.trade.gov (Combines 10 lists: SDN, DPL, Entity List, UVL, ISN, SSI, FSE, PLC, NS-MBS)",
    sourceUrl: "https://api.trade.gov/v1/consolidated_screening_list/search",
    cost: "Free",
    refreshMethod:
      "REST API fetcher normalizing 10 agency lists into ScreeningEntity schema. Atomic table swap with soft-deletes. DRAFT → admin review → PUBLISHED versioning for point-in-time audit defensibility.",
    frequency: "Daily (04:00 UTC)",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 36,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "LIVE",
    endpoint: "/api/cron/bis-csl-ingest",
  },
  {
    id: "usitc-trade-remedy",
    name: "USITC Trade Remedy Database (AD/CVD Orders)",
    powers: "AD/CVD scope screening, duty stack calculations",
    source: "usitc.gov/trade_remedy (HTML/CSV)",
    sourceUrl: "https://usitc.gov/trade_remedy",
    cost: "Free",
    refreshMethod:
      "Automated DOM scraper (Cheerio) and CSV stream parser. Lands in AdcvdOrder table. LLM-extracted rows staged as PENDING pending admin review before affecting duty stack.",
    frequency: "Weekly",
    scheduledFrequencyHours: 168,
    staleThresholdHours: 216,
    category: "Public API",
    engineeringEffort: "Medium",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "ace-port-codes",
    name: "ACE Port Codes",
    powers: "Pre-filing entry validation (valid port codes for ISF 10+2 and CBP Form 7501)",
    source: "CBP ACE Portal (Quarterly CSV)",
    sourceUrl: "https://www.cbp.gov/document/guidance/ace-port-codes",
    cost: "Free",
    refreshMethod:
      "Automated CSV downloader mapping 4-digit port codes, port names, transport modes, and field offices into AcePortCode reference table.",
    frequency: "Quarterly",
    scheduledFrequencyHours: 2160,
    staleThresholdHours: 2400,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "cbp-import-statistics",
    name: "CBP Import Trade Trend Statistics",
    powers: "Audit population analytics benchmarks, macro volume profiling for risk scoring",
    source: "cbp.gov/trade/trade-community/import-statistics (Monthly XLSX)",
    sourceUrl: "https://www.cbp.gov/trade/trade-community/import-statistics",
    cost: "Free",
    refreshMethod:
      "Monthly XLSX report stream parser extracting entry counts, customs values, and duty totals into CbpImportTrend time-series table.",
    frequency: "Monthly",
    scheduledFrequencyHours: 720,
    staleThresholdHours: 800,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "usitc-dataweb",
    name: "USITC DataWeb (Import Statistics)",
    powers: "Duty opportunity benchmarking, landed cost optimization",
    source: "dataweb.usitc.gov (REST API)",
    sourceUrl: "https://dataweb.usitc.gov/api/v1/imports",
    cost: "Free",
    refreshMethod:
      "REST API query transformer mapping HTS 10-digit code, country of origin, customs value, and calculated duties paid into WtoTariffRate/benchmark table.",
    frequency: "Monthly",
    scheduledFrequencyHours: 720,
    staleThresholdHours: 800,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "wto-tariff-facility",
    name: "WTO Tariff Download Facility",
    powers: "Tariff scenario modeling (non-US sourcing alternatives, global trade agreement comparison)",
    source: "tariffdata.wto.org (Bulk CSV / API)",
    sourceUrl: "https://tariffdata.wto.org",
    cost: "Free",
    refreshMethod:
      "Bulk CSV converter mapping 6-digit HS subheadings, MFN bound/applied rates, and preferential rates for 160+ WTO members into WtoTariffRate table.",
    frequency: "Semi-Annually",
    scheduledFrequencyHours: 4380,
    staleThresholdHours: 5000,
    category: "Public API",
    engineeringEffort: "Medium",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "census-schedule-b",
    name: "Census Schedule B (Export Codes)",
    powers: "Export document intake, AES filing validation, duty drawback matching",
    source: "census.gov/foreign-trade/scheduleB (Annual text/CSV)",
    sourceUrl: "https://www.census.gov/foreign-trade/scheduleB",
    cost: "Free",
    refreshMethod:
      "Fixed-width text parser extracting 10-digit Schedule B numbers, descriptions, quantity units, and HTS concordance map into ScheduleBCode table.",
    frequency: "Annually (Jan + mid-year)",
    scheduledFrequencyHours: 8760,
    staleThresholdHours: 9500,
    category: "Public API",
    engineeringEffort: "Low",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },

  // ─── Group B: Free Public Documents — Custom Parsing Required ────────────────

  {
    id: "section-301-rates",
    name: "Section 301 Tariff Rates (Lists 1, 2, 3, 4A, 4B)",
    powers: "Duty stack (section301 layer), duty opportunity detection",
    source: "USTR Federal Register Annexes (PDF/HTML)",
    sourceUrl: "https://ustr.gov/issue-areas/enforcement/section-301-investigations",
    cost: "Free",
    refreshMethod:
      "PDF table extractor (Gemini OCR) parsing ~7,500 8/10-digit HTS codes mapped to Lists 1-4B and duty rates. Runs as Inngest background function. LLM-extracted rows staged as PENDING for admin review before affecting duty stack.",
    frequency: "Notice-Based / Weekly verification",
    scheduledFrequencyHours: 168,
    staleThresholdHours: 240,
    category: "Structured Document",
    engineeringEffort: "High",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "section-301-exclusions",
    name: "Section 301 Exclusions (Granted & Expired)",
    powers: "Duty opportunity detection, refund readiness, retroactive claim identification",
    source: "USTR + Federal Register Notices",
    sourceUrl: "https://ustr.gov/issue-areas/enforcement/section-301-investigations/section-301-exclusions",
    cost: "Free",
    refreshMethod:
      "Gemini LLM structured text parser extracting HTS codes, product description regex rules, and validity windows. Staged as PENDING for admin review. Auto-flags RefundOpportunity on approval.",
    frequency: "Real-Time / Daily",
    scheduledFrequencyHours: 24,
    staleThresholdHours: 48,
    category: "Structured Document",
    engineeringEffort: "High",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "section-232-rates",
    name: "Section 232 (Steel/Aluminum) Rates & Exclusions",
    powers: "Duty stack (section232 layer), steel/aluminum tariff compliance",
    source: "Department of Commerce BIS & Federal Register Notices",
    sourceUrl: "https://www.bis.doc.gov/index.php/232-auto",
    cost: "Free",
    refreshMethod:
      "HTML/CSV parser mapping 10-digit Steel (25%) and Aluminum (10%) HTS codes, country TRQs, and General Approved Exclusions into Section232Rate table.",
    frequency: "Weekly",
    scheduledFrequencyHours: 168,
    staleThresholdHours: 240,
    category: "Structured Document",
    engineeringEffort: "Medium",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "usmca-rules-origin",
    name: "USMCA Rules of Origin (Annex 4-B Tariff Shift Rules)",
    powers: "Trade agreement qualification engine (USMCA preference determination)",
    source: "USTR Published Agreement Text",
    sourceUrl: "https://ustr.gov/trade-agreements/free-trade-agreements/united-states-mexico-canada-agreement",
    cost: "Free",
    refreshMethod:
      "Complex text/regex parser extracting ~2,000 Product-Specific Rules (CC, CTH, CTSH, RVC %) into TradeAgreementRule table powering qualify/route.ts.",
    frequency: "Static Baseline / Annual Review",
    scheduledFrequencyHours: 8760,
    staleThresholdHours: 10000,
    category: "Structured Document",
    engineeringEffort: "Very High",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "cafta-dr-rules-origin",
    name: "CAFTA-DR Rules of Origin",
    powers: "Central America FTA qualification engine, duty-free preference validation",
    source: "USTR Agreement Text (Annex 4.1)",
    sourceUrl:
      "https://ustr.gov/trade-agreements/free-trade-agreements/cafta-dr-dominican-republic-central-america-fta",
    cost: "Free",
    refreshMethod:
      "Structured text parser converting tariff shift rules and RVC rules into decision trees stored in TradeAgreementRule table.",
    frequency: "Static Baseline / Annual Review",
    scheduledFrequencyHours: 8760,
    staleThresholdHours: 10000,
    category: "Structured Document",
    engineeringEffort: "High",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "ad-cvd-company-rates",
    name: "AD/CVD Company-Specific Rates",
    powers: "Duty stack calculation (adcvd layer, manufacturer-specific matching)",
    source: "Commerce ITAD Federal Register Annual Review Notices",
    sourceUrl: "https://access.trade.gov",
    cost: "Free",
    refreshMethod:
      "Gemini LLM tabular parser extracting Case Number, Manufacturer Name, Individual Rate %, and Period of Review. LLM-extracted rows staged as PENDING for admin review before flowing into duty calculations.",
    frequency: "Notice-Based / Weekly",
    scheduledFrequencyHours: 168,
    staleThresholdHours: 240,
    category: "Structured Document",
    engineeringEffort: "Very High",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },
  {
    id: "pga-requirements",
    name: "PGA Requirements by HTS",
    powers: "PGA screening, pre-filing document completeness checks (FDA, EPA, DOT, USDA, TTB)",
    source: "CBP ACE Reference Files (CATAIR Appendix PGA)",
    sourceUrl: "https://www.cbp.gov/trade/automated/catair",
    cost: "Free",
    refreshMethod:
      "Fixed-width text parser mapping 10-digit HTS codes to PGA agency flags and required form codes. Lands in reference table powering filingValidator.ts pre-checks.",
    frequency: "Quarterly",
    scheduledFrequencyHours: 2160,
    staleThresholdHours: 2400,
    category: "Structured Document",
    engineeringEffort: "Medium",
    readinessStatus: "NOT_YET_IMPLEMENTED",
  },

];

// ─── Runtime state from DB ────────────────────────────────────────────────────

export interface DatasetWithStatus extends DatasetDefinition {
  lastRun: string | null;
  lastRunStatus: "success" | "error" | "running" | null;
  lastRunDetails: string | null;
}

/**
 * Returns all dataset definitions merged with real last-run state from the
 * DatasetRefreshLog table. No hardcoded status strings.
 *
 * Gracefully degrades: if the DB query fails (e.g. table not yet migrated on
 * production), returns all static definitions with null last-run state so the
 * panel renders with dataset info rather than crashing with a 500.
 */
export async function getAllDatasetsWithStatus(): Promise<DatasetWithStatus[]> {
  let logByDatasetId = new Map<string, { completedAt: Date | null; status: string; errorMessage: string | null; summary: string | null }>();

  try {
    const logs = await db.datasetRefreshLog.findMany({
      where: {
        datasetId: { in: DATASET_DEFINITIONS.map((d) => d.id) },
      },
      orderBy: { startedAt: "desc" },
      distinct: ["datasetId"],
    });
    logByDatasetId = new Map(logs.map((l) => [l.datasetId, l]));
  } catch (err: any) {
    // Log but do not throw — the static registry is still useful even without
    // last-run history. This prevents a missing/not-yet-migrated
    // DatasetRefreshLog table from causing a 500 on the datasets endpoint.
    console.error(
      "[datasetRegistry] Failed to query DatasetRefreshLog — returning static definitions without last-run state.",
      err?.code ?? err?.message ?? err
    );
  }

  return DATASET_DEFINITIONS.map((def) => {
    const log = logByDatasetId.get(def.id);
    return {
      ...def,
      lastRun: log?.completedAt?.toISOString() ?? null,
      lastRunStatus: log
        ? log.status === "SUCCESS"
          ? "success"
          : log.status === "RUNNING"
          ? "running"
          : "error"
        : null,
      lastRunDetails: log?.errorMessage ?? log?.summary ?? null,
    };
  });
}

export function getDatasetById(id: string): DatasetDefinition | undefined {
  return DATASET_DEFINITIONS.find((d) => d.id === id);
}

/**
 * Triggers a real ingestion run for a LIVE dataset by calling its endpoint.
 * Writes a DatasetRefreshLog row for audit/staleness tracking.
 * Returns an error for NOT_YET_IMPLEMENTED datasets — never fakes success.
 */
export async function triggerDatasetRefresh(id: string): Promise<{
  success: boolean;
  message: string;
  logId?: string;
}> {
  const def = getDatasetById(id);
  if (!def) {
    return { success: false, message: `Dataset "${id}" not found in registry.` };
  }

  if (def.readinessStatus === "NOT_YET_IMPLEMENTED") {
    return {
      success: false,
      message: `Dataset "${def.name}" ingestion pipeline is not yet implemented. No data was fetched or written.`,
    };
  }

  if (!def.endpoint) {
    return {
      success: false,
      message: `Dataset "${def.name}" has no configured ingestion endpoint.`,
    };
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return {
      success: false,
      message: "CRON_SECRET is not configured on the server; ingestion endpoints cannot be triggered.",
    };
  }

  const alreadyRunning = await db.datasetRefreshLog.findFirst({
    where: { datasetId: id, status: "RUNNING" },
  });
  if (alreadyRunning) {
    return {
      success: false,
      message: `Dataset "${def.name}" already has a run in progress (started ${alreadyRunning.startedAt.toISOString()}).`,
    };
  }

  // Self-scheduled datasets (e.g. ofac-sdn) run as durable Inngest
  // background functions that own their own DatasetRefreshLog lifecycle.
  // Their endpoint only enqueues the job and returns immediately, so this
  // function must not create/close a RUNNING row around that call — doing
  // so would mark the row SUCCESS the instant the enqueue HTTP call
  // returns, long before the actual ingestion (which can take minutes)
  // has even started.
  if (def.selfScheduled) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const fullUrl = def.endpoint!.startsWith("http") ? def.endpoint! : `${baseUrl}${def.endpoint}`;
      const res = await fetch(fullUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${cronSecret}` },
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = responseData.note || responseData.error || `Endpoint returned HTTP ${res.status}`;
        return { success: false, message: errorMsg };
      }
      return { success: true, message: responseData.note || "Ingestion enqueued." };
    } catch (err: any) {
      return { success: false, message: err.message || "Failed to enqueue dataset refresh" };
    }
  }

  // Create a RUNNING log row
  const log = await db.datasetRefreshLog.create({
    data: {
      datasetId: id,
      datasetName: def.name,
      triggeredBy: "MANUAL",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const fullUrl = def.endpoint.startsWith("http") ? def.endpoint : `${baseUrl}${def.endpoint}`;

    const res = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${cronSecret}`,
      },
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMsg = errorData.error || errorData.reason || `Endpoint returned HTTP ${res.status}`;
      await db.datasetRefreshLog.update({
        where: { id: log.id },
        data: { status: "FAILED", errorMessage: errorMsg, completedAt: new Date() },
      });
      return { success: false, message: errorMsg, logId: log.id };
    }

    const responseData = await res.json().catch(() => ({}));
    const summary = responseData.note || responseData.message || `Execution completed via ${def.endpoint}`;

    await db.datasetRefreshLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", summary, completedAt: new Date() },
    });

    return { success: true, message: summary, logId: log.id };
  } catch (err: any) {
    const errorMsg = err.message || "Unexpected error during dataset refresh";
    await db.datasetRefreshLog.update({
      where: { id: log.id },
      data: { status: "FAILED", errorMessage: errorMsg, completedAt: new Date() },
    });
    return { success: false, message: errorMsg, logId: log.id };
  }
}
