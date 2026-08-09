import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { FileCheck2, AlertCircle, Info, CheckCircle2, Circle, Ban } from "lucide-react";
import { filingStages, isTerminal, type FilingStageState } from "@/modules/filings/filingStateMachine";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { displayCurrency, displayDate, displayText, NOT_CALCULATED, NOT_PROVIDED } from "@/lib/honest";
import { entryTypeLabel } from "@/modules/filing/entryType";
import { MockCustomsTransmissionProvider } from "@/lib/providers";
import { pageCount, parseTableQuery, tableHref, tableSkip } from "@/modules/tables/tableQuery";
import { FilingActions } from "./FilingActions";

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-[#F5F5F7] text-[#1D1D1F] border-[#E5E5EA]",
  Preparing: "bg-[#F5F5F7] text-[#1D1D1F] border-[#E5E5EA]",
  ValidationFailed: "bg-red-50 text-red-700 border-red-200",
  ReadyForBrokerReview: "bg-amber-50 text-amber-700 border-amber-200",
  BrokerApproved: "bg-blue-50 text-[#0071E3] border-blue-200",
  TransmissionPending: "bg-blue-50 text-[#0071E3] border-blue-200",
  Transmitted: "bg-blue-50 text-[#0071E3] border-blue-200",
  Accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Rejected: "bg-red-50 text-red-700 border-red-200",
  DocumentsRequested: "bg-amber-50 text-amber-700 border-amber-200",
  CustomsHold: "bg-red-50 text-red-700 border-red-200",
  Released: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Cancelled: "bg-[#F5F5F7] text-[#86868B] border-[#E5E5EA]",
  Closed: "bg-[#F5F5F7] text-[#86868B] border-[#E5E5EA]",
  Simulation: "bg-purple-50 text-purple-700 border-purple-200",
};

const STAGE_STYLE: Record<FilingStageState, string> = {
  complete: "border-emerald-500 bg-emerald-50 text-emerald-800",
  current: "border-[#0071E3] bg-blue-50 text-blue-900",
  blocked: "border-red-300 bg-red-50 text-red-800",
  pending: "border-[#E5E5EA] bg-[#F5F5F7] text-[#86868B]",
};

const STAGE_LABEL: Record<FilingStageState, string> = {
  complete: "Complete",
  current: "In progress",
  blocked: "Blocked",
  pending: "Not started",
};

interface DutyLine {
  feeName: string;
  amount: number;
  rate: string;
}

function parseDutyBreakdown(value: unknown): DutyLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (line): line is DutyLine =>
      typeof line === "object" &&
      line !== null &&
      typeof (line as DutyLine).feeName === "string" &&
      typeof (line as DutyLine).amount === "number"
  );
}

export default async function CustomsFilingPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  const filingId = params.get("filingId") ?? undefined;
  const shipmentId = params.get("shipmentId") ?? undefined;
  const context = await getAccountContext();
  if (!context) return null;

  // The selector used to show the newest 50 entries with no way to reach the
  // rest and no indication that anything had been left out.
  const listQuery = parseTableQuery(
    params,
    { columns: ["createdAt", "entryNumber", "filingStatus"], fallback: "createdAt" },
    { pageSizeDefault: 25 }
  );
  const statusFilter = params.get("status")?.trim() || null;
  const listWhere = {
    accountId: context.accountId,
    ...(listQuery.search
      ? { entryNumber: { contains: listQuery.search, mode: "insensitive" as const } }
      : {}),
    ...(statusFilter ? { filingStatus: statusFilter } : {}),
  };

  const [filings, filingTotal, statusGroups] = await Promise.all([
    db.customsFiling.findMany({
      where: listWhere,
      select: { id: true, entryNumber: true, filingStatus: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      skip: tableSkip(listQuery),
      take: listQuery.pageSize,
    }),
    db.customsFiling.count({ where: listWhere }),
    db.customsFiling.groupBy({
      by: ["filingStatus"],
      where: { accountId: context.accountId },
      orderBy: { filingStatus: "asc" },
    }),
  ]);

  const listPages = pageCount(filingTotal, listQuery.pageSize);
  const listFirst = filingTotal === 0 ? 0 : tableSkip(listQuery) + 1;
  const listLast = Math.min(tableSkip(listQuery) + listQuery.pageSize, filingTotal);
  const hasListFilter = Boolean(listQuery.search || statusFilter);

  // Arriving from a shipment selects that shipment's filing. Falling back to the
  // newest filing would show a different shipment's entry under its heading.
  const requestedShipment = shipmentId
    ? await db.shipment.findFirst({
        where: { id: shipmentId, accountId: context.accountId, deletedAt: null },
        select: { id: true, shipmentNumber: true },
      })
    : null;

  const shipmentFilingId = requestedShipment
    ? (
        await db.customsFiling.findFirst({
          where: { shipmentId: requestedShipment.id, accountId: context.accountId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const selectedId = shipmentId
    ? shipmentFilingId
    : filingId ?? filings[0]?.id;

  const filing = selectedId
    ? await db.customsFiling.findFirst({
        where: { id: selectedId, accountId: context.accountId },
        include: {
          shipment: { select: { id: true, shipmentNumber: true, lineItems: true } },
          responses: { orderBy: { receivedAt: "desc" } },
        },
      })
    : null;

  const filingLineItems = filing?.shipment.lineItems ?? [];
  const unratedLineCount =
    filingLineItems.length === 0
      ? 0
      : computeFilingTariff(filingLineItems, await loadHtsCodesMap(filingLineItems)).unratedLineCount;

  const dutyBreakdown = parseDutyBreakdown(filing?.dutyBreakdown);
  const stages = filing ? filingStages(filing.filingStatus) : [];

  // The service transmits through this provider, so the page names the same one
  // rather than describing transmission in the abstract.
  const transmissionProvider = new MockCustomsTransmissionProvider();
  const transmissionProviderName = "MockCustomsTransmissionProvider (Sandbox)";

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-5 h-5 text-[#0071E3]" />
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Customs Filing</h1>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            Entry summary preparation and CBP response tracking
          </p>
        </div>

        {/* The endpoints behind these exist, so the buttons run them. Only the
            transmission is a simulation, and it says so rather than being
            rendered as a disabled control that explains nothing. */}
        {filing ? (
          <FilingActions
            filingId={filing.id}
            filingStatus={filing.filingStatus}
            isSimulatedTransmission={transmissionProvider.isMockProvider()}
            providerName={transmissionProviderName}
          />
        ) : (
          <p className="text-sm text-[#6E6E73]">
            Select a filing to export its entry summary or transmit it.
          </p>
        )}
      </div>

      {!filing ? (
        <div className="bg-white p-12 rounded-2xl border border-[#E5E5EA] text-center space-y-3">
          <FileCheck2 className="w-10 h-10 mx-auto text-[#86868B]/40" aria-hidden="true" />
          <div>
            {requestedShipment ? (
              <>
                <p className="text-sm font-bold text-[#1D1D1F]">
                  No filing exists for shipment {requestedShipment.shipmentNumber}
                </p>
                <p className="text-xs text-[#6E6E73] mt-1">
                  A filing is created once this shipment has line items ready to declare.
                </p>
              </>
            ) : shipmentId ? (
              <>
                <p className="text-sm font-bold text-[#1D1D1F]">Shipment not found</p>
                <p className="text-xs text-[#6E6E73] mt-1">
                  That shipment does not exist in this workspace.
                </p>
              </>
            ) : hasListFilter ? (
              <>
                <p className="text-sm font-bold text-[#1D1D1F]">No filing matches this search</p>
                <p className="text-xs text-[#6E6E73] mt-1">
                  This account has filings, but none match the entry number or status you asked for.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-[#1D1D1F]">No customs filings yet</p>
                <p className="text-xs text-[#6E6E73] mt-1">
                  A filing is created once a shipment has line items ready to declare.
                </p>
              </>
            )}
          </div>
          <Link
            href={
              requestedShipment
                ? `/app/shipments/${requestedShipment.id}`
                : hasListFilter
                  ? "/app/filing"
                  : "/app/shipments"
            }
            className="inline-block px-4 py-2 rounded-xl bg-[#0071E3] text-white text-xs font-semibold"
          >
            {requestedShipment ? "Back to shipment" : hasListFilter ? "Clear search" : "Go to shipments"}
          </Link>
        </div>
      ) : (
        <>
          {filingTotal > 1 && (
            <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] space-y-3">
              <form action="/app/filing" method="get" className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="filing-search" className="text-sm font-semibold text-[#1D1D1F]">
                    Entry number
                  </label>
                  <input
                    id="filing-search"
                    name="q"
                    type="search"
                    defaultValue={listQuery.search ?? ""}
                    placeholder="Part of an entry number"
                    className="px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm w-56"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="filing-status" className="text-sm font-semibold text-[#1D1D1F]">
                    Status
                  </label>
                  <select
                    id="filing-status"
                    name="status"
                    defaultValue={statusFilter ?? ""}
                    className="px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm w-56"
                  >
                    <option value="">Any status</option>
                    {statusGroups.map((group) => (
                      <option key={group.filingStatus} value={group.filingStatus}>
                        {group.filingStatus}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0071E3] text-white text-sm font-semibold"
                >
                  Search
                </button>
                {hasListFilter && (
                  <Link href="/app/filing" className="px-3 py-2 text-sm font-semibold text-[#0071E3]">
                    Clear
                  </Link>
                )}
              </form>

              <nav aria-label="Filings" className="flex flex-wrap gap-2">
                {filings.map((f) => (
                  <Link
                    key={f.id}
                    href={tableHref("/app/filing", params, { filingId: f.id, shipmentId: null })}
                    aria-current={f.id === filing.id ? "page" : undefined}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      f.id === filing.id
                        ? "bg-[#0071E3] text-white border-[#0071E3]"
                        : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:bg-[#F5F5F7]"
                    }`}
                  >
                    <span className="font-mono">{f.entryNumber}</span>
                    <span className="opacity-70"> · {f.filingStatus}</span>
                  </Link>
                ))}
              </nav>

              <div className="flex items-center justify-between text-sm text-[#6E6E73]">
                <p>
                  Showing {listFirst}–{listLast} of {filingTotal}
                  {hasListFilter ? " matching filings" : " filings"}
                </p>
                <div className="flex items-center gap-2">
                  {listQuery.page > 1 && (
                    <Link
                      href={tableHref("/app/filing", params, { page: listQuery.page - 1 })}
                      className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] font-semibold text-[#1D1D1F]"
                    >
                      Previous
                    </Link>
                  )}
                  <span>
                    Page {listQuery.page} of {listPages}
                  </span>
                  {listQuery.page < listPages && (
                    <Link
                      href={tableHref("/app/filing", params, { page: listQuery.page + 1 })}
                      className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] font-semibold text-[#1D1D1F]"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>

              {!filings.some((f) => f.id === filing.id) && (
                <p role="status" className="text-sm text-[#6E6E73]">
                  Entry {filing.entryNumber} is open below but is not on this page of results.
                </p>
              )}
            </div>
          )}

          {filing.filingStatus === "Simulation" && (
            <div className="flex items-start gap-2 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-xs text-purple-900">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p>
                This entry was produced by a simulated filing run. Nothing was transmitted to CBP and
                no figure here reflects a real customs decision.
              </p>
            </div>
          )}

          <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Filing progress</h2>
            <ol className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              {stages.map((stage, index) => (
                <li key={stage.key} className={`p-4 rounded-xl border ${STAGE_STYLE[stage.state]} space-y-1`}>
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm">Step {index + 1}</span>
                    {stage.state === "complete" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : stage.state === "blocked" ? (
                      <Ban className="w-3.5 h-3.5" />
                    ) : (
                      <Circle className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <p className="font-bold text-[#1D1D1F]">{stage.label}</p>
                  <p className="text-[11px] uppercase font-bold tracking-wider">{STAGE_LABEL[stage.state]}</p>
                </li>
              ))}
            </ol>
            <p className="text-sm text-[#86868B]">
              Derived from the filing status. Steps that have not happened are shown as not started.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6">
                <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                      Entry summary: <span className="font-mono">{filing.entryNumber}</span>
                    </h3>
                    <p className="text-xs text-[#86868B]">
                      Filing authority: {displayText(filing.authority)}
                      {filing.shipment?.shipmentNumber && (
                        <>
                          {" · "}
                          <Link
                            href={`/app/shipments/${filing.shipmentId}`}
                            className="font-mono text-[#0071E3] hover:underline"
                          >
                            {filing.shipment.shipmentNumber}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold border ${
                      STATUS_STYLE[filing.filingStatus] ?? "bg-[#F5F5F7] text-[#1D1D1F] border-[#E5E5EA]"
                    }`}
                  >
                    {filing.filingStatus}
                    {isTerminal(filing.filingStatus) && " (final)"}
                  </span>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <dt className="text-[#86868B]">Entry type</dt>
                    <dd className="font-bold text-[#1D1D1F]">{entryTypeLabel(filing.entryType, NOT_PROVIDED)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#86868B]">Filing method</dt>
                    <dd className="font-bold text-[#1D1D1F]">{displayText(filing.filingType)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#86868B]">Payment status</dt>
                    <dd className="font-bold text-[#1D1D1F]">{displayText(filing.paymentStatus)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#86868B]">Entered value</dt>
                    <dd className="font-bold text-[#1D1D1F]">
                      {filing.totalValue === null ? NOT_CALCULATED : displayCurrency(filing.totalValue.toString())}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#86868B]">Submitted</dt>
                    <dd className="font-bold text-[#1D1D1F]">{displayDate(filing.submittedAt, "Not submitted")}</dd>
                  </div>
                  <div>
                    <dt className="text-[#86868B]">Released</dt>
                    <dd className="font-bold text-[#1D1D1F]">{displayDate(filing.releasedAt, "Not released")}</dd>
                  </div>
                </dl>

                <div className="space-y-3 pt-3 border-t border-[#E5E5EA]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                    Duty &amp; tax breakdown
                  </h4>

                  {unratedLineCount > 0 ? (
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        {unratedLineCount} of {filingLineItems.length} line
                        {filingLineItems.length === 1 ? "" : "s"} has no published duty rate. The totals
                        below exclude those lines and understate the duty owed. This entry cannot be
                        transmitted until every line is classified.
                      </p>
                    </div>
                  ) : null}

                  {dutyBreakdown.length === 0 ? (
                    <div className="flex items-start gap-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] p-4 text-xs text-[#86868B]">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        No duty calculation has been run for this entry. Rates depend on the classified
                        HTS lines and are not estimated here.
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E5E5EA] text-[#86868B]">
                          <th scope="col" className="pb-2">Fee item</th>
                          <th scope="col" className="pb-2">Rate</th>
                          <th scope="col" className="pb-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E5EA]">
                        {dutyBreakdown.map((duty, idx) => (
                          <tr key={`${duty.feeName}-${idx}`} className="hover:bg-[#F5F5F7]">
                            <td className="py-2.5 font-semibold text-[#1D1D1F]">{duty.feeName}</td>
                            <td className="py-2.5 text-[#86868B]">{displayText(duty.rate)}</td>
                            <td className="py-2.5 text-right font-bold text-[#1D1D1F]">
                              {displayCurrency(duty.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="flex justify-end pt-3 border-t border-[#E5E5EA] text-xs text-right">
                    <dl className="space-y-1">
                      <div>
                        <dt className="inline text-[#86868B]">Total duties: </dt>
                        <dd className="inline font-bold text-[#1D1D1F]">
                          {filing.totalDuties === null ? NOT_CALCULATED : displayCurrency(filing.totalDuties.toString())}
                          {unratedLineCount > 0 && filing.totalDuties !== null ? " (incomplete)" : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-[#86868B]">Total taxes: </dt>
                        <dd className="inline font-bold text-[#1D1D1F]">
                          {filing.totalTaxes === null ? NOT_CALCULATED : displayCurrency(filing.totalTaxes.toString())}
                        </dd>
                      </div>
                      <div className="font-extrabold text-sm text-[#0071E3] mt-1">
                        <dt className="inline">Total due: </dt>
                        <dd className="inline">
                          {filing.totalAmount === null ? NOT_CALCULATED : displayCurrency(filing.totalAmount.toString())}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">CBP responses</h3>

                {filing.responses.length === 0 ? (
                  <p className="text-xs text-[#86868B] py-6 text-center">
                    No responses received for this entry.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {filing.responses.map((resp) => (
                      <li
                        key={resp.id}
                        className="p-3.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#1D1D1F]">{resp.title}</span>
                          <span className="text-sm font-bold px-2 py-0.5 rounded-full border bg-white text-[#1D1D1F] border-[#E5E5EA] font-mono shrink-0">
                            {resp.code}
                          </span>
                        </div>
                        <p className="text-sm text-[#86868B]">{resp.description}</p>
                        <p className="text-sm text-[#86868B]">{displayDate(resp.receivedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
