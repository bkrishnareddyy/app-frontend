import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, AlertTriangle, Inbox } from "lucide-react";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { db } from "@/lib/db";
import { displayDate, displayText } from "@/lib/honest";
import {
  EXCEPTION_STATES,
  RISK_ACCEPTANCE_PERMISSION,
  exceptionStatusLabel,
  normalizeExceptionStatus,
  openStatusVariants,
  statusVariants,
} from "@/modules/exceptions/exceptionState";
import { UNASSIGNED_INTAKE_TYPE } from "@/modules/intake/unassignedIntake";
import { ExceptionActions } from "./ExceptionActions";
import { buildOrderBy, pageCount, parseTableQuery, tableHref, tableSkip } from "@/modules/tables/tableQuery";

export const dynamic = "force-dynamic";

const SEVERITIES = ["Critical", "High", "Medium", "Low"];

const PRESERVED_ON_SEARCH = ["mine", "unassigned", "shipmentId", "sort", "dir", "pageSize"] as const;

const exceptionSelect = {
  id: true,
  type: true,
  severity: true,
  description: true,
  status: true,
  version: true,
  createdAt: true,
  resolvedAt: true,
  shipmentId: true,
  filingId: true,
  shipment: { select: { id: true, shipmentNumber: true } },
  assignedToUser: { select: { firstName: true, lastName: true, email: true } },
} as const;

type ExceptionRecord = {
  id: string;
  type: string;
  severity: string;
  description: string;
  status: string;
  version: number;
  createdAt: Date;
  resolvedAt: Date | null;
  shipmentId: string | null;
  filingId: string | null;
  shipment: { id: string; shipmentNumber: string } | null;
  assignedToUser: { firstName: string | null; lastName: string | null; email: string } | null;
};

export default async function ExceptionsPage(props: {
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

  const query = parseTableQuery(
    params,
    {
      columns: ["createdAt", "severity", "status", "type"],
      fallback: "createdAt",
      fallbackDirection: "desc",
    },
    { pageSizeDefault: 25 }
  );

  const rawStatus = params.get("status")?.trim() || "open";
  const normalizedStatus = normalizeExceptionStatus(rawStatus);
  const severityFilter = SEVERITIES.find((s) => s.toLowerCase() === params.get("severity")?.toLowerCase()) ?? null;
  const mineOnly = params.get("mine") === "1";
  const unassignedOnly = params.get("unassigned") === "1";
  const shipmentFilter = params.get("shipmentId")?.trim() || null;

  const statusWhere =
    rawStatus === "all"
      ? undefined
      : normalizedStatus
        ? { in: statusVariants(normalizedStatus) }
        : { in: openStatusVariants() };

  const where = {
    accountId: context.accountId,
    ...(statusWhere ? { status: statusWhere } : {}),
    ...(severityFilter ? { severity: severityFilter } : {}),
    ...(mineOnly ? { assignedToUserId: context.userId } : {}),
    ...(unassignedOnly ? { shipmentId: null } : shipmentFilter ? { shipmentId: shipmentFilter } : {}),
    ...(query.search
      ? {
          OR: [
            { description: { contains: query.search, mode: "insensitive" as const } },
            { type: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [pageRows, total, unassignedCount] = await Promise.all([
    db.exceptionItem.findMany({
      where,
      select: exceptionSelect,
      orderBy: buildOrderBy(query),
      skip: tableSkip(query),
      take: query.pageSize,
    }),
    db.exceptionItem.count({ where }),
    db.exceptionItem.count({
      where: {
        accountId: context.accountId,
        shipmentId: null,
        status: { in: openStatusVariants() },
      },
    }),
  ]);

  const requestedId = params.get("exceptionId");
  let rows: ExceptionRecord[] = pageRows;
  let requestedMissing = false;
  if (requestedId && !pageRows.some((row) => row.id === requestedId)) {
    const requested = await db.exceptionItem.findFirst({
      where: { id: requestedId, accountId: context.accountId },
      select: exceptionSelect,
    });
    if (requested) rows = [requested, ...pageRows];
    else requestedMissing = true;
  }

  const pages = pageCount(total, query.pageSize);
  const first = total === 0 ? 0 : tableSkip(query) + 1;
  const last = Math.min(tableSkip(query) + query.pageSize, total);
  const hasFilter = Boolean(
    query.search || severityFilter || mineOnly || unassignedOnly || shipmentFilter || rawStatus !== "open"
  );

  const href = (patch: Record<string, string | number | null>) =>
    tableHref("/app/exceptions", params, { ...patch, page: null });

  const writable = canWrite(context);
  const mayWaive = writable && (await hasPermission(RISK_ACCEPTANCE_PERMISSION));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1D1D1F]">Exceptions</h1>
        <p className="text-sm text-[#86868B] mt-1">
          Every stored exception in {context.accountName}, including intake that arrived without a
          shipment to file it against.
        </p>
      </div>

      {requestedMissing && (
        <div
          role="status"
          className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900"
        >
          The exception this link points to is not in this account. It may have been removed. The
          list below is showing everything else.
        </div>
      )}

      {unassignedCount > 0 && !unassignedOnly && (
        <div
          role="status"
          className="rounded-2xl bg-white border border-[#E5E5EA] p-4 text-sm text-[#1D1D1F] flex items-center justify-between gap-4"
        >
          <span>
            {unassignedCount} open {unassignedCount === 1 ? "exception has" : "exceptions have"} no
            shipment attached and cannot move forward until someone names the target.
          </span>
          <Link
            href={href({ unassigned: "1" })}
            className="shrink-0 text-sm font-semibold text-[#0071E3] hover:underline"
          >
            Show them
          </Link>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-[#E5E5EA] p-4 space-y-4">
        <form action="/app/exceptions" method="get" className="flex flex-wrap items-end gap-3">
          {/* A GET form replaces the whole query string, so the chips and sort state
              have to ride along or searching silently clears them. */}
          {PRESERVED_ON_SEARCH.map((key) => {
            const value = params.get(key);
            return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
          })}
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="exception-search" className="block text-xs font-semibold text-[#86868B] mb-1">
              Search description or type
            </label>
            <input
              id="exception-search"
              name="q"
              type="search"
              defaultValue={query.search ?? ""}
              className="w-full h-10 px-3 rounded-xl border border-[#E5E5EA] text-sm"
            />
          </div>
          <div>
            <label htmlFor="exception-status" className="block text-xs font-semibold text-[#86868B] mb-1">
              Status
            </label>
            <select
              id="exception-status"
              name="status"
              defaultValue={rawStatus}
              className="h-10 px-3 rounded-xl border border-[#E5E5EA] text-sm bg-white"
            >
              <option value="open">Open</option>
              <option value="all">All</option>
              {EXCEPTION_STATES.map((state) => (
                <option key={state} value={state}>
                  {exceptionStatusLabel(state)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exception-severity" className="block text-xs font-semibold text-[#86868B] mb-1">
              Severity
            </label>
            <select
              id="exception-severity"
              name="severity"
              defaultValue={severityFilter ?? ""}
              className="h-10 px-3 rounded-xl border border-[#E5E5EA] text-sm bg-white"
            >
              <option value="">Any</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-xl bg-[#0071E3] text-white text-sm font-semibold"
          >
            Search
          </button>
          {hasFilter && (
            <Link href="/app/exceptions" className="h-10 px-3 flex items-center text-sm font-semibold text-[#0071E3]">
              Clear
            </Link>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={href({ mine: mineOnly ? null : "1" })}
            className={`px-3 py-1.5 rounded-full border ${
              mineOnly ? "border-[#0071E3] text-[#0071E3]" : "border-[#E5E5EA] text-[#6E6E73]"
            }`}
          >
            Assigned to me
          </Link>
          <Link
            href={href({ unassigned: unassignedOnly ? null : "1" })}
            className={`px-3 py-1.5 rounded-full border ${
              unassignedOnly ? "border-[#0071E3] text-[#0071E3]" : "border-[#E5E5EA] text-[#6E6E73]"
            }`}
          >
            No shipment attached
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#E5E5EA] p-10 text-center">
          <Inbox className="w-8 h-8 mx-auto text-[#86868B]" aria-hidden="true" />
          <p className="mt-3 text-sm text-[#6E6E73]">
            {hasFilter
              ? "No exception matches these filters."
              : "No open exceptions are recorded for this account."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const severe = row.severity === "Critical" || row.severity === "High";
            const Icon = severe ? AlertCircle : AlertTriangle;
            const assignee = row.assignedToUser
              ? [row.assignedToUser.firstName, row.assignedToUser.lastName]
                  .filter(Boolean)
                  .join(" ") || row.assignedToUser.email
              : null;
            return (
              <li
                key={row.id}
                id={row.id === requestedId ? "requested-exception" : undefined}
                className={`rounded-2xl bg-white border p-5 space-y-2 ${
                  row.id === requestedId ? "border-[#0071E3]" : "border-[#E5E5EA]"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[#1D1D1F]">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${severe ? "text-red-500" : "text-amber-500"}`}
                    aria-hidden="true"
                  />
                  <span>
                    {row.severity} · {row.type.replace(/_/g, " ")}
                  </span>
                  <span className="ml-auto text-xs font-semibold uppercase tracking-wider text-[#86868B]">
                    {exceptionStatusLabel(row.status)}
                  </span>
                </div>

                <p className="text-sm text-[#6E6E73]">{displayText(row.description)}</p>

                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#6E6E73]">
                  <div className="flex gap-1">
                    <dt>Opened</dt>
                    <dd className="text-[#1D1D1F]">{displayDate(row.createdAt)}</dd>
                  </div>
                  {row.resolvedAt && (
                    <div className="flex gap-1">
                      <dt>Closed</dt>
                      <dd className="text-[#1D1D1F]">{displayDate(row.resolvedAt)}</dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt>Assigned to</dt>
                    <dd className="text-[#1D1D1F]">{assignee ?? "Nobody"}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Shipment</dt>
                    <dd className="text-[#1D1D1F]">
                      {row.shipment ? (
                        <Link
                          href={`/app/shipments/${row.shipment.id}#exceptions`}
                          className="font-semibold text-[#0071E3] hover:underline"
                        >
                          {row.shipment.shipmentNumber}
                        </Link>
                      ) : row.type === UNASSIGNED_INTAKE_TYPE ? (
                        "None. The upload named no shipment and none could be inferred."
                      ) : (
                        "None"
                      )}
                    </dd>
                  </div>
                  {row.filingId && (
                    <div className="flex gap-1">
                      <dt>Filing</dt>
                      <dd>
                        <Link
                          href={`/app/filing?filingId=${encodeURIComponent(row.filingId)}`}
                          className="font-semibold text-[#0071E3] hover:underline"
                        >
                          Open filing
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>

                <ExceptionActions
                  exceptionId={row.id}
                  version={row.version}
                  status={row.status}
                  hasShipment={row.shipmentId !== null}
                  canWrite={writable}
                  canWaive={mayWaive}
                  waivePermission={RISK_ACCEPTANCE_PERMISSION}
                  readOnlyMessage={READ_ONLY_MESSAGE}
                />
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <nav
          aria-label="Exception pages"
          className="flex items-center justify-between text-sm text-[#6E6E73]"
        >
          <span>
            Showing {first}–{last} of {total}
          </span>
          <span className="flex items-center gap-4">
            {query.page > 1 && (
              <Link
                href={tableHref("/app/exceptions", params, { page: query.page - 1 })}
                className="font-semibold text-[#0071E3]"
              >
                Previous
              </Link>
            )}
            {query.page < pages && (
              <Link
                href={tableHref("/app/exceptions", params, { page: query.page + 1 })}
                className="font-semibold text-[#0071E3]"
              >
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
