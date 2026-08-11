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
