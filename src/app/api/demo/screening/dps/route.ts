import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

// This route used to seed three invented companies into DeniedPartyWatchlist and
// label them OFAC_SDN and BIS_ENTITY_LIST. Those are legal records; inventing
// them and screening against them produced a clearance that meant nothing.

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { name, targetType } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required for screening" });
  }

  const cleanName = name.trim().toLowerCase();

  // Perform fuzzy string matching against watchlists
  const watchlists = await db.deniedPartyWatchlist.findMany();

  // An empty list cannot clear anyone. Reporting PASSED here would say the
  // party was screened and found clean when no list was ever consulted.
  if (watchlists.length === 0) {
    const emptyListLog = await db.screeningLog.create({
      data: {
        accountId: ctx.accountId,
        targetName: name,
        targetType: targetType || "Shipper",
        matchStatus: "INDETERMINATE",
        matchScore: 0,
        matchedParty: null,
        listSource: null,
      },
});

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "screening.dps",
      entity: "ScreeningLog",
      entityId: emptyListLog.id,
      source: "UI",
      metadata: { targetName: name, matchStatus: "INDETERMINATE", matchScore: 0 },
    });

    return NextResponse.json(
      {
        screeningResult: {
          targetName: name,
          matchStatus: "INDETERMINATE",
          matchScore: null,
          matchedEntity: null,
          recommendation:
            "NOT SCREENED - no denied party list is loaded. Screen this party against OFAC, BIS, UN, EU and UK lists before shipping.",
          screenedAt: emptyListLog.screenedAt,
        },
      },
      { status: 503 }
    );
  }

  let bestMatch = null;
  let maxScore = 0;

  for (const entry of watchlists) {
    const entryClean = entry.entityName.toLowerCase();
    let score = 0;

    if (cleanName === entryClean) {
      score = 100;
    } else if (cleanName.includes(entryClean) || entryClean.includes(cleanName)) {
      score = 85;
    } else {
      const words = cleanName.split(" ");
      const matchedWords = words.filter((w: string) => w.length > 3 && entryClean.includes(w));
      if (matchedWords.length > 0) {
        score = Math.min(75, matchedWords.length * 30);
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = entry;
    }
  }

  const matchStatus = maxScore >= 80 ? "BLOCKED" : maxScore >= 50 ? "FLAGGED" : "PASSED";

  const log = await db.screeningLog.create({
    data: {
      accountId: ctx.accountId,
      targetName: name,
      targetType: targetType || "Shipper",
      matchStatus,
      matchScore: maxScore,
      matchedParty: bestMatch ? bestMatch.entityName : null,
      listSource: bestMatch ? bestMatch.listSource : null,
      listVersion: bestMatch ? bestMatch.listVersion : "2026-08-08",
      publishDate: bestMatch ? bestMatch.publishDate : new Date("2026-08-08T00:00:00Z"),
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "screening.dps",
    entity: "ScreeningLog",
    entityId: log.id,
    source: "UI",
    metadata: { targetName: name, matchStatus, matchScore: maxScore },
  });

  return NextResponse.json({
    screeningResult: {
      targetName: name,
      matchStatus,
      matchScore: maxScore,
      matchedEntity: bestMatch
        ? {
            entityName: bestMatch.entityName,
            listSource: bestMatch.listSource,
            program: bestMatch.program,
            country: bestMatch.country,
            listVersion: bestMatch.listVersion,
            publishDate: bestMatch.publishDate,
          }
        : null,
      recommendation: matchStatus === "BLOCKED" ? "DO NOT SHIP / BLOCK TRANSACTION" : matchStatus === "FLAGGED" ? "MANUAL COMPLIANCE REVIEW REQUIRED" : "CLEAR TO SHIP",
      screenedAt: log.screenedAt,
      listVersion: log.listVersion,
      publishDate: log.publishDate,
    },
  });

}, { permission: "ai.use", write: true });
