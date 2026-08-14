import { db } from "../db";
import { Decimal } from "../tariff/decimal";

export interface AnalyticsMetrics {
  cyclTimeMedianHours: number;
  firstPassRate: number;
  exceptionAgeAvgHours: number;
  exceptionAgeBuckets: {
    under24h: number;
    days1to7: number;
    days7to30: number;
    over30d: number;
  };
  touchRate: number;
  dutyPerEntry: number;
  openExceptions: number;
  filedEntries: number;
  pscCount: number;
}

/**
 * Operations metrics computer from real database records.
 * When clientId is supplied only shipments/filings belonging to that client are counted.
 */
export async function computeAnalyticsMetrics(
  accountId: string,
  clientId?: string
): Promise<AnalyticsMetrics> {
  const shipmentFilter = { accountId, ...(clientId ? { clientId } : {}) };
  const filingFilter = {
    accountId,
    ...(clientId ? { shipment: { clientId } } : {}),
  };

  // 1. Cycle Time Median
  const terminalStatuses = ["Transmitted", "Accepted", "Released", "Closed"];
  const terminalFilings = await db.customsFiling.findMany({
    where: { ...filingFilter, filingStatus: { in: terminalStatuses } },
    include: { shipment: true },
  });

  const cycleTimes = terminalFilings.map((f) => {
    const start = new Date(f.shipment.createdAt).getTime();
    const end = new Date(f.updatedAt).getTime();
    return Math.max(0, (end - start) / (1000 * 60 * 60));
  });

  let cyclTimeMedianHours = 0;
  if (cycleTimes.length > 0) {
    cycleTimes.sort((a, b) => a - b);
    const mid = Math.floor(cycleTimes.length / 2);
    cyclTimeMedianHours =
      cycleTimes.length % 2 !== 0 ? cycleTimes[mid] : (cycleTimes[mid - 1] + cycleTimes[mid]) / 2;
  }

  // 2. First Pass Rate
  const submittedFilings = await db.customsFiling.findMany({
    where: { ...filingFilter, submittedAt: { not: null } },
    include: { responses: true },
  });

  const totalSubmitted = submittedFilings.length;
  const acceptedFirstPass = submittedFilings.filter(
    (f) => !f.responses.some((r) => r.status === "REJECTED" || r.status === "Rejected")
  ).length;

  const firstPassRate =
    totalSubmitted > 0 ? Math.round((acceptedFirstPass / totalSubmitted) * 100) : 100;

  // 3. Exception Age Average & Buckets
  const openExceptionsList = await db.exceptionItem.findMany({
    where: {
      accountId,
      ...(clientId ? { shipment: { clientId } } : {}),
      status: { notIn: ["Resolved", "RESOLVED"] },
    },
  });

  const now = Date.now();
  const exceptionAges = openExceptionsList.map((e) =>
    Math.max(0, (now - new Date(e.createdAt).getTime()) / (1000 * 60 * 60))
  );

  const exceptionAgeAvgHours =
    exceptionAges.length > 0
      ? Math.round(
          (exceptionAges.reduce((sum, age) => sum + age, 0) / exceptionAges.length) * 10
        ) / 10
      : 0;

  const exceptionAgeBuckets = {
    under24h: 0,
    days1to7: 0,
    days7to30: 0,
    over30d: 0,
  };

  for (const ageHours of exceptionAges) {
    if (ageHours < 24) {
      exceptionAgeBuckets.under24h++;
    } else if (ageHours < 24 * 7) {
      exceptionAgeBuckets.days1to7++;
    } else if (ageHours < 24 * 30) {
      exceptionAgeBuckets.days7to30++;
    } else {
      exceptionAgeBuckets.over30d++;
    }
  }

  // 4. Touch Rate (account-wide; per-client breakdown not meaningful here)
  const fields = await db.extractionField.findMany({
    where: { document: { shipmentId: { not: null } } },
  });
  const totalFields = fields.length;
  const humanCorrected = fields.filter((f) => f.source === "HUMAN_CORRECTION").length;
  const touchRate = totalFields > 0 ? Math.round((humanCorrected / totalFields) * 100) : 0;

  // 5. Duty Per Entry
  const terminalFilingsWithValue = await db.customsFiling.findMany({
    where: { ...filingFilter, filingStatus: { in: terminalStatuses }, totalDuties: { not: null } },
  });

  const totalDutiesSum = terminalFilingsWithValue.reduce(
    (sum, f) => sum.plus(new Decimal(f.totalDuties || 0)),
    new Decimal(0)
  );
  const dutyPerEntry =
    terminalFilingsWithValue.length > 0
      ? totalDutiesSum.dividedBy(terminalFilingsWithValue.length).toNumber()
      : 0;

  // 6. Counts
  const openExceptions = openExceptionsList.length;
  const filedEntries = terminalFilings.length;
  const pscCount = await db.postSummaryCorrection.count({ where: { accountId } });

  return {
    cyclTimeMedianHours: Math.round(cyclTimeMedianHours * 10) / 10,
    firstPassRate,
    exceptionAgeAvgHours,
    exceptionAgeBuckets,
    touchRate,
    dutyPerEntry: Math.round(dutyPerEntry * 100) / 100,
    openExceptions,
    filedEntries,
    pscCount,
  };
}
