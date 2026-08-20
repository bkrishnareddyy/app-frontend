/**
 * F15 Phase 0 -- throwaway proof-of-concept runner, not a permanent eval
 * pipeline (that's Phase 1's Inngest-backed runner, see
 * docs/plans/features/F15-evals-ai-quality-intelligence.md Phase 1
 * Capability C). Deliberately outside src/ -- run once via `npx tsx
 * scripts/evals/run-phase0.ts`, read the output, decide whether Phase 1
 * is worth building.
 *
 * Golden set (scripts/evals/phase0-golden-set.json) is synthetic, textbook
 * products chosen because their HTS classification isn't seriously in
 * dispute -- not real shipment data, because the dev database currently has
 * zero human-reviewed AgentDecision rows to draw real ground truth from
 * (see docs/requirements/evals-ai-quality-intelligence.md §0, Open Question 1).
 *
 * This calls the REAL HTS Classification Agent (real Gemini call, real HTS
 * Master Release data, real AgentDecision writes) against a dedicated,
 * clearly-labeled DEMO account -- it does not touch any customer data.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { db, runWithDataMode, runWithAccountId } from "@/lib/db";
import { HTSClassificationAgent } from "@/modules/agents/htsClassificationAgent";
import { scoreHtsMatch } from "@/modules/evals/hierarchicalHtsMatch";
import goldenSet from "./phase0-golden-set.json";

const EVAL_ACCOUNT_SLUG = "evals-phase0-synthetic";
const EVAL_SHIPMENT_NUMBER = "EVAL-PHASE0-001";
const EVAL_USER_CLERK_ID = "eval-script-phase0";
const EVAL_USER_EMAIL = "evals-phase0@qubere.internal";

interface GoldenCase {
  caseKey: string;
  category: string;
  rawDescription: string;
  expectedHtsCode?: string;
  expectRefusal?: boolean;
  notes: string;
}

// Account/shipment lookups here run with an explicit `runWithDataMode(null, ...)`
// bypass. Without it, db.ts's tenant-isolation extension defaults any query
// issued with NO ambient dataMode context to an implicit `dataMode: "PRODUCTION"`
// filter (src/lib/db.ts buildIsolatedQueryArgs, `contextMode ?? "PRODUCTION"`)
// -- which would silently hide this script's own DEMO-mode account/shipment
// from its own findFirst/findUnique lookups and cause a duplicate-create
// crash on every re-run. Discovered by hitting exactly that crash.
async function ensureEvalAccount(): Promise<string> {
  return runWithDataMode(null, async () => {
    const existing = await db.account.findUnique({ where: { slug: EVAL_ACCOUNT_SLUG } });
    if (existing) return existing.id;
    const created = await db.account.create({
      data: {
        name: "Evals Phase 0 (synthetic, not a real customer)",
        slug: EVAL_ACCOUNT_SLUG,
        type: "INDIVIDUAL",
        dataMode: "DEMO",
      },
    });
    return created.id;
  });
}

async function ensureEvalUser(): Promise<string> {
  return runWithDataMode(null, async () => {
    const existing = await db.user.findUnique({ where: { clerkUserId: EVAL_USER_CLERK_ID } });
    if (existing) return existing.id;
    const created = await db.user.create({
      data: { clerkUserId: EVAL_USER_CLERK_ID, email: EVAL_USER_EMAIL, firstName: "Evals", lastName: "Phase0 Script" },
    });
    return created.id;
  });
}

async function ensureEvalShipment(accountId: string): Promise<string> {
  return runWithDataMode(null, () =>
    runWithAccountId(accountId, async () => {
      const existing = await db.shipment.findFirst({
        where: { accountId, shipmentNumber: EVAL_SHIPMENT_NUMBER },
      });
      if (existing) return existing.id;
      const created = await db.shipment.create({
        data: {
          accountId,
          shipmentNumber: EVAL_SHIPMENT_NUMBER,
          importerName: "Evals Phase 0 Synthetic Importer",
          status: "Draft",
        },
      });
      return created.id;
    })
  );
}

async function main() {
  const cases = goldenSet as GoldenCase[];

  const accountId = await ensureEvalAccount();
  const userId = await ensureEvalUser();
  const shipmentId = await ensureEvalShipment(accountId);

  console.log(`Running ${cases.length} Phase 0 cases against the real HTS Classification Agent...`);
  console.log(`Account: ${accountId} (DEMO)  Shipment: ${shipmentId}\n`);

  const output = await runWithDataMode("DEMO", () =>
    runWithAccountId(accountId, () =>
      HTSClassificationAgent.execute({
        accountId,
        userId,
        shipmentId,
        productProfiles: cases.map((c, i) => ({
          lineNumber: i + 1,
          rawDescription: c.rawDescription,
        })),
      })
    )
  );

  if (output.status === "BLOCKED_MISSING_DESCRIPTION") {
    console.error(
      "Agent gated the entire batch as missing descriptions -- this shouldn't happen with a mixed valid/invalid batch. Debug error:",
      output.debugError
    );
    process.exit(1);
  }

  type Row = {
    caseKey: string;
    category: string;
    description: string;
    expected: string;
    actual: string;
    confidence: number;
    level: string;
    score: number;
    passed: boolean;
  };
  const rows: Row[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const classification = output.classifications.find((cl) => cl.lineNumber === i + 1);
    const actualCode = classification?.htsCode ?? null;

    if (c.expectRefusal) {
      const refused = !actualCode || actualCode.trim().toUpperCase() === "UNCLASSIFIABLE";
      rows.push({
        caseKey: c.caseKey,
        category: c.category,
        description: c.rawDescription.slice(0, 50),
        expected: "(refusal expected)",
        actual: actualCode ?? "(no decision)",
        confidence: classification?.confidence ?? 0,
        level: "n/a",
        score: refused ? 1 : 0,
        passed: refused,
      });
      continue;
    }

    if (!c.expectedHtsCode) {
      throw new Error(`Case "${c.caseKey}" has neither expectedHtsCode nor expectRefusal -- fix the golden set.`);
    }

    const match = scoreHtsMatch(c.expectedHtsCode, actualCode);
    rows.push({
      caseKey: c.caseKey,
      category: c.category,
      description: c.rawDescription.slice(0, 50),
      expected: c.expectedHtsCode,
      actual: actualCode ?? "(no decision)",
      confidence: classification?.confidence ?? 0,
      level: `${match.matchedLevel}/${match.targetLevel}`,
      score: match.score,
      passed: match.passed,
    });
  }

  console.table(
    rows.map((r) => ({
      case: r.caseKey,
      category: r.category,
      expected: r.expected,
      actual: r.actual,
      conf: r.confidence,
      level: r.level,
      score: r.score,
      pass: r.passed ? "PASS" : "FAIL",
    }))
  );

  const avgScore = rows.reduce((sum, r) => sum + r.score, 0) / rows.length;
  const passCount = rows.filter((r) => r.passed).length;
  console.log(`\nAggregate: ${passCount}/${rows.length} passed, avg score ${(avgScore * 100).toFixed(1)}%`);
  console.log(`Reasoning chain (from the agent):\n${output.reasoningChain}\n`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
