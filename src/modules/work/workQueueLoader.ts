/**
 * Account-scoped data loader for the work queue.
 *
 * Fetches decisions, findings, filings, documents, exceptions, and open
 * ComplianceDeadlines for one account and shapes them into WorkQueueInput.
 * The caller is responsible for account auth; this module does not re-check.
 */

import { db } from "@/lib/db";
import { DeadlineStatus } from "@prisma/client";
import {
  DECISION_ACTIONABLE_STATUSES,
  FILING_ACTIONABLE_STATUSES,
  DOCUMENT_ACTIONABLE_STATUSES,
  EXCEPTION_ACTIONABLE_STATUSES,
  type WorkQueueInput,
  type DecisionRow,
  type FilingRow,
  type DocumentRow,
  type ExceptionRow,
  type DeadlineRow,
} from "./workQueue";
import { ACTIONABLE_TRIAGE_STATES } from "@/modules/decisions/decisionState";

const ROW_CAP = 500; // per source — prevents loading the whole account

export interface WorkQueueLoaderResult {
  input: WorkQueueInput;
  loads: Partial<Record<keyof WorkQueueInput, { loaded: number; matching: number }>>;
}

export async function loadWorkQueueForAccount(
  accountId: string,
  userId: string,
  options: { shipmentId?: string } = {}
): Promise<WorkQueueLoaderResult> {
  const { shipmentId } = options;
  const shipmentFilter = shipmentId ? { shipmentId } : {};

  const [decisions, filings, documents, exceptions, deadlines] = await Promise.all([
    db.agentDecision.findMany({
      where: {
        accountId,
        OR: [
          { triageState: { in: [...ACTIONABLE_TRIAGE_STATES] } },
          { triageState: null, status: { in: [...DECISION_ACTIONABLE_STATUSES] } },
        ],
        ...shipmentFilter,
      },
      select: {
        id: true,
        agentName: true,
        decisionSummary: true,
        status: true,
        triageState: true,
        proposedDescription: true,
        confidence: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true, filingDeadline: true } },
      },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),

    db.customsFiling.findMany({
      where: {
        accountId,
        filingStatus: { in: FILING_ACTIONABLE_STATUSES },
        ...(shipmentId ? { shipmentId } : {}),
      },
      select: {
        id: true,
        entryNumber: true,
        filingStatus: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),

    db.shipmentDocument.findMany({
      where: {
        shipment: { accountId },
        status: { in: DOCUMENT_ACTIONABLE_STATUSES },
        ...shipmentFilter,
      },
      select: {
        id: true,
        fileName: true,
        status: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),

    db.exceptionItem.findMany({
      where: {
        accountId,
        status: { in: EXCEPTION_ACTIONABLE_STATUSES },
        ...shipmentFilter,
      },
      select: {
        id: true,
        type: true,
        description: true,
        severity: true,
        status: true,
        blocking: true,
        createdAt: true,
        shipmentId: true,
        assignedToUserId: true,
        shipment: { select: { shipmentNumber: true, filingDeadline: true } },
      },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),

    db.complianceDeadline.findMany({
      where: {
        accountId,
        status: DeadlineStatus.OPEN,
        dueAt: { not: null },
        ...(shipmentId ? { shipmentId } : {}),
      },
      select: {
        shipmentId: true,
        type: true,
        dueAt: true,
        estimated: true,
        penaltyEstimate: true,
      },
    }),
  ]);

  const decisionRows: DecisionRow[] = decisions.map((d) => ({
    id: d.id,
    agentName: d.agentName,
    decisionSummary: d.decisionSummary,
    status: d.status,
    triageState: d.triageState,
    proposedDescription: d.proposedDescription,
    confidence: d.confidence,
    createdAt: d.createdAt,
    shipmentId: d.shipmentId,
    shipmentNumber: d.shipment?.shipmentNumber ?? null,
    filingDeadline: d.shipment?.filingDeadline ?? null,
  }));

  const filingRows: FilingRow[] = filings.map((f) => ({
    id: f.id,
    entryNumber: f.entryNumber,
    filingStatus: f.filingStatus,
    createdAt: f.createdAt,
    shipmentId: f.shipmentId,
    shipmentNumber: f.shipment?.shipmentNumber ?? null,
  }));

  const documentRows: DocumentRow[] = documents.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    status: d.status,
    createdAt: d.createdAt,
    shipmentId: d.shipmentId,
    shipmentNumber: d.shipment?.shipmentNumber ?? null,
  }));

  const exceptionRows: ExceptionRow[] = exceptions.map((e) => ({
    id: e.id,
    type: e.type,
    description: e.description,
    severity: e.severity,
    status: e.status,
    blocking: e.blocking,
    createdAt: e.createdAt,
    shipmentId: e.shipmentId,
    shipmentNumber: e.shipment?.shipmentNumber ?? null,
    assignedToUserId: e.assignedToUserId,
    filingDeadline: e.shipment?.filingDeadline ?? null,
  }));

  const deadlineRows: DeadlineRow[] = deadlines
    .filter((d) => d.shipmentId != null && d.dueAt != null)
    .map((d) => ({
      shipmentId: d.shipmentId!,
      type: d.type,
      dueAt: d.dueAt!,
      estimated: d.estimated,
      penaltyEstimate: d.penaltyEstimate != null ? Number(d.penaltyEstimate) : null,
    }));

  const input: WorkQueueInput = {
    userId,
    decisions: decisionRows,
    findings: [], // findings come from CustomsFiling scope — not yet wired here
    filings: filingRows,
    documents: documentRows,
    exceptions: exceptionRows,
    deadlines: deadlineRows,
  };

  return {
    input,
    loads: {
      decisions: { loaded: decisions.length, matching: decisions.length },
      filings: { loaded: filings.length, matching: filings.length },
      documents: { loaded: documents.length, matching: documents.length },
      exceptions: { loaded: exceptions.length, matching: exceptions.length },
    },
  };
}
