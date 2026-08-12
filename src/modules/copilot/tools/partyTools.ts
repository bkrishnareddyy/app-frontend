/**
 * Global Party Master tools.
 *
 * Same shape as the product tools and for the same reasons: the tenant filter
 * lives in `partyService`, the actor comes from the session, and the projection
 * carries what a customs question needs rather than the whole record.
 *
 * The party projection is where the origin trap is most tempting, so the
 * addresses and registrations it returns are labelled for what they are. A
 * party registered in Germany is a party registered in Germany; it says nothing
 * about where any product originates, and the system prompt says so too.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { COPILOT_LIMITS } from "../copilotConfig";
import { capped, isoDate, isoDay, text } from "../copilotProjection";
import { defineTool, type CopilotToolRunContext } from "../copilotToolTypes";
import { booleanParam, integerParam, params, stringParam } from "../copilotToolSchema";
import {
  getParty,
  getPartyHistory,
  listParties,
  type PartyActor,
} from "@/modules/party/partyService";
import { parsePartyQuery } from "@/modules/party/partyQuery";
import { holdsPermission } from "@/modules/party/partyActor";
import { partyDisplayName } from "@/modules/party/partyDisplay";

const PARTIES_NAV = "/app/parties";

const PARTY_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "ARCHIVED"] as const;
const PARTY_REVIEW_STATUSES = [
  "UNREVIEWED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_REVIEW",
] as const;
const PARTY_ROLE_TYPES = [
  "IMPORTER",
  "EXPORTER",
  "MANUFACTURER",
  "SUPPLIER",
  "CUSTOMER",
  "CONSIGNEE",
  "CONSIGNOR",
  "CARRIER",
  "FREIGHT_FORWARDER",
  "CUSTOMS_BROKER",
  "BUYER",
  "SELLER",
  "NOTIFY_PARTY",
  "OTHER",
] as const;

function actorFor(ctx: CopilotToolRunContext): PartyActor {
  const context = ctx.actor.context;
  return {
    accountId: ctx.actor.accountId,
    userId: ctx.actor.userId,
    canApproveParty: holdsPermission(context, "parties.review.approve"),
    canVerifyRegistration: holdsPermission(context, "parties.registration.verify"),
    canResolveRevalidation: holdsPermission(context, "parties.revalidation.resolve"),
    requestId: ctx.actor.requestId,
  };
}

const searchInput = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(PARTY_STATUSES).optional(),
  reviewStatus: z.enum(PARTY_REVIEW_STATUSES).optional(),
  roleType: z.enum(PARTY_ROLE_TYPES).optional(),
  needsRevalidation: z.boolean().optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const searchPartiesTool = defineTool<z.infer<typeof searchInput>>({
  name: "searchParties",
  description:
    "Search the Global Party Master for parties (importers, exporters, manufacturers, suppliers, brokers and so on) in the signed-in account. Returns a bounded list of summaries.",
  progressLabel: "Searching parties",
  access: { navHref: PARTIES_NAV },
  input: searchInput,
  parameters: params({
    query: stringParam("Free text: party name, internal code, or an identifier such as an EORI or DUNS."),
    status: stringParam("Party lifecycle status.", { values: PARTY_STATUSES }),
    reviewStatus: stringParam("Master-data review status.", { values: PARTY_REVIEW_STATUSES }),
    roleType: stringParam("Restrict to parties currently holding this role.", {
      values: PARTY_ROLE_TYPES,
    }),
    needsRevalidation: booleanParam("Only parties carrying an open revalidation flag."),
    limit: integerParam("Maximum rows to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const limit = input.limit ?? COPILOT_LIMITS.maxSearchResults;
    const search = new URLSearchParams();
    if (input.query) search.set("q", input.query);
    if (input.status) search.set("status", input.status);
    if (input.reviewStatus) search.set("reviewStatus", input.reviewStatus);
    if (input.roleType) search.set("roleType", input.roleType);
    if (input.needsRevalidation) search.set("needsRevalidation", "true");
    search.set("pageSize", String(limit));

    const result = await listParties(actorFor(ctx), parsePartyQuery(search));

    const parties = result.rows.map((row) => {
      const label = row.displayName ?? row.internalPartyCode ?? row.id;
      ctx.ledger.recordEntity("PARTY", row.id, label);
      return {
        partyId: row.id,
        name: row.displayName,
        internalCode: row.internalPartyCode,
        partyKind: row.partyKind,
        status: row.status,
        reviewStatus: row.reviewStatus,
        activeRoles: row.activeRoles,
        openRevalidationCount: row.openRevalidationCount,
        updatedAt: isoDay(row.updatedAt),
      };
    });

    return {
      ok: true,
      data: {
        totalMatching: result.total,
        returned: parties.length,
        truncated: result.total > parties.length,
        parties,
      },
    };
  },
});

const partyIdInput = z.object({ partyId: z.string().trim().min(1).max(64) });

export const getPartyTool = defineTool<z.infer<typeof partyIdInput>>({
  name: "getParty",
  description:
    "Full detail for one party: names, identifiers, registrations, addresses, roles, sites, relationships and open revalidation flags. Requires a party id from searchParties or from the page the user is on.",
  progressLabel: "Reading party record",
  access: { navHref: PARTIES_NAV },
  input: partyIdInput,
  parameters: params({ partyId: stringParam("The Qubere party id.") }, ["partyId"]),

  async execute(ctx, input) {
    const party = await getParty(actorFor(ctx), input.partyId);
    if (!party) {
      return { ok: false, code: "NOT_FOUND", message: "No such party in this account." };
    }

    const displayName = partyDisplayName(party);
    ctx.ledger.recordEntity("PARTY", party.id, displayName);

    for (const item of party.evidence.slice(0, COPILOT_LIMITS.maxSearchResults)) {
      ctx.ledger.recordEvidence(
        item.id,
        `${item.sourceType} evidence on ${displayName}`,
        text(item.description, 160),
        { type: "PARTY", id: party.id }
      );
    }

    const active = <T extends { status: string }>(rows: readonly T[]) =>
      rows.filter((row) => row.status === "ACTIVE");

    return {
      ok: true,
      data: {
        partyId: party.id,
        name: displayName,
        internalCode: party.internalPartyCode,
        partyKind: party.partyKind,
        status: party.status,
        reviewStatus: party.reviewStatus,
        version: party.currentVersion,
        names: active(party.names)
          .slice(0, 8)
          .map((row) => ({ name: row.rawName, type: row.nameType, isPrimary: row.isPrimary })),
        identifiers: active(party.identifiers)
          .slice(0, 10)
          .map((row) => ({
            type: row.identifierType,
            value: row.value,
            issuingCountry: row.issuingCountry,
            isPrimary: row.isPrimary,
          })),
        registrations: party.registrations.slice(0, 8).map((row) => ({
          registrationNumber: row.registrationNumber,
          authority: row.registeringAuthority,
          countryOfRegistration: row.country,
          legalForm: row.legalForm,
          status: row.status,
          verifiedAt: isoDay(row.verifiedAt),
        })),
        addresses: active(party.addresses)
          .slice(0, 6)
          .map((row) => ({
            type: row.addressType,
            city: row.city,
            stateProvince: row.stateProvince,
            country: row.country,
            isVerified: row.isVerified,
            isPrimary: row.isPrimary,
          })),
        roles: active(party.roles)
          .slice(0, 12)
          .map((row) => ({ roleType: row.roleType, since: isoDay(row.effectiveFrom) })),
        sites: party.sites.slice(0, 8).map((row) => ({
          siteName: row.siteName,
          status: row.status,
        })),
        relationships: [
          ...party.relationshipsFrom.slice(0, 5).map((row) => ({
            direction: "FROM_THIS_PARTY" as const,
            relationshipType: row.relationshipType,
            counterpartyId: row.toPartyId,
            counterpartyCode: row.toParty.internalPartyCode,
          })),
          ...party.relationshipsTo.slice(0, 5).map((row) => ({
            direction: "TO_THIS_PARTY" as const,
            relationshipType: row.relationshipType,
            counterpartyId: row.fromPartyId,
            counterpartyCode: row.fromParty.internalPartyCode,
          })),
        ],
        openRevalidationFlags: party.revalidationFlags
          .filter((flag) => flag.status === "OPEN")
          .slice(0, 10)
          .map((flag) => ({
            flag: flag.flag,
            reason: text(flag.reason, 200),
            raisedAt: isoDay(flag.createdAt),
          })),
        evidenceCount: party.evidence.length,
        updatedAt: isoDate(party.updatedAt),
        // Stated in the payload, not only in the prompt: a country on a party
        // is where that party is registered or located, and nothing else.
        countryNote:
          "Registration and address countries describe this party. They are not the country of origin of any product it supplies.",
      },
    };
  },
});

const historyInput = z.object({
  partyId: z.string().trim().min(1).max(64),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const getPartyHistoryTool = defineTool<z.infer<typeof historyInput>>({
  name: "getPartyHistory",
  description:
    "Recorded change history for one party: what changed, when, and how significant it was for customs. Use it for 'what changed' and 'why is this party flagged' questions.",
  progressLabel: "Reading party history",
  access: { navHref: PARTIES_NAV },
  input: historyInput,
  parameters: params(
    {
      partyId: stringParam("The Qubere party id."),
      limit: integerParam("Maximum change events to return, newest first.", {
        min: 1,
        max: COPILOT_LIMITS.maxSearchResults,
      }),
    },
    ["partyId"]
  ),

  async execute(ctx, input) {
    const actor = actorFor(ctx);
    const party = await getParty(actor, input.partyId);
    if (!party) {
      return { ok: false, code: "NOT_FOUND", message: "No such party in this account." };
    }

    const events = await getPartyHistory(actor, input.partyId);
    const page = capped(events, input.limit ?? COPILOT_LIMITS.maxSearchResults, (event) => ({
      changedAt: isoDate(event.createdAt),
      version: event.versionNumber,
      entity: event.entity,
      field: event.field,
      significance: event.significance,
      impactFlags: event.impactFlags,
      previousValue: text(event.oldValue, 120),
      newValue: text(event.newValue, 120),
      reason: text(event.changeReason, 300),
    }));

    ctx.ledger.recordEntity("PARTY", party.id, partyDisplayName(party));

    return {
      ok: true,
      data: {
        partyId: party.id,
        totalEvents: events.length,
        returned: page.returned,
        truncated: page.truncated,
        events: page.items,
      },
    };
  },
});

export const getPartyEvidenceTool = defineTool<z.infer<typeof partyIdInput>>({
  name: "getPartyEvidence",
  description:
    "The provenance behind a party's facts: which document, page and extraction each fact came from, and which facts each evidence record supports. Use it whenever the user asks how Qubere knows something about a party.",
  progressLabel: "Reading party evidence",
  access: { navHref: PARTIES_NAV },
  input: partyIdInput,
  parameters: params({ partyId: stringParam("The Qubere party id.") }, ["partyId"]),

  async execute(ctx, input) {
    const accountId = ctx.actor.accountId;

    const party = await db.party.findFirst({
      where: { id: input.partyId, accountId, deletedAt: null },
      select: {
        id: true,
        internalPartyCode: true,
        names: {
          where: { status: "ACTIVE" },
          select: { rawName: true, isPrimary: true, nameType: true },
        },
      },
    });
    if (!party) {
      return { ok: false, code: "NOT_FOUND", message: "No such party in this account." };
    }

    const displayName = partyDisplayName(party);
    ctx.ledger.recordEntity("PARTY", party.id, displayName);

    const [rows, total] = await Promise.all([
      db.partyEvidence.findMany({
        where: { partyId: party.id, accountId },
        orderBy: { createdAt: "desc" },
        take: COPILOT_LIMITS.maxSearchResults,
        include: {
          sourceDocument: { select: { id: true, fileName: true, docType: true } },
          _count: {
            select: {
              names: true,
              identifiers: true,
              registrations: true,
              addresses: true,
              roles: true,
              relationships: true,
            },
          },
        },
      }),
      db.partyEvidence.count({ where: { partyId: party.id, accountId } }),
    ]);

    const evidence = rows.map((item) => {
      const document = item.sourceDocument;
      const label = document
        ? `${document.fileName}${item.page ? `, page ${item.page}` : ""}`
        : `${item.sourceType} evidence`;

      ctx.ledger.recordEvidence(item.id, label, text(item.description, 160), {
        type: "PARTY",
        id: party.id,
      });
      if (document) ctx.ledger.recordEntity("DOCUMENT", document.id, document.fileName);

      return {
        evidenceId: item.id,
        sourceType: item.sourceType,
        documentId: document?.id ?? null,
        documentName: document?.fileName ?? null,
        documentType: document?.docType ?? null,
        page: item.page,
        reference: text(item.sourceReference, 120),
        description: text(item.description, 240),
        supports: {
          names: item._count.names,
          identifiers: item._count.identifiers,
          registrations: item._count.registrations,
          addresses: item._count.addresses,
          roles: item._count.roles,
          relationships: item._count.relationships,
        },
        recordedAt: isoDay(item.createdAt),
      };
    });

    return {
      ok: true,
      data: {
        partyId: party.id,
        totalEvidence: total,
        returned: evidence.length,
        truncated: total > evidence.length,
        evidence,
      },
    };
  },
});

export const partyTools = [
  searchPartiesTool,
  getPartyTool,
  getPartyHistoryTool,
  getPartyEvidenceTool,
];
