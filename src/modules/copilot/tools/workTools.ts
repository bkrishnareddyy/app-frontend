/**
 * Exceptions, tasks and agent decisions.
 *
 * These three are grouped because they answer the same class of question — what
 * needs a human, and why — and because they share an access rule. The
 * Exceptions and Decisions screens carry no nav entry and no permission gate:
 * any authenticated member of the account can open them. Gating the tools more
 * tightly than the screens would not make the product safer, it would only make
 * the Copilot inconsistent with the app, so these tools declare no `access` and
 * inherit "authenticated member of this account" — which is still enforced,
 * because the account comes from the session.
 *
 * The task tool is the first production caller of `buildWorkQueue`. It does not
 * reimplement prioritisation; it loads the rows the queue accepts, bounded by
 * the actionable-status lists the module publishes, and hands them over.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { openStatusVariants } from "@/modules/exceptions/exceptionState";
import {
  DECISION_ACTIONABLE_STATUSES,
  DOCUMENT_ACTIONABLE_STATUSES,
  FILING_ACTIONABLE_STATUSES,
  FINDING_ACTIONABLE_STATUSES,
  buildWorkQueue,
  countByKind,
  countByPriority,
} from "@/modules/work/workQueue";
import { buildDecisionWhere, parseDecisionQuery } from "@/modules/decisions/decisionQuery";
import { COPILOT_LIMITS } from "../copilotConfig";
import { capped, isoDate, isoDay, text } from "../copilotProjection";
import { defineTool } from "../copilotToolTypes";
import { booleanParam, integerParam, params, stringParam } from "../copilotToolSchema";

/** Rows loaded per source before the queue prioritises them. */
const QUEUE_SOURCE_LIMIT = 50;

/**
 * A colleague's name, or nothing. Deliberately not their email address: the
 * answer needs to say who owns a piece of work, not hand out contact details.
 */
function personName(
  user: { firstName: string | null; lastName: string | null } | null | undefined
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

const exceptionsInput = z.object({
  status: z.string().trim().max(40).optional(),
  severity: z.enum(["Critical", "High", "Medium", "Low"]).optional(),
  assignedToMe: z.boolean().optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const listExceptionsTool = defineTool<z.infer<typeof exceptionsInput>>({
  name: "listExceptions",
  description:
    "Compliance exceptions raised in the signed-in account, newest first. Use it for 'what is blocking us' and 'what is open' questions. Defaults to exceptions that are still open.",
  progressLabel: "Checking exceptions",
  input: exceptionsInput,
  parameters: params({
    status: stringParam("Exception status, e.g. OPEN, IN_PROGRESS, RESOLVED, or 'all' for every status."),
    severity: stringParam("Severity.", { values: ["Critical", "High", "Medium", "Low"] }),
    assignedToMe: booleanParam("Only exceptions assigned to the signed-in user."),
    limit: integerParam("Maximum rows to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const { exceptions } = await ExceptionService.listExceptions(
      ctx.actor.accountId,
      ctx.actor.userId,
      {
        status: input.status,
        severity: input.severity,
        assignedToMe: input.assignedToMe,
      }
    );

    // "Open" is the useful default for a question about what needs attention,
    // and the caller can ask for everything by passing status: "all".
    const open = new Set(openStatusVariants());
    const rows = input.status ? exceptions : exceptions.filter((row) => open.has(row.status));

    const page = capped(rows, input.limit ?? COPILOT_LIMITS.maxSearchResults, (row) => {
      ctx.ledger.recordEntity(
        "EXCEPTION",
        row.id,
        text(row.description, 60) ?? row.type
      );
      if (row.shipment) {
        ctx.ledger.recordEntity("SHIPMENT", row.shipment.id, row.shipment.shipmentNumber);
      }
      return {
        exceptionId: row.id,
        type: row.type,
        category: row.category,
        severity: row.severity,
        status: row.status,
        blocking: row.blocking,
        description: text(row.description, 240),
        requiredAction: text(row.requiredAction, 200),
        raisedBy: row.sourceAgent,
        shipmentId: row.shipment?.id ?? null,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
        assignedTo: personName(row.assignedToUser),
        raisedAt: isoDay(row.createdAt),
      };
    });

    return {
      ok: true,
      data: {
        filteredTo: input.status ? input.status : "open exceptions only",
        totalMatching: rows.length,
        returned: page.returned,
        truncated: page.truncated,
        exceptions: page.items,
      },
    };
  },
});

const tasksInput = z.object({
  assignedToMe: z.boolean().optional(),
  kind: z.enum(["decision", "finding", "filing", "document", "exception"]).optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const listTasksTool = defineTool<z.infer<typeof tasksInput>>({
  name: "listTasks",
  description:
    "The prioritised work queue for the signed-in account: decisions awaiting review, open compliance findings, filings needing attention, documents needing review and open exceptions. Use it for 'what should I work on' questions.",
  progressLabel: "Building work queue",
  access: { navHref: "/app/actions" },
  input: tasksInput,
  parameters: params({
    assignedToMe: booleanParam("Only work assigned to the signed-in user."),
    kind: stringParam("Restrict to one kind of work item.", {
      values: ["decision", "finding", "filing", "document", "exception"],
    }),
    limit: integerParam("Maximum items to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const accountId = ctx.actor.accountId;

    const [decisions, findings, filings, documents, exceptions] = await Promise.all([
      db.agentDecision.findMany({
        where: { accountId, status: { in: DECISION_ACTIONABLE_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: QUEUE_SOURCE_LIMIT,
        select: {
          id: true,
          agentName: true,
          decisionSummary: true,
          status: true,
          createdAt: true,
          shipmentId: true,
          shipment: { select: { shipmentNumber: true } },
        },
      }),
      db.complianceFinding.findMany({
        where: { accountId, status: { in: FINDING_ACTIONABLE_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: QUEUE_SOURCE_LIMIT,
        select: {
          id: true,
          rule: true,
          severity: true,
          status: true,
          createdAt: true,
          filingId: true,
          assignedToUserId: true,
        },
      }),
      db.customsFiling.findMany({
        where: { accountId, filingStatus: { in: FILING_ACTIONABLE_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: QUEUE_SOURCE_LIMIT,
        select: {
          id: true,
          entryNumber: true,
          filingStatus: true,
          createdAt: true,
          shipment: { select: { shipmentNumber: true } },
        },
      }),
      db.shipmentDocument.findMany({
        where: { accountId, status: { in: DOCUMENT_ACTIONABLE_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: QUEUE_SOURCE_LIMIT,
        select: {
          id: true,
          fileName: true,
          status: true,
          createdAt: true,
          shipmentId: true,
          shipment: { select: { shipmentNumber: true } },
        },
      }),
      db.exceptionItem.findMany({
        where: { accountId, status: { in: openStatusVariants() } },
        orderBy: { createdAt: "desc" },
        take: QUEUE_SOURCE_LIMIT,
        select: {
          id: true,
          type: true,
          description: true,
          severity: true,
          status: true,
          createdAt: true,
          shipmentId: true,
          assignedToUserId: true,
          shipment: { select: { shipmentNumber: true } },
        },
      }),
    ]);

    const queue = buildWorkQueue({
      userId: ctx.actor.userId,
      decisions: decisions.map((row) => ({
        id: row.id,
        agentName: row.agentName,
        decisionSummary: row.decisionSummary,
        status: row.status,
        createdAt: row.createdAt,
        shipmentId: row.shipmentId,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
      })),
      findings: findings.map((row) => ({
        id: row.id,
        rule: row.rule,
        severity: row.severity,
        status: row.status,
        createdAt: row.createdAt,
        filingId: row.filingId,
        assignedToUserId: row.assignedToUserId,
      })),
      filings: filings.map((row) => ({
        id: row.id,
        entryNumber: row.entryNumber,
        filingStatus: row.filingStatus,
        createdAt: row.createdAt,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
      })),
      documents: documents.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        status: row.status,
        createdAt: row.createdAt,
        shipmentId: row.shipmentId,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
      })),
      exceptions: exceptions.map((row) => ({
        id: row.id,
        type: row.type,
        description: row.description,
        severity: row.severity,
        status: row.status,
        createdAt: row.createdAt,
        shipmentId: row.shipmentId,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
        assignedToUserId: row.assignedToUserId,
      })),
    });

    const filtered = queue.filter((item) => {
      if (input.kind && item.kind !== input.kind) return false;
      if (input.assignedToMe && !item.assignedToMe) return false;
      return true;
    });

    const page = capped(filtered, input.limit ?? COPILOT_LIMITS.maxSearchResults, (item) => {
      // The queue's own composite id ("exception:abc") is not an entity id, so
      // the underlying record is what gets recorded and what an action can open.
      const [, recordId] = item.id.split(":");
      if (item.kind === "exception" && recordId) {
        ctx.ledger.recordEntity("EXCEPTION", recordId, item.title);
      } else if (item.kind === "decision" && recordId) {
        ctx.ledger.recordEntity("DECISION", recordId, item.title);
      } else if (item.kind === "document" && recordId) {
        ctx.ledger.recordEntity("DOCUMENT", recordId, item.title);
      }
      return {
        kind: item.kind,
        recordId: recordId ?? null,
        title: item.title,
        reason: text(item.reason, 200),
        priority: item.priority,
        shipmentNumber: item.shipmentNumber,
        assignedToMe: item.assignedToMe,
        waitingSince: isoDay(item.createdAt),
      };
    });

    return {
      ok: true,
      data: {
        totalMatching: filtered.length,
        returned: page.returned,
        truncated: page.truncated,
        byPriority: countByPriority(filtered),
        byKind: countByKind(filtered),
        items: page.items,
        sourceLimitNote: `Each source was read up to ${QUEUE_SOURCE_LIMIT} rows, so counts describe the most recent work rather than the account's entire history.`,
      },
    };
  },
});

const decisionsInput = z.object({
  shipmentId: z.string().trim().max(64).optional(),
  agentName: z.string().trim().max(60).optional(),
  status: z.string().trim().max(40).optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const listDecisionsTool = defineTool<z.infer<typeof decisionsInput>>({
  name: "listDecisions",
  description:
    "Agent decisions recorded in the signed-in account: which agent ran, what it proposed, its confidence and whether a human has reviewed it. Use it to explain why a classification or an origin result looks the way it does.",
  progressLabel: "Reading agent decisions",
  input: decisionsInput,
  parameters: params({
    shipmentId: stringParam("Restrict to decisions on one shipment."),
    agentName: stringParam("Restrict to one agent, e.g. 'HTS Classification Agent'."),
    status: stringParam("Decision status, e.g. Review Required, Approved, Completed, Attention."),
    limit: integerParam("Maximum rows to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const limit = input.limit ?? COPILOT_LIMITS.maxSearchResults;
    const search = new URLSearchParams();
    if (input.shipmentId) search.set("shipmentId", input.shipmentId);
    if (input.agentName) search.set("agent", input.agentName);
    if (input.status) search.set("status", input.status);
    search.set("pageSize", String(limit));

    const query = parseDecisionQuery(search);
    const where = buildDecisionWhere(query, ctx.actor.accountId);

    const rows = await db.agentDecision.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentName: true,
        status: true,
        confidence: true,
        decisionSummary: true,
        purpose: true,
        lineNumber: true,
        currentHtsCode: true,
        proposedHtsCode: true,
        proposedDescription: true,
        rulesApplied: true,
        dataSources: true,
        regulations: true,
        humanNotes: true,
        reviewedByUserId: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true } },
      },
    });

    const decisions = rows.map((row) => {
      ctx.ledger.recordEntity(
        "DECISION",
        row.id,
        `${row.agentName}: ${row.decisionSummary}`.slice(0, 80)
      );
      if (row.shipment) {
        ctx.ledger.recordEntity("SHIPMENT", row.shipmentId, row.shipment.shipmentNumber);
      }
      return {
        decisionId: row.id,
        agentName: row.agentName,
        status: row.status,
        modelConfidence: row.confidence,
        summary: text(row.decisionSummary, 240),
        purpose: text(row.purpose, 200),
        lineNumber: row.lineNumber,
        currentHtsCode: row.currentHtsCode,
        proposedHtsCode: row.proposedHtsCode,
        proposedDescription: text(row.proposedDescription, 160),
        rulesApplied: row.rulesApplied.slice(0, 8),
        dataSources: row.dataSources.slice(0, 8),
        regulations: row.regulations.slice(0, 8),
        reviewerNote: text(row.humanNotes, 200),
        reviewed: row.reviewedByUserId !== null,
        shipmentId: row.shipmentId,
        shipmentNumber: row.shipment?.shipmentNumber ?? null,
        createdAt: isoDate(row.createdAt),
      };
    });

    return {
      ok: true,
      data: {
        returned: decisions.length,
        truncated: decisions.length === limit,
        decisions,
        // A proposal is not a decision anyone has taken.
        statusNote:
          "A decision with status 'Review Required' or 'Pending' is a proposal awaiting a human. Only a reviewed and approved decision represents a position the account has taken.",
      },
    };
  },
});

export const workTools = [listExceptionsTool, listTasksTool, listDecisionsTool];
