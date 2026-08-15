// End-User Screening -- repository layer.
//
// Reuses the ScreeningEntity table populated by bisCslIngestionService.ts
// (sourceList = "ENTITY_LIST" | "UNVERIFIED") -- no new schema required.
// Global reference data (no accountId column).
import { db } from "@/lib/db";
import type { ScreeningEntity } from "@prisma/client";

const END_USER_SOURCE_LISTS = ["ENTITY_LIST", "UNVERIFIED"];

/** Published BIS Entity List / Unverified List rows. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getEndUserEntityList(): Promise<ScreeningEntity[]> {
  return db.screeningEntity.findMany({
    where: { sourceList: { in: END_USER_SOURCE_LISTS }, publicationStatus: "PUBLISHED" },
  });
}
