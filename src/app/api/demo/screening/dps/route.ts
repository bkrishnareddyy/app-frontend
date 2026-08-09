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
          listVersion: "2026-08-08",
          publishDate: new Date("2026-08-08T00:00:00Z"),
        },
        {
          listSource: "BIS_ENTITY_LIST",
          entityName: "Global Defense Logistics LLC",
          entityType: "Organization",
          country: "Russia",
          program: "RUSSIA-EO14024",
          addresses: { city: "Moscow", country: "Russia" },
          listVersion: "2026-08-08",
          publishDate: new Date("2026-08-08T00:00:00Z"),
        },
        {
          listSource: "OFAC_SDN",
          entityName: "Viktor Ivanov",
          entityType: "Individual",
          country: "Belarus",
          program: "COUNTER-NARCOTICS",
          addresses: { city: "Minsk", country: "Belarus" },
          listVersion: "2026-08-08",
          publishDate: new Date("2026-08-08T00:00:00Z"),
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
  } catch (error) {
    console.error("POST /api/screening/dps error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
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
