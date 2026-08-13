/**
 * Backfill AgentDecision.triageState from the legacy status string.
 *
 * Run after the 20260812060000 migration lands, once, on each environment:
 *   npx tsx scripts/backfill-triage-state.ts
 *
 * Safe to re-run: rows that already have triageState are skipped.
 * Rows whose status does not map to a known state are left with triageState=null
 * and logged so they can be investigated; triageDecision() in decisionState.ts
 * handles the null fallback for the queue until the row is fixed.
 */
import { db } from "../src/lib/db";
import { normalizeDecisionStatus } from "../src/modules/decisions/decisionState";

const BATCH_SIZE = 500;

async function run() {
  let offset = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalUnknown = 0;

  console.log("Backfilling AgentDecision.triageState …");

  while (true) {
    const rows = await db.agentDecision.findMany({
      where: { triageState: null },
      select: { id: true, status: true },
      take: BATCH_SIZE,
      skip: offset,
      orderBy: { createdAt: "asc" },
    });

    if (rows.length === 0) break;

    const updates: Array<Promise<unknown>> = [];
    const unknownRows: Array<{ id: string; status: string }> = [];

    for (const row of rows) {
      const normalized = normalizeDecisionStatus(row.status);
      if (normalized === null) {
        unknownRows.push({ id: row.id, status: row.status });
        totalUnknown++;
        continue;
      }
      updates.push(
        db.agentDecision.update({
          where: { id: row.id },
          data: { triageState: normalized },
        })
      );
      totalUpdated++;
    }

    await Promise.all(updates);

    if (unknownRows.length > 0) {
      console.warn(`  Unknown status strings (left null):`, unknownRows);
    }

    totalSkipped += rows.length - updates.length - unknownRows.length;
    offset += rows.length;
    console.log(`  processed ${offset} rows so far …`);
  }

  console.log(`Done. updated=${totalUpdated}, unknown=${totalUnknown}, skipped=${totalSkipped}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
