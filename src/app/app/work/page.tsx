import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CircleAlert, Inbox, Scale, FileCheck2, Files, FileText, TriangleAlert } from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  DECISION_ACTIONABLE_STATUSES,
  DOCUMENT_ACTIONABLE_STATUSES,
  EXCEPTION_ACTIONABLE_STATUSES,
  FILING_ACTIONABLE_STATUSES,
  FINDING_ACTIONABLE_STATUSES,
  WORK_KINDS,
  WORK_PRIORITIES,
  buildWorkQueue,
  countByKind,
  countByPriority,
  filterWorkQueue,
  paginateWorkQueue,
  parseWorkFilter,
  truncatedSources,
  type WorkItemKind,
  type WorkPriority,
} from "@/modules/work/workQueue";
import { pageCount, tableHref } from "@/modules/tables/tableQuery";
import { displayDate } from "@/lib/honest";

export const dynamic = "force-dynamic";

/** Each source is capped so one noisy table cannot crowd out the others. */
const SOURCE_LIMIT = 200;

const KIND_ICON: Record<WorkItemKind, typeof Scale> = {
  decision: Scale,
  finding: CircleAlert,
  filing: FileCheck2,
  document: Files,
  exception: TriangleAlert,
};

const KIND_LABEL: Record<WorkItemKind, string> = {
  decision: "Agent decision",
  finding: "Compliance finding",
  filing: "Customs filing",
  document: "Document",
  exception: "Exception",
};

const PRIORITY_STYLE: Record<WorkPriority, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  normal: "bg-[#F5F5F7] text-[#86868B] border-[#E5E5EA]",
};

export default async function MyWorkPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  const filter = parseWorkFilter(params);

  const accountId = context.accountId;
  const decisionWhere = { accountId, status: { in: DECISION_ACTIONABLE_STATUSES } };
  const findingWhere = { accountId, status: { in: FINDING_ACTIONABLE_STATUSES } };
  const filingWhere = { accountId, filingStatus: { in: FILING_ACTIONABLE_STATUSES } };
  const documentWhere = { accountId, status: { in: DOCUMENT_ACTIONABLE_STATUSES } };
  const exceptionWhere = { accountId, status: { in: EXCEPTION_ACTIONABLE_STATUSES } };

  // Statuses that never reach the queue are excluded in the query, so the cap is
  // spent on rows that can actually appear, and the counts below are exact.
  const [
    decisions,
    findings,
    filings,
    documents,
    exceptions,
    decisionTotal,
    findingTotal,
    filingTotal,
    documentTotal,
    exceptionTotal,
  ] = await Promise.all([
    db.agentDecision.findMany({
      where: decisionWhere,
      select: {
        id: true,
        agentName: true,
        decisionSummary: true,
        status: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true } },
      },
      take: SOURCE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
    db.complianceFinding.findMany({
      where: findingWhere,
      select: {
        id: true,
        rule: true,
        severity: true,
        status: true,
        createdAt: true,
        filingId: true,
        assignedToUserId: true,
      },
      take: SOURCE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
    db.customsFiling.findMany({
      where: filingWhere,
      select: {
        id: true,
        entryNumber: true,
        filingStatus: true,
        createdAt: true,
        shipment: { select: { shipmentNumber: true } },
      },
      take: SOURCE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
    db.shipmentDocument.findMany({
      where: documentWhere,
      select: {
        id: true,
        fileName: true,
        status: true,
        createdAt: true,
        shipmentId: true,
        shipment: { select: { shipmentNumber: true } },
      },
      take: SOURCE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
    db.exceptionItem.findMany({
      where: exceptionWhere,
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
      take: SOURCE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
    db.agentDecision.count({ where: decisionWhere }),
    db.complianceFinding.count({ where: findingWhere }),
    db.customsFiling.count({ where: filingWhere }),
    db.shipmentDocument.count({ where: documentWhere }),
    db.exceptionItem.count({ where: exceptionWhere }),
  ]);

  const items = buildWorkQueue({
    userId: context.userId,
    decisions: decisions.map((d) => ({ ...d, shipmentNumber: d.shipment?.shipmentNumber ?? null })),
    findings,
    filings: filings.map((f) => ({ ...f, shipmentNumber: f.shipment?.shipmentNumber ?? null })),
    documents: documents.map((d) => ({ ...d, shipmentNumber: d.shipment?.shipmentNumber ?? null })),
    exceptions: exceptions.map((e) => ({
      ...e,
      shipmentNumber: e.shipment?.shipmentNumber ?? null,
    })),
  });

  const truncated = truncatedSources({
    decision: { loaded: decisions.length, matching: decisionTotal },
    finding: { loaded: findings.length, matching: findingTotal },
    filing: { loaded: filings.length, matching: filingTotal },
    document: { loaded: documents.length, matching: documentTotal },
    exception: { loaded: exceptions.length, matching: exceptionTotal },
  });

  const counts = countByPriority(items);
  const kindCounts = countByKind(items);
  const matching = filterWorkQueue(items, filter);
  const visible = paginateWorkQueue(matching, filter);
  const totalPages = pageCount(matching.length, filter.pageSize);
  const firstOnPage = matching.length === 0 ? 0 : (filter.page - 1) * filter.pageSize + 1;
  const lastOnPage = Math.min(filter.page * filter.pageSize, matching.length);
  const hasFilter = Boolean(filter.kind || filter.priority || filter.assignedToMe);

  const href = (patch: Record<string, string | number | null>) =>
    tableHref("/app/work", params, { ...patch, page: null });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1D1D1F]">My Work</h1>
        <p className="text-sm text-[#86868B] mt-1">
          Everything in {context.accountName} that is waiting on a person. Items assigned to you
          come first, then the most severe, then the longest waiting.
        </p>
      </div>

      {truncated.length > 0 && (
        <div
          role="status"
          className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900"
        >
          More than {SOURCE_LIMIT} items are waiting in{" "}
          {truncated.map((kind) => KIND_LABEL[kind].toLowerCase()).join(", ")}. The oldest{" "}
          {SOURCE_LIMIT} of each are shown, so the counts below describe what is on this page, not
          the whole account.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {WORK_PRIORITIES.map((priority) => (
          <Link
            key={priority}
            href={href({ priority: filter.priority === priority ? null : priority })}
            className={`rounded-2xl bg-white border p-4 transition-colors hover:border-[#0071E3] ${
              filter.priority === priority ? "border-[#0071E3]" : "border-[#E5E5EA]"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[#86868B]">{priority}</p>
            <p className="text-3xl font-semibold text-[#1D1D1F] mt-1 tabular-nums">{counts[priority]}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href({ mine: filter.assignedToMe ? null : "1" })}
          className={`px-3 py-1.5 rounded-full border text-sm font-semibold transition-colors ${
            filter.assignedToMe
              ? "bg-[#0071E3] text-white border-[#0071E3]"
              : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:border-[#0071E3]"
          }`}
        >
          Assigned to me
        </Link>
        {WORK_KINDS.map((kind) => (
          <Link
            key={kind}
            href={href({ kind: filter.kind === kind ? null : kind })}
            className={`px-3 py-1.5 rounded-full border text-sm font-semibold transition-colors ${
              filter.kind === kind
                ? "bg-[#0071E3] text-white border-[#0071E3]"
                : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:border-[#0071E3]"
            }`}
          >
            {KIND_LABEL[kind]} ({kindCounts[kind]})
          </Link>
        ))}
        {hasFilter && (
          <Link href="/app/work" className="px-3 py-1.5 text-sm font-semibold text-[#0071E3]">
            Clear filters
          </Link>
        )}
      </div>

      {matching.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5E5EA] p-10 text-center">
          <Inbox className="w-8 h-8 text-[#86868B] mx-auto" />
          <p className="mt-3 text-sm font-medium text-[#1D1D1F]">
            {hasFilter ? "No item matches this filter" : "Nothing is waiting on you"}
          </p>
          <p className="mt-1 text-sm text-[#86868B]">
            {hasFilter
              ? "Clear the filter to see everything still waiting."
              : "Items appear here when a decision, finding, filing or document needs review."}
          </p>
          <Link
            href={hasFilter ? "/app/work" : "/app/shipments"}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-[#0071E3] text-white text-sm font-medium"
          >
            <FileText className="w-4 h-4" />
            {hasFilter ? "Clear filters" : "Go to shipments"}
          </Link>
        </div>
      ) : (
        <>
          <ul className="rounded-2xl bg-white border border-[#E5E5EA] divide-y divide-[#E5E5EA] overflow-hidden">
            {visible.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li key={item.id}>
                  <Link href={item.href} className="flex items-start gap-4 p-4 hover:bg-[#F5F5F7] transition-colors">
                    <span className="mt-0.5 w-9 h-9 shrink-0 rounded-xl bg-[#F5F5F7] flex items-center justify-center">
                      <Icon className="w-4 h-4 text-[#86868B]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#1D1D1F] truncate">{item.title}</span>
                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap ${PRIORITY_STYLE[item.priority]}`}
                        >
                          {item.priority}
                        </span>
                        {item.assignedToMe && (
                          <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#0071E3]/20 bg-[#0071E3]/10 text-[#0071E3] whitespace-nowrap">
                            Assigned to you
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-[#86868B] mt-1">{item.reason}</span>
                      <span className="block text-sm text-[#86868B] mt-1">
                        {KIND_LABEL[item.kind]}
                        {item.shipmentNumber ? ` · ${item.shipmentNumber}` : ""} · {displayDate(item.createdAt)}
                      </span>
                    </span>
                    {item.priority === "critical" && (
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-1" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <nav
            aria-label="Work queue pages"
            className="flex items-center justify-between text-sm text-[#86868B]"
          >
            <p>
              Showing {firstOnPage}–{lastOnPage} of {matching.length}
            </p>
            <div className="flex items-center gap-2">
              {filter.page > 1 && (
                <Link
                  href={tableHref("/app/work", params, { page: filter.page - 1 })}
                  className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] bg-white font-semibold text-[#1D1D1F]"
                >
                  Previous
                </Link>
              )}
              <span>
                Page {filter.page} of {totalPages}
              </span>
              {filter.page < totalPages && (
                <Link
                  href={tableHref("/app/work", params, { page: filter.page + 1 })}
                  className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] bg-white font-semibold text-[#1D1D1F]"
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
