/**
 * Demo seed: compliance deadlines for joe@target.com
 *
 * Creates deadline rows across urgency bands (breached, critical, high, normal)
 * and patches anchor dates on existing shipments so the rules engine has data
 * to work with in future reconciliations.
 *
 * Run: npx tsx prisma/seed-deadlines.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["warn", "error"] });

const NOW = new Date();
const H = 3_600_000; // ms per hour
const D = 24 * H;

function hoursFromNow(h: number) {
  return new Date(NOW.getTime() + h * H);
}

function daysAgo(d: number) {
  return new Date(NOW.getTime() - d * D);
}

function daysFromNow(d: number) {
  return new Date(NOW.getTime() + d * D);
}

async function main() {
  // ── 1. Resolve account ──────────────────────────────────────────────────
  const membership = await db.accountMembership.findFirst({
    where: { user: { email: "joe@target.com" } },
    include: { account: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    throw new Error("No account found for joe@target.com — is the user seeded?");
  }

  const { accountId } = membership;
  console.log(`✅ Account: ${membership.account.name} (${accountId})`);

  // ── 2. Pick up to 4 shipments ────────────────────────────────────────────
  const shipments = await db.shipment.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, shipmentNumber: true, ladingDate: true, arrivalDate: true, transportMode: true },
  });

  if (shipments.length === 0) {
    throw new Error("No shipments found for this account — seed shipments first.");
  }

  console.log(`  Found ${shipments.length} shipments`);

  // ── 3. Patch anchor dates + transport mode on each shipment ──────────────
  const anchors = [
    // shipment 0 — arrived 12 days ago, laded 22 days ago (ocean)
    { ladingDate: daysAgo(22), arrivalDate: daysAgo(12), transportMode: "Ocean" },
    // shipment 1 — arrived 3 days ago (ocean)
    { ladingDate: daysAgo(18), arrivalDate: daysAgo(3), transportMode: "Ocean" },
    // shipment 2 — in transit, ETA tomorrow (ocean, estimated)
    { ladingDate: daysAgo(14), arrivalDate: daysFromNow(1), transportMode: "Ocean" },
    // shipment 3 — air, arrived today
    { ladingDate: daysAgo(2), arrivalDate: daysAgo(0), transportMode: "Air" },
  ];

  for (let i = 0; i < shipments.length; i++) {
    const s = shipments[i];
    const a = anchors[i] ?? anchors[0];
    await db.shipment.update({
      where: { id: s.id },
      data: {
        ladingDate: s.ladingDate ?? a.ladingDate,
        arrivalDate: s.arrivalDate ?? a.arrivalDate,
        transportMode: s.transportMode ?? a.transportMode,
      },
    });
    console.log(`  ✅ Patched anchor dates on ${s.shipmentNumber}`);
  }

  // ── 4. Wipe existing demo deadlines ──────────────────────────────────────
  const shipmentIds = shipments.map((s) => s.id);
  const deleted = await db.complianceDeadline.deleteMany({
    where: { shipmentId: { in: shipmentIds } },
  });
  if (deleted.count > 0) console.log(`  🗑  Cleared ${deleted.count} existing deadline rows`);

  // ── 5. Create deadline rows ───────────────────────────────────────────────
  //
  // Shipment 0: arrived 12 days ago — ISF MISSED, Entry Filing CRITICAL
  // Shipment 1: arrived 3 days ago  — ISF SATISFIED, Entry Filing HIGH, Entry Summary NORMAL
  // Shipment 2: in transit          — ISF due soon (OPEN, estimated), Entry Filing NORMAL
  // Shipment 3: air freight         — no ISF, Entry Filing BREACHED
  //
  const rows: Parameters<typeof db.complianceDeadline.createMany>[0]["data"] = [];

  const [s0, s1, s2, s3] = shipments;

  if (s0) {
    // ISF was due 24h before arrival (12 days ago) → MISSED 11 days ago
    rows.push({
      id: `demo-${s0.id}-isf`,
      accountId,
      shipmentId: s0.id,
      type: "ISF_10_2",
      deadlineClass: "REGULATORY",
      status: "MISSED",
      anchorEvent: "LADING",
      anchorAt: daysAgo(22),
      estimated: false,
      dueAt: daysAgo(13), // 24h before arrival
      ruleId: "ISF_10_2_v1",
      ruleCitation: "19 CFR 149.2(a)",
      penaltyEstimate: 5000,
      penaltyBasis: "CBP penalty up to $5,000 per violation",
      updatedAt: NOW,
    });
    // Entry Filing — due 15 days after arrival → critical (3 days left)
    rows.push({
      id: `demo-${s0.id}-ef`,
      accountId,
      shipmentId: s0.id,
      type: "ENTRY_FILING",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ARRIVAL",
      anchorAt: daysAgo(12),
      estimated: false,
      dueAt: hoursFromNow(18), // ~18h from now → critical band
      ruleId: "ENTRY_FILING_v1",
      ruleCitation: "19 CFR 141.68(a)",
      penaltyEstimate: 1000,
      penaltyBasis: "Liquidated damages per 19 CFR 142.15",
      updatedAt: NOW,
    });
  }

  if (s1) {
    // ISF filed on time → SATISFIED
    rows.push({
      id: `demo-${s1.id}-isf`,
      accountId,
      shipmentId: s1.id,
      type: "ISF_10_2",
      deadlineClass: "REGULATORY",
      status: "SATISFIED",
      anchorEvent: "LADING",
      anchorAt: daysAgo(18),
      estimated: false,
      dueAt: daysAgo(4),
      ruleId: "ISF_10_2_v1",
      ruleCitation: "19 CFR 149.2(a)",
      satisfiedAt: daysAgo(5),
      updatedAt: NOW,
    });
    // Entry Filing — due in ~2.5 days → high band
    rows.push({
      id: `demo-${s1.id}-ef`,
      accountId,
      shipmentId: s1.id,
      type: "ENTRY_FILING",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ARRIVAL",
      anchorAt: daysAgo(3),
      estimated: false,
      dueAt: hoursFromNow(60), // 2.5 days → high
      ruleId: "ENTRY_FILING_v1",
      ruleCitation: "19 CFR 141.68(a)",
      penaltyEstimate: 1000,
      penaltyBasis: "Liquidated damages per 19 CFR 142.15",
      updatedAt: NOW,
    });
    // Entry Summary — due 10 working days after entry → normal band
    rows.push({
      id: `demo-${s1.id}-es`,
      accountId,
      shipmentId: s1.id,
      type: "ENTRY_SUMMARY",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ENTRY",
      anchorAt: daysAgo(1),
      estimated: true, // entry not yet filed, anchor estimated
      dueAt: daysFromNow(13),
      ruleId: "ENTRY_SUMMARY_v1",
      ruleCitation: "19 CFR 142.23(a)",
      penaltyEstimate: 500,
      penaltyBasis: "Liquidated damages",
      updatedAt: NOW,
    });
  }

  if (s2) {
    // ISF — ship still in transit, ETA tomorrow; anchor is estimated lading date
    rows.push({
      id: `demo-${s2.id}-isf`,
      accountId,
      shipmentId: s2.id,
      type: "ISF_10_2",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "LADING",
      anchorAt: daysAgo(14),
      estimated: true,
      dueAt: hoursFromNow(0 - 2), // 2h BREACHED (ISF should have been filed before vessel arrival)
      ruleId: "ISF_10_2_v1",
      ruleCitation: "19 CFR 149.2(a)",
      penaltyEstimate: 5000,
      penaltyBasis: "CBP penalty up to $5,000 per violation",
      updatedAt: NOW,
    });
    // Entry Filing — estimated, ~15 days after ETA
    rows.push({
      id: `demo-${s2.id}-ef`,
      accountId,
      shipmentId: s2.id,
      type: "ENTRY_FILING",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ARRIVAL",
      anchorAt: daysFromNow(1),
      estimated: true,
      dueAt: daysFromNow(16),
      ruleId: "ENTRY_FILING_v1",
      ruleCitation: "19 CFR 141.68(a)",
      penaltyEstimate: 1000,
      penaltyBasis: "Liquidated damages per 19 CFR 142.15",
      updatedAt: NOW,
    });
  }

  if (s3) {
    // Air freight — no ISF required. Entry Filing BREACHED.
    rows.push({
      id: `demo-${s3.id}-ef`,
      accountId,
      shipmentId: s3.id,
      type: "ENTRY_FILING",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ARRIVAL",
      anchorAt: daysAgo(0),
      estimated: false,
      dueAt: hoursFromNow(-4), // 4h past due → BREACHED
      ruleId: "ENTRY_FILING_v1",
      ruleCitation: "19 CFR 141.68(a)",
      penaltyEstimate: 1000,
      penaltyBasis: "Liquidated damages per 19 CFR 142.15",
      updatedAt: NOW,
    });
    // Duty Payment — 10 working days after entry (estimated)
    rows.push({
      id: `demo-${s3.id}-dp`,
      accountId,
      shipmentId: s3.id,
      type: "DUTY_PAYMENT",
      deadlineClass: "REGULATORY",
      status: "OPEN",
      anchorEvent: "ENTRY",
      anchorAt: daysAgo(0),
      estimated: true,
      dueAt: daysFromNow(14),
      ruleId: "DUTY_PAYMENT_v1",
      ruleCitation: "19 CFR 24.1(a)(1)",
      updatedAt: NOW,
    });
  }

  await db.complianceDeadline.createMany({ data: rows });
  console.log(`\n✅ Created ${rows.length} compliance deadline rows across ${shipments.length} shipments`);

  // ── 6. Refresh filingDeadline cache on each shipment ─────────────────────
  for (const s of shipments) {
    const earliest = await db.complianceDeadline.findFirst({
      where: {
        shipmentId: s.id,
        status: "OPEN",
        type: { in: ["ISF_10_2", "ENTRY_FILING"] },
        dueAt: { not: null },
      },
      orderBy: { dueAt: "asc" },
    });
    await db.shipment.update({
      where: { id: s.id },
      data: { filingDeadline: earliest?.dueAt ?? null },
    });
  }
  console.log("  ✅ Refreshed filingDeadline cache on all shipments");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\nDemo deadline summary:");
  if (s0) console.log(`  ${s0.shipmentNumber}  ISF MISSED · Entry Filing CRITICAL (~18h)`);
  if (s1) console.log(`  ${s1.shipmentNumber}  ISF SATISFIED · Entry Filing HIGH (2.5d) · Entry Summary NORMAL (13d, estimated)`);
  if (s2) console.log(`  ${s2.shipmentNumber}  ISF BREACHED (in-transit, estimated) · Entry Filing NORMAL (16d, estimated)`);
  if (s3) console.log(`  ${s3.shipmentNumber}  Entry Filing BREACHED (4h ago) · Duty Payment NORMAL (14d, estimated)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
