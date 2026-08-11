/**
 * Detects duplicate AgentDecision batches caused by a pipeline run getting
 * retried from scratch instead of resumed/cleaned up.
 *
 * Detection: within a shipment, each "Document Intake Agent" decision marks
 * the start of a new pipeline execution ("run"). A run that never produced a
 * "Response Agent" decision never finished. If a shipment has an unfinished
 * run immediately followed by another run, the unfinished one is orphaned --
 * it's leftover from an attempt that got abandoned and silently retried,
 * not a shipment that's just still processing (which would have no
 * following run at all).
 *
 * Safety: a run is only ever flagged if none of its decisions were touched
 * by a human (reviewedByUserId set) or carry humanNotes -- if a person
 * reviewed something in it, this script leaves it alone regardless of
 * whether the run completed.
 *
 * DRY RUN BY DEFAULT. Prints exactly what it would delete and why.
 * Re-run with `--apply` only after reviewing the report.
 */
import { db } from "../src/lib/db";

const PIPELINE_ORDER = [
  "Document Intake Agent",
  "Document Intelligence Agent",
  "Product Intelligence Agent",
  "HTS Classification Agent",
  "Origin Agent",
  "Valuation Agent",
  "Compliance Agent",
  "Filing Readiness Agent",
  "Customs Filing Agent",
  "Response Agent",
] as const;

const RUN_START_AGENT = "Document Intake Agent";
const RUN_COMPLETE_AGENT = "Response Agent";

interface DecisionRow {
  id: string;
  shipmentId: string;
  agentName: string;
  status: string;
  createdAt: Date;
  reviewedByUserId: string | null;
  humanNotes: string | null;
}

interface Run {
  decisions: DecisionRow[];
  startedAt: Date;
  endedAt: Date;
  complete: boolean;
  humanTouched: boolean;
}

function splitIntoRuns(decisions: DecisionRow[]): Run[] {
  const sorted = [...decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const runs: Run[] = [];
  let current: DecisionRow[] = [];

  const flush = () => {
    if (current.length === 0) return;
    runs.push({
      decisions: current,
      startedAt: current[0].createdAt,
      endedAt: current[current.length - 1].createdAt,
      complete: current.some((d) => d.agentName === RUN_COMPLETE_AGENT),
      humanTouched: current.some((d) => d.reviewedByUserId || (d.humanNotes && d.humanNotes.trim() !== "")),
    });
    current = [];
  };

  for (const dec of sorted) {
    if (dec.agentName === RUN_START_AGENT && current.length > 0) {
      flush();
    }
    current.push(dec);
  }
  flush();

  return runs;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const decisions = await db.agentDecision.findMany({
    where: { agentName: { in: [...PIPELINE_ORDER] } },
    select: {
      id: true,
      shipmentId: true,
      agentName: true,
      status: true,
      createdAt: true,
      reviewedByUserId: true,
      humanNotes: true,
    },
  });

  const byShipment = new Map<string, DecisionRow[]>();
  for (const d of decisions) {
    if (!byShipment.has(d.shipmentId)) byShipment.set(d.shipmentId, []);
    byShipment.get(d.shipmentId)!.push(d);
  }

  const shipmentIds = [...byShipment.keys()];
  const shipments = await db.shipment.findMany({
    where: { id: { in: shipmentIds } },
    select: { id: true, shipmentNumber: true },
  });
  const shipmentNumberById = new Map(shipments.map((s) => [s.id, s.shipmentNumber]));

  let totalOrphanedDecisions = 0;
  let shipmentsAffected = 0;
  const toDelete: string[] = [];

  for (const [shipmentId, shipmentDecisions] of byShipment) {
    const runs = splitIntoRuns(shipmentDecisions);
    if (runs.length < 2) continue;

    const orphanedRuns = runs.filter((run, idx) => {
      const hasFollowingRun = idx < runs.length - 1;
      return !run.complete && hasFollowingRun && !run.humanTouched;
    });

    if (orphanedRuns.length === 0) continue;

    shipmentsAffected++;
    const shipmentNumber = shipmentNumberById.get(shipmentId) || shipmentId;
    console.log(`\nShipment ${shipmentNumber} (${shipmentId}): ${runs.length} runs, ${orphanedRuns.length} orphaned`);

    for (const run of orphanedRuns) {
      const agentNames = run.decisions.map((d) => d.agentName.replace(/\s*Agent$/, "")).join(" → ");
      console.log(
        `  ORPHANED run ${run.startedAt.toISOString()} - ${run.endedAt.toISOString()} (${run.decisions.length} decisions, never reached Response): ${agentNames}`
      );
      for (const dec of run.decisions) {
        console.log(`    - ${dec.id}  ${dec.agentName}  ${dec.status}`);
        toDelete.push(dec.id);
        totalOrphanedDecisions++;
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`${shipmentsAffected} shipments affected, ${totalOrphanedDecisions} orphaned decisions found.`);

  if (!apply) {
    console.log(`\nDRY RUN -- nothing deleted. Re-run with --apply to delete the ${totalOrphanedDecisions} decisions listed above.`);
    return;
  }

  if (totalOrphanedDecisions === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await db.agentDecision.deleteMany({ where: { id: { in: toDelete } } });
  console.log(`Deleted ${result.count} orphaned decisions.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
