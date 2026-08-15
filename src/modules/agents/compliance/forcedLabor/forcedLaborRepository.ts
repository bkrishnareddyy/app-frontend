// UFLPA / Forced Labor Screening -- repository layer.
//
// All reference-data access is isolated here, mirroring
// compliance/embargo/embargoRepository.ts. Both tables are shared/global
// reference data (no accountId column) -- consistent with EmbargoRule,
// Country, and CommerceControlList elsewhere in the schema.
import { db } from "@/lib/db";
import type { EmbargoRule, ScreeningEntity } from "@prisma/client";

/** EmbargoRule rows whose regime names UFLPA Forced Labor -- the existing country/region check's reference data. */
export async function getUflpaCountryRules(): Promise<EmbargoRule[]> {
  return db.embargoRule.findMany({
    where: { regime: { contains: "UFLPA", mode: "insensitive" } },
  });
}

/** Published UFLPA Entity List rows. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getUflpaEntityList(): Promise<ScreeningEntity[]> {
  return db.screeningEntity.findMany({
    where: { sourceList: "UFLPA_ENTITY_LIST", publicationStatus: "PUBLISHED" },
  });
}
