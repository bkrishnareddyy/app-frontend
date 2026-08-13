import { db } from "@/lib/db";

/**
 * An active account member, as the assignee filters on the Documents,
 * Shipments and Command Center screens receive them.
 *
 * Three server pages built this same shape independently and typed it `any[]`,
 * and three client components re-declared it inline, so a rename in one place
 * produced no error in the other five. This is the single declaration.
 *
 * `firstName`/`lastName` are nullable because a Clerk user can exist with only an
 * email; the screens fall back to the email rather than rendering a blank name.
 */
export interface TeamMember {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Active members of an account. Unlike the Dashboard/Documents/Shipments
 * pages, which only fetch this for ENTERPRISE ADMIN/OWNER callers, this is
 * available to any authenticated member — the assistant's "who's on my
 * team" answer is intentionally broader than those screens.
 */
export async function getActiveTeamMembers(accountId: string): Promise<TeamMember[]> {
  const memberships = await db.accountMembership.findMany({
    where: { accountId, status: "ACTIVE" },
    include: { user: true },
  });
  return memberships.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
  }));
}
