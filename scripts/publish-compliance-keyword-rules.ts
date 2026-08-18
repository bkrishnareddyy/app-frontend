/**
 * Promotes DRAFT ComplianceKeywordRule rows to PUBLISHED for a given set of
 * categories, via the real review gate (keywordRuleReviewService.reviewKeywordRule)
 * rather than a raw update -- so the promotion leaves the same audit trail
 * (COMPLIANCE_KEYWORD_RULE_PUBLISHED) a platform admin clicking "Publish" in
 * the review queue would produce.
 *
 * Run with: npx tsx scripts/publish-compliance-keyword-rules.ts <CATEGORY> [CATEGORY...]
 *
 * Requires SYSTEM_REVIEWER_ACCOUNT_ID (and optionally SYSTEM_REVIEWER_USER_ID)
 * in the environment -- the accountId the resulting audit log rows are
 * attributed to, since ComplianceKeywordRule itself has no tenant.
 */
import { db } from "@/lib/db";
import { listPendingKeywordRuleReviews, reviewKeywordRule } from "@/modules/complianceKeywordRules/keywordRuleReviewService";

async function main() {
  const categories = process.argv.slice(2);
  if (categories.length === 0) {
    console.error("Usage: npx tsx scripts/publish-compliance-keyword-rules.ts <CATEGORY> [CATEGORY...]");
    process.exit(1);
  }

  const accountId = process.env.SYSTEM_REVIEWER_ACCOUNT_ID;
  if (!accountId) {
    console.error("SYSTEM_REVIEWER_ACCOUNT_ID must be set -- audit log rows need an accountId to attribute to.");
    process.exit(1);
  }
  const userId = process.env.SYSTEM_REVIEWER_USER_ID ?? null;

  const pending = await listPendingKeywordRuleReviews(categories);
  if (pending.length === 0) {
    console.log(`No DRAFT rows found for categories: ${categories.join(", ")}`);
    return;
  }

  console.log(`Publishing ${pending.length} DRAFT rows across categories: ${categories.join(", ")}`);

  let published = 0;
  for (const item of pending) {
    await reviewKeywordRule(
      { accountId, userId, requestId: null },
      item.id,
      "PUBLISH",
      "Promoted via scripts/publish-compliance-keyword-rules.ts after legal/compliance review of seeded End-Use and Anti-Boycott phrase data."
    );
    published++;
    console.log(`  published: [${item.category}] "${item.phrase}"`);
  }

  console.log(`Done. ${published} rows promoted to PUBLISHED.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error("Publish run failed:", err);
    await db.$disconnect();
    process.exit(1);
  });
