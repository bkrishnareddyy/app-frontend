/**
 * An intake whose target shipment could not be determined.
 *
 * The resolver used to guess the account's newest shipment. A document filed
 * against the wrong shipment is worse than one that was never filed, because
 * nothing in the record says the target was a guess.
 */

export const UNASSIGNED_INTAKE_TYPE = "unassigned_intake";
export const UNASSIGNED_INTAKE_SEVERITY = "High";

export type IntakeSource = "document_upload" | "intake_agent" | "agent_run";

const SOURCE_LABEL: Record<IntakeSource, string> = {
  document_upload: "uploaded through the document upload form",
  intake_agent: "submitted to the intake agent",
  agent_run: "submitted with an agent run",
};

export interface UnassignedIntake {
  source: IntakeSource;
  fileName?: string | null;
  docType?: string | null;
  requestedShipmentId?: string | null;
}

export function unassignedIntakeDescription(intake: UnassignedIntake): string {
  const what = intake.fileName?.trim() || "An intake item";
  const type = intake.docType?.trim();
  const typePart = type && type !== "AUTO_DETECT" ? ` (${type})` : "";
  return (
    `${what}${typePart} was ${SOURCE_LABEL[intake.source]} without naming a shipment. ` +
    `Assign it to a shipment, or close this item if it should not be filed.`
  );
}

export interface UnassignedIntakeStore {
  create(input: {
    accountId: string;
    type: string;
    severity: string;
    description: string;
    status: string;
  }): Promise<{ id: string }>;
}

export const databaseUnassignedIntakeStore: UnassignedIntakeStore = {
  async create(input) {
    const { db } = await import("@/lib/db");
    return db.exceptionItem.create({ data: input, select: { id: true } });
  },
};

export async function recordUnassignedIntake(
  accountId: string,
  intake: UnassignedIntake,
  store: UnassignedIntakeStore = databaseUnassignedIntakeStore
): Promise<{ id: string; description: string }> {
  const description = unassignedIntakeDescription(intake);
  const row = await store.create({
    accountId,
    type: UNASSIGNED_INTAKE_TYPE,
    severity: UNASSIGNED_INTAKE_SEVERITY,
    description,
    status: "Open",
  });
  return { id: row.id, description };
}
