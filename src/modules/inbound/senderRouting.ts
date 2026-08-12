import { db } from "@/lib/db";
import { normalizeSenderEmail } from "./emailNormalization";

export interface ResolvedInboundRoute {
  id: string;
  accountId: string;
  defaultAssignedToUserId: string | null;
}

export interface InboundRouteLookup {
  findActiveByNormalizedEmail(normalizedEmail: string): Promise<ResolvedInboundRoute | null>;
}

export const databaseInboundRouteLookup: InboundRouteLookup = {
  async findActiveByNormalizedEmail(normalizedEmail) {
    const route = await db.inboundSenderRoute.findFirst({
      where: { normalizedSenderEmail: normalizedEmail, status: "ACTIVE" },
      select: { id: true, accountId: true, defaultAssignedToUserId: true },
    });
    return route;
  },
};

/**
 * Resolves the single active route for a sender, if any.
 *
 * The `normalizedSenderEmail` column is globally unique (see
 * prisma/schema.prisma), so this can never return routes belonging to two
 * different accounts for the same sender -- that guarantee lives at the
 * database level, not here.
 */
export async function resolveInboundRoute(
  rawSenderEmail: string,
  lookup: InboundRouteLookup = databaseInboundRouteLookup
): Promise<ResolvedInboundRoute | null> {
  const normalized = normalizeSenderEmail(rawSenderEmail);
  return lookup.findActiveByNormalizedEmail(normalized);
}
