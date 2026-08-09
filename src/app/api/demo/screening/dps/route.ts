import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

// Seed OFAC/BIS watchlists if empty
async function ensureWatchlistSeeded() {
  const count = await db.deniedPartyWatchlist.count();
  if (count === 0) {
    await db.deniedPartyWatchlist.createMany({
      data: [
        {
          listSource: "OFAC_SDN",
          entityName: "Shenzhen MicroElectronics Tech Corp",
          entityType: "Organization",
          country: "China",
          program: "SDNTK",
          addresses: { city: "Shenzhen", country: "China" },
        },
        {
          listSource: "BIS_ENTITY_LIST",
          entityName: "Global Defense Logistics LLC",
          entityType: "Organization",
          country: "Russia",
          program: "RUSSIA-EO14024",
          addresses: { city: "Moscow", country: "Russia" },
        },
        {
          listSource: "OFAC_SDN",
          entityName: "Viktor Ivanov",
          entityType: "Individual",
          country: "Belarus",
          program: "COUNTER-NARCOTICS",
          addresses: { city: "Minsk", country: "Belarus" },
        },
      ],
      skipDuplicates: true,
    });
  }
}

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  await ensureWatchlistSeeded();

  const body = await req.json();
  const { name, targetType, country } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required for screening" }, { status: 400 });
  }

  const cleanName = name.trim().toLowerCase();

  // Perform fuzzy string matching against watchlists
  const watchlists = await db.deniedPartyWatchlist.findMany();
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
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "screening.dps",
    entity: "ScreeningLog",
    entityId: log.id,
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
          }
        : null,
      recommendation: matchStatus === "BLOCKED" ? "DO NOT SHIP / BLOCK TRANSACTION" : matchStatus === "FLAGGED" ? "MANUAL COMPLIANCE REVIEW REQUIRED" : "CLEAR TO SHIP",
      screenedAt: log.screenedAt,
    },
  });
});
