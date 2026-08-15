/**
 * Shipment.status is a plain string, not a Prisma enum (see schema.prisma's
 * comment on the field), and each creation path previously hardcoded its own
 * initial-status literal with no shared reference point. Naming both here
 * doesn't merge them to one value -- the two paths intentionally start a
 * shipment at different points in the lifecycle -- but it gives future call
 * sites one place to read the canonical initial value from instead of
 * re-typing (and risking a typo'd) literal.
 */

// In-app "New Shipment" flow: created empty, needs a user to fill it in.
export const MANUAL_INTAKE_INITIAL_STATUS = "Draft";

// External ERP intake API: created with importer/line-item data already
// populated, so it starts past the drafting stage.
export const ERP_INTAKE_INITIAL_STATUS = "In Progress";
