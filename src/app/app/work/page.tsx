import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  FileCheck2,
  Files,
  Inbox,
  Scale,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayDate } from "@/lib/honest";
import {
  buildWorkQueue,
  countByKind,
  countByPriority,
  filterWorkQueue,
  paginateWorkQueue,
  parseWorkFilter,
  truncatedSources,
  DECISION_ACTIONABLE_STATUSES,
  DOCUMENT_ACTIONABLE_STATUSES,
  EXCEPTION_ACTIONABLE_STATUSES,
  FILING_ACTIONABLE_STATUSES,
  FINDING_ACTIONABLE_STATUSES,
  WORK_KINDS,
  WORK_PRIORITIES,
  type WorkItemKind,
  type WorkPriority,
} from "@/modules/work/workQueue";

export const dynamic = "force-dynamic";

/** Per-source read cap. Reaching it is reported rather than silently absorbed. */
const SOURCE_ROW_CAP = 200;

const KIND_ICONS: Record<WorkItemKind, LucideIcon> = {
  decision: Scale,
  finding: ShieldAlert,
  filing: FileCheck2,
  document: Files,
  exception: TriangleAlert,
};

const KIND_LABELS: Record<WorkItemKind, string> = {
  decision: "Decisions",
  finding: "Findings",
  filing: "Filings",
  document: "Documents",
  exception: "Exceptions",
};

const PRIORITY_LABELS: Record<WorkPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

const PRIORITY_STYLES: Record<WorkPriority, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-800 border-amber-200",
  normal: "bg-[#F5F5F7] text-[#6E6E73] border-[#E5E5EA]",
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

  // Oldest first, so a capped read keeps the items that have waited longest --
  // the same order the queue itself sorts by.
  const oldestFirst = { createdAt: "asc" } as const;

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
      orderBy: oldestFirst,
      take: SOURCE_ROW_CAP,
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
      orderBy: oldestFirst,
      take: SOURCE_ROW_CAP,
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
      orderBy: oldestFirst,
      take: SOURCE_ROW_CAP,
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
      orderBy: oldestFirst,
      take: SOURCE_ROW_CAP,
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
        shipment: { select: { shipmentNumber: true } },
        assignedToUserId: true,
      },
      orderBy: oldestFirst,
      take: SOURCE_ROW_CAP,
    }),
    db.agentDecision.count({ where: decisionWhere }),
    db.complianceFinding.count({ where: findingWhere }),
    db.customsFiling.count({ where: filingWhere }),
    db.shipmentDocument.count({ where: documentWhere }),
    db.exceptionItem.count({ where: exceptionWhere }),
  ]);

  const queue = buildWorkQueue({
    userId: context.userId,
    decisions: decisions.map((d) => ({
      id: d.id,
      agentName: d.agentName,
      decisionSummary: d.decisionSummary,
      status: d.status,
      createdAt: d.createdAt,
      shipmentId: d.shipmentId,
      shipmentNumber: d.shipment?.shipmentNumber ?? null,
    })),
    findings,
    filings: filings.map((f) => ({
      id: f.id,
      entryNumber: f.entryNumber,
      filingStatus: f.filingStatus,
      createdAt: f.createdAt,
      shipmentNumber: f.shipment?.shipmentNumber ?? null,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      status: d.status,
      createdAt: d.createdAt,
      shipmentId: d.shipmentId,
      shipmentNumber: d.shipment?.shipmentNumber ?? null,
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      severity: e.severity,
      status: e.status,
      createdAt: e.createdAt,
      shipmentId: e.shipmentId,
      shipmentNumber: e.shipment?.shipmentNumber ?? null,
      assignedToUserId: e.assignedToUserId,
    })),
  });

  const truncated = truncatedSources({
    decision: { loaded: decisions.length, matching: decisionTotal },
    finding: { loaded: findings.length, matching: findingTotal },
    filing: { loaded: filings.length, matching: filingTotal },
    document: { loaded: documents.length, matching: documentTotal },
    exception: { loaded: exceptions.length, matching: exceptionTotal },
  });

  const priorityCounts = countByPriority(queue);
  const kindCounts = countByKind(queue);
  const mineCount = queue.filter((item) => item.assignedToMe).length;

  const matched = filterWorkQueue(queue, filter);
  const rows = paginateWorkQueue(matched, filter);
  const pages = Math.max(1, Math.ceil(matched.length / filter.pageSize));
  const firstRow = matched.length === 0 ? 0 : (filter.page - 1) * filter.pageSize + 1;
  const lastRow = Math.min(filter.page * filter.pageSize, matched.length);
  const hasFilter = Boolean(filter.kind || filter.priority || filter.assignedToMe);

  const buildHref = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    const qs = next.toString();
    return qs ? `/app/work?${qs}` : "/app/work";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1D1D1F]">My Work</h1>
        <p className="text-sm text-[#86868B] mt-1">
          Everything in {context.accountName} that is waiting on a person, oldest first. Items
          assigned to you are raised a level and listed before the rest.
        </p>
      </div>

      {truncated.length > 0 && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          More {truncated.map((kind) => KIND_LABELS[kind].toLowerCase()).join(", ")} are waiting than
          this page reads at once. The counts below cover the first {SOURCE_ROW_CAP} of each source,
          not the whole account.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(
          [
            ["Total waiting", queue.length, null],
            ["Critical", priorityCounts.critical, "critical" as WorkPriority],
            ["High", priorityCounts.high, "high" as WorkPriority],
            ["Assigned to me", mineCount, null],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white border border-[#E5E5EA] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#86868B]">{label}</p>
            <p className="text-2xl font-extrabold text-[#1D1D1F] mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={buildHref({ mine: filter.assignedToMe ? null : "1" })}
            className={`px-3 py-1.5 rounded-full border ${
              filter.assignedToMe ? "border-[#0071E3] text-[#0071E3]" : "border-[#E5E5EA] text-[#6E6E73]"
            }`}
          >
            Assigned to me ({mineCount})
          </Link>
          {WORK_PRIORITIES.map((priority) => (
            <Link
              key={priority}
              href={buildHref({ priority: filter.priority === priority ? null : priority })}
              className={`px-3 py-1.5 rounded-full border ${
                filter.priority === priority
                  ? "border-[#0071E3] text-[#0071E3]"
                  : "border-[#E5E5EA] text-[#6E6E73]"
              }`}
            >
              {PRIORITY_LABELS[priority]} ({priorityCounts[priority]})
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {WORK_KINDS.map((kind) => (
            <Link
              key={kind}
              href={buildHref({ kind: filter.kind === kind ? null : kind })}
              className={`px-3 py-1.5 rounded-full border ${
                filter.kind === kind ? "border-[#0071E3] text-[#0071E3]" : "border-[#E5E5EA] text-[#6E6E73]"
              }`}
            >
              {KIND_LABELS[kind]} ({kindCounts[kind]})
            </Link>
          ))}
          {hasFilter && (
            <Link href="/app/work" className="px-3 py-1.5 text-sm font-semibold text-[#0071E3]">
              Clear
            </Link>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5E5EA] p-10 text-center">
          <Inbox className="w-8 h-8 mx-auto text-[#86868B]" aria-hidden="true" />
          <p className="mt-3 text-sm text-[#6E6E73]">
            {hasFilter
              ? "Nothing in the queue matches these filters."
              : "Nothing is waiting on a person right now."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-start gap-4 rounded-2xl bg-white border border-[#E5E5EA] p-4 hover:border-[#0071E3] transition-colors"
                >
                  <span className="mt-0.5 shrink-0 text-[#86868B]">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#1D1D1F]">{item.title}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                          PRIORITY_STYLES[item.priority]
                        }`}
                      >
                        {PRIORITY_LABELS[item.priority]}
                      </span>
                      {item.assignedToMe && (
                        <span className="px-2 py-0.5 rounded-full border border-[#0071E3] text-[11px] font-semibold text-[#0071E3]">
                          Yours
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-[#6E6E73] mt-1 line-clamp-2" title={item.reason}>
                      {item.reason}
                    </span>
                    <span className="block text-xs text-[#86868B] mt-1">
                      {item.shipmentNumber ? `${item.shipmentNumber} · ` : ""}
                      Waiting since {displayDate(item.createdAt)}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-[#86868B] mt-1" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {matched.length > 0 && (
        <div className="flex items-center justify-between text-sm text-[#6E6E73]">
          <span>
            Showing {firstRow}-{lastRow} of {matched.length}
          </span>
          <span className="flex items-center gap-2">
            {filter.page > 1 && (
              <Link
                href={buildHref({ page: String(filter.page - 1) }, true)}
                className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] font-semibold"
              >
                Previous
              </Link>
            )}
            {filter.page < pages && (
              <Link
                href={buildHref({ page: String(filter.page + 1) }, true)}
                className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] font-semibold"
              >
                Next
              </Link>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
