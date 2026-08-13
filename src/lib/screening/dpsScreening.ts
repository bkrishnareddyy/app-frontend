/**
 * Denied-party screening against the `DeniedPartyWatchlist` table.
 *
 * A single function so the same logic runs at party creation, shipment
 * submission, and any other point where a name needs to be checked.
 *
 * Returns INDETERMINATE when no watchlist entries are loaded — an empty
 * list cannot clear anyone, and reporting PASSED there would produce a
 * meaningless clearance. The caller decides whether INDETERMINATE should
 * block the workflow.
 */

import { db } from "@/lib/db";

export type DpsMatchStatus = "PASSED" | "FLAGGED" | "BLOCKED" | "INDETERMINATE";

/**
 * Pure fuzzy match scorer — separated from the DB write so tests can cover
 * the algorithm without a Prisma client.
 *
 * Returns a score 0–100 representing how closely `target` matches `entry`:
 * - 100: exact match (case-insensitive)
 * - 85: one string contains the other
 * - 1-75: word-overlap score, capped at 75
 * - 0: no meaningful match
 */
export function scoreDpsMatch(target: string, entry: string): number {
  const cleanTarget = target.trim().toLowerCase();
  const cleanEntry = entry.trim().toLowerCase();

  if (cleanTarget === cleanEntry) return 100;
  if (cleanTarget.includes(cleanEntry) || cleanEntry.includes(cleanTarget)) return 85;

  const words = cleanTarget.split(" ");
  const matched = words.filter((w) => w.length > 3 && cleanEntry.includes(w));
  return matched.length > 0 ? Math.min(75, matched.length * 30) : 0;
}

export function scoreToMatchStatus(maxScore: number): DpsMatchStatus {
  if (maxScore >= 80) return "BLOCKED";
  if (maxScore >= 50) return "FLAGGED";
  return "PASSED";
}

export interface DpsScreeningResult {
  logId: string;
  targetName: string;
  matchStatus: DpsMatchStatus;
  matchScore: number;
  matchedParty: string | null;
  listSource: string | null;
  screenedAt: Date;
}

export async function screenPartyName(
  accountId: string,
  name: string,
  targetType: string
): Promise<DpsScreeningResult> {
  const watchlists = await db.deniedPartyWatchlist.findMany();

  if (watchlists.length === 0) {
    const log = await db.screeningLog.create({
      data: {
        accountId,
        targetName: name,
        targetType,
        matchStatus: "INDETERMINATE",
        matchScore: 0,
        matchedParty: null,
        listSource: null,
      },
    });
    return {
      logId: log.id,
      targetName: name,
      matchStatus: "INDETERMINATE",
      matchScore: 0,
      matchedParty: null,
      listSource: null,
      screenedAt: log.screenedAt,
    };
  }

  let bestMatch: (typeof watchlists)[number] | null = null;
  let maxScore = 0;

  for (const entry of watchlists) {
    const score = scoreDpsMatch(name, entry.entityName);
    if (score > maxScore) {
      maxScore = score;
      bestMatch = entry;
    }
  }

  const matchStatus = scoreToMatchStatus(maxScore);

  const log = await db.screeningLog.create({
    data: {
      accountId,
      targetName: name,
      targetType,
      matchStatus,
      matchScore: maxScore,
      matchedParty: bestMatch ? bestMatch.entityName : null,
      listSource: bestMatch ? bestMatch.listSource : null,
      listVersion: bestMatch ? bestMatch.listVersion : null,
      publishDate: bestMatch ? bestMatch.publishDate : null,
    },
  });

  return {
    logId: log.id,
    targetName: name,
    matchStatus,
    matchScore: maxScore,
    matchedParty: bestMatch ? bestMatch.entityName : null,
    listSource: bestMatch ? bestMatch.listSource : null,
    screenedAt: log.screenedAt,
  };
}
