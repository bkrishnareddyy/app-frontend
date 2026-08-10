import Link from "next/link";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Package,
  Plus,
  Search,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowRight,
  User,
} from "lucide-react";
import { displayText, NOT_PROVIDED } from "@/lib/honest";
import { computeReadinessScore } from "@/lib/shipmentReadiness";
import { entryTypeLabel } from "@/modules/filing/entryType";
import {
  buildShipmentOrderBy,
  buildShipmentWhere,
  parseShipmentQuery,
  shipmentSkip,
} from "@/modules/shipments/shipmentQuery";
import { type ColumnSpec, resetPage, tableHref, visibleColumns } from "@/modules/tables/tableQuery";
import { SortableHeader } from "@/components/table/SortableHeader";
import { TablePagination } from "@/components/table/TablePagination";
import { SavedViews } from "@/components/table/SavedViews";
import { ColumnChooser } from "@/components/table/ColumnChooser";
import { ClientFilter } from "@/components/table/ClientFilter";

const BASE_PATH = "/app/shipments";

type ShipmentColumnId =
  | "shipmentNumber"
  | "importerName"
  | "client"
  | "entryType"
  | "portOfEntry"
  | "readinessScore"
  | "status"
  | "owner"
  | "updatedAt";

const SHIPMENT_COLUMNS: ReadonlyArray<ColumnSpec<ShipmentColumnId>> = [
  { id: "shipmentNumber", label: "Shipment #", sortable: true },
  { id: "importerName", label: "Importer of Record", sortable: true },
  { id: "client", label: "Client" },
  { id: "entryType", label: "Entry Type / PO" },
  { id: "portOfEntry", label: "Port & Mode", sortable: true },
  // Readiness is computed per row rather than read from the stored column, so
  // there is no persisted value to sort on.
  { id: "readinessScore", label: "Readiness" },
  { id: "status", label: "Status", sortable: true },
  { id: "updatedAt", label: "Last Updated", sortable: true, optional: true },
];

const OWNER_COLUMN: ColumnSpec<ShipmentColumnId> = { id: "owner", label: "Owner" };

const STATUS_FILTERS = [
  "In Progress",
  "Ready to File",
  "On Hold",
  "Submitted",
  "Completed",
] as const;

function brokerName(broker: { firstName: string | null; lastName: string | null; email: string }) {
  const name = `${broker.firstName ?? ""} ${broker.lastName ?? ""}`.trim();
  return name || broker.email;
}

export default async function ShipmentsConsolePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await props.searchParams;
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  const isEnterpriseAdmin =
    ctx.accountType === "ENTERPRISE" &&
    (ctx.roleNames.includes("ADMIN") || ctx.roleNames.includes("OWNER"));

  // Assignment is only actionable for an admin who can see the whole team.
  const columnSpecs: ReadonlyArray<ColumnSpec<ShipmentColumnId>> = isEnterpriseAdmin
    ? [
        ...SHIPMENT_COLUMNS.slice(0, -1),
        OWNER_COLUMN,
        SHIPMENT_COLUMNS[SHIPMENT_COLUMNS.length - 1],
      ]
    : SHIPMENT_COLUMNS;

  const query = parseShipmentQuery(params);
  const search = query.search ?? "";
  const columns = visibleColumns(params.get("cols"), columnSpecs);
  const shows = (id: ShipmentColumnId) => columns.includes(id);

  const where = buildShipmentWhere(ctx.accountId, query);

  const [shipments, matchCount] = await Promise.all([
    db.shipment.findMany({
      where,
      orderBy: buildShipmentOrderBy(query),
      skip: shipmentSkip(query),
      take: query.pageSize,
      include: {
        // Only the fields the readiness calculation and the Owner column read.
        documents: { select: { docType: true, status: true } },
        lineItems: {
          select: { htsCode: true, countryOfOrigin: true, quantity: true, unitPrice: true },
        },
        exceptionItems: { select: { status: true, severity: true } },
        assignedBroker: { select: { firstName: true, lastName: true, email: true } },
        client: { select: { id: true, name: true } },
      },
    }),
    db.shipment.count({ where }),
  ]);

  const clients = await db.client.findMany({
    where: { accountId: ctx.accountId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // KPIs cover the whole workspace, so a search does not silently shrink them.
  const allForCounts = await db.shipment.findMany({
    where: { accountId: ctx.accountId, deletedAt: null },
    select: { status: true, healthStatus: true },
  });

  // Each tile links to the filter that produces exactly its own count, so the
  // number on the card and the number of rows after clicking it cannot differ.
  const totalCount = allForCounts.length;
  const inProgressCount = allForCounts.filter((s) => s.status === "In Progress").length;
  const readyCount = allForCounts.filter((s) => s.status === "Ready to File").length;
  const criticalCount = allForCounts.filter((s) => s.healthStatus === "Critical").length;

  const kpis = [
    {
      label: "Total Shipments",
      caption: "Active in workspace",
      count: totalCount,
      icon: Package,
      iconClass: "text-[#0071E3]",
      captionClass: "text-[#86868B]",
      href: tableHref(BASE_PATH, params, resetPage({ status: null, health: null })),
      active: !query.status && !query.health,
    },
    {
      label: "In Progress",
      caption: "Under agent review",
      count: inProgressCount,
      icon: Clock,
      iconClass: "text-amber-500",
      captionClass: "text-amber-600",
      href: tableHref(BASE_PATH, params, resetPage({ status: "In Progress", health: null })),
      active: query.status === "In Progress",
    },
    {
      label: "Ready to File",
      caption: "Cleared for filing",
      count: readyCount,
      icon: ShieldCheck,
      iconClass: "text-emerald-600",
      captionClass: "text-emerald-600",
      href: tableHref(BASE_PATH, params, resetPage({ status: "Ready to File", health: null })),
      active: query.status === "Ready to File",
    },
    {
      label: "Critical Health",
      caption: "Attention required",
      count: criticalCount,
      icon: AlertTriangle,
      iconClass: "text-red-500",
      captionClass: "text-red-500",
      href: tableHref(BASE_PATH, params, resetPage({ health: "Critical", status: null })),
      active: query.health === "Critical",
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#0071E3]/10 text-[#0071E3]">
              Shipment Operations Console
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1D1D1F] mt-1">Shipment Workbench</h1>
          <p className="text-xs text-[#86868B]">
            Active shipment management, document intake status, and readiness tracking for <strong className="text-[#1D1D1F]">{ctx.accountName}</strong>.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/app/shipments/new"
            className="px-4 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-2"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Add Shipment</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, caption, count, icon: Icon, iconClass, captionClass, href, active }) => (
          <Link
            key={label}
            href={href}
            aria-current={active ? "true" : undefined}
            className={`block bg-white p-5 rounded-2xl border shadow-2xs transition-colors hover:bg-[#F5F5F7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3] ${
              active ? "border-[#0071E3] ring-1 ring-[#0071E3]" : "border-[#E5E5EA]"
            }`}
          >
            <div className="flex items-center justify-between text-xs text-[#6E6E73] mb-2">
              <span>{label}</span>
              <Icon className={`w-4 h-4 ${iconClass}`} aria-hidden="true" />
            </div>
            <p className="text-2xl font-bold text-[#1D1D1F]">{count}</p>
            <p className={`text-xs mt-1 ${captionClass}`}>{caption}</p>
          </Link>
        ))}
      </div>

      {/* Main Table Section */}
      <div className="bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs overflow-hidden">
        {/* Table Header Bar */}
        <div className="p-4 md:p-5 border-b border-[#E5E5EA] space-y-3 bg-[#FAF9F6]/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-[#1D1D1F]">
                {search ? `Results for "${search}"` : "All Shipments"}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#E5E5EA] text-[#1D1D1F]">
                {matchCount}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <form method="GET" action={BASE_PATH} className="relative">
                <label htmlFor="shipment-search" className="sr-only">
                  Search shipments
                </label>
                <Search
                  className="w-3.5 h-3.5 text-[#6E6E73] absolute left-3 top-2.5"
                  aria-hidden="true"
                />
                <input
                  id="shipment-search"
                  type="search"
                  name="q"
                  defaultValue={search}
                  placeholder="Search shipment, importer, PO, port..."
                  className="pl-8 pr-3 py-1.5 bg-white border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] w-64 focus:outline-hidden focus:border-[#0071E3]"
                />
                {/* A new search starts at page one and keeps the chosen order. */}
                <input type="hidden" name="sort" value={query.sort} />
                <input type="hidden" name="dir" value={query.direction} />
                {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
                {query.health ? <input type="hidden" name="health" value={query.health} /> : null}
              </form>

              <ClientFilter clients={clients} />
              <ColumnChooser columns={columnSpecs} label="shipment" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">
              Status
            </span>
            {STATUS_FILTERS.map((status) => {
              const active = query.status === status;
              return (
                <Link
                  key={status}
                  href={tableHref(
                    BASE_PATH,
                    params,
                    resetPage({ status: active ? null : status })
                  )}
                  aria-current={active ? "true" : undefined}
                  className={`px-2.5 py-1 rounded-xl border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3] ${
                    active
                      ? "border-[#0071E3] bg-[#0071E3]/10 text-[#0071E3]"
                      : "border-[#E5E5EA] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7]"
                  }`}
                >
                  {status}
                </Link>
              );
            })}
          </div>

          <SavedViews tableId="shipments" label="shipment" />
        </div>

        {/* Datatable */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1D1D1F]">
            <caption className="sr-only">
              Shipments for {ctx.accountName}, sorted by {query.sort} {query.direction}
            </caption>
            <thead className="bg-[#F5F5F7] text-[#6E6E73] font-semibold border-b border-[#E5E5EA]">
              <tr>
                {shows("shipmentNumber") ? (
                  <SortableHeader
                    column="shipmentNumber"
                    label="Shipment #"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                ) : null}
                {shows("importerName") ? (
                  <SortableHeader
                    column="importerName"
                    label="Importer of Record"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                ) : null}
                {shows("client") ? (
                  <th scope="col" className="px-3 xl:px-4 py-3.5 whitespace-nowrap">
                    Client
                  </th>
                ) : null}
                {shows("entryType") ? (
                  <th scope="col" className="px-3 xl:px-4 py-3.5 whitespace-nowrap">
                    Entry Type / PO
                  </th>
                ) : null}
                {shows("portOfEntry") ? (
                  <SortableHeader
                    column="portOfEntry"
                    label="Port & Mode"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                ) : null}
                {shows("readinessScore") ? (
                  <th scope="col" className="px-3 xl:px-4 py-3.5 whitespace-nowrap">
                    Readiness
                  </th>
                ) : null}
                {shows("status") ? (
                  <SortableHeader
                    column="status"
                    label="Status"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                ) : null}
                {shows("owner") ? (
                  <th scope="col" className="px-3 xl:px-4 py-3.5 whitespace-nowrap">
                    Owner
                  </th>
                ) : null}
                {shows("updatedAt") ? (
                  <SortableHeader
                    column="updatedAt"
                    label="Last Updated"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                ) : null}
                <th scope="col" className="px-3 xl:px-4 py-3.5 text-right whitespace-nowrap">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-3 xl:px-4 py-12 text-center text-[#6E6E73]">
                    <Package className="w-8 h-8 mx-auto text-[#86868B] mb-2 stroke-1" aria-hidden="true" />
                    <p className="font-semibold text-sm text-[#1D1D1F]">
                      {search || query.status || query.health || query.client
                        ? "No shipments match this view"
                        : "No shipments found"}
                    </p>
                    {search || query.status || query.health || query.client ? (
                      <Link href={BASE_PATH} className="text-xs mt-1 inline-block text-[#0071E3] hover:underline">
                        Clear filters
                      </Link>
                    ) : (
                      <>
                        <p className="text-xs mt-1">Create your first shipment to start customs clearance processing.</p>
                        <Link
                          href="/app/shipments/new"
                          className="inline-flex items-center space-x-1.5 px-4 py-2 mt-4 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl"
                        >
                          <Plus className="w-4 h-4" aria-hidden="true" />
                          <span>Create Shipment</span>
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                shipments.map((shp) => {
                  // The stored readinessScore is a creation-time default that no
                  // pipeline updates, so the real figure is computed per row.
                  const readiness = computeReadinessScore(shp);
                  const isReady = readiness >= 85;
                  const isCritical = shp.healthStatus === "Critical";

                  return (
                    <tr key={shp.id} className="hover:bg-[#F5F5F7]/60 transition-colors">
                      {shows("shipmentNumber") ? (
                        <td className="px-3 xl:px-4 py-4 font-bold text-[#0071E3] whitespace-nowrap">
                          <Link href={`/app/shipments/${shp.id}`} className="hover:underline flex items-center space-x-2">
                            <Package className="w-4 h-4 text-[#0071E3] shrink-0" aria-hidden="true" />
                            <span>{shp.shipmentNumber}</span>
                          </Link>
                        </td>
                      ) : null}

                      {shows("importerName") ? (
                        <td className="px-3 xl:px-4 py-4">
                          <div className="font-semibold text-[#1D1D1F]">{shp.importerName}</div>
                          <div className="text-xs text-[#6E6E73]">{displayText(shp.countryOfExport)}</div>
                        </td>
                      ) : null}

                      {shows("client") ? (
                        <td className="px-3 xl:px-4 py-4 whitespace-nowrap">
                          {shp.client ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#0071E3]/10 text-[#0071E3]">
                              {shp.client.name}
                            </span>
                          ) : (
                            <span className="text-xs text-[#6E6E73]">{NOT_PROVIDED}</span>
                          )}
                        </td>
                      ) : null}

                      {shows("entryType") ? (
                        <td className="px-3 xl:px-4 py-4 whitespace-nowrap">
                          <div>{entryTypeLabel(shp.entryType, NOT_PROVIDED)}</div>
                          <div className="text-xs text-[#6E6E73]">{displayText(shp.poReference)}</div>
                        </td>
                      ) : null}

                      {shows("portOfEntry") ? (
                        <td className="px-3 xl:px-4 py-4">
                          <div>{displayText(shp.portOfEntry)}</div>
                          <div className="text-xs text-[#6E6E73]">{displayText(shp.carrierName)}</div>
                        </td>
                      ) : null}

                      {shows("readinessScore") ? (
                        <td className="px-3 xl:px-4 py-4">
                          <div className="flex items-center space-x-2">
                            <div className="w-16 bg-[#E5E5EA] h-1.5 rounded-full overflow-hidden" aria-hidden="true">
                              <div
                                className={`h-full rounded-full ${isReady ? "bg-emerald-500" : isCritical ? "bg-red-500" : "bg-amber-500"}`}
                                style={{ width: `${readiness}%` }}
                              />
                            </div>
                            <span className="font-semibold text-xs">{readiness}%</span>
                          </div>
                        </td>
                      ) : null}

                      {shows("status") ? (
                        <td className="px-3 xl:px-4 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                              shp.status === "Completed" || shp.status === "Submitted"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : shp.status === "Ready to File"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {shp.status}
                          </span>
                        </td>
                      ) : null}

                      {shows("owner") ? (
                        <td className="px-3 xl:px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5 text-[#1D1D1F]">
                            <User className="w-3.5 h-3.5 text-[#6E6E73] shrink-0" aria-hidden="true" />
                            <span>
                              {shp.assignedBroker ? brokerName(shp.assignedBroker) : "Unassigned"}
                            </span>
                          </div>
                        </td>
                      ) : null}

                      {shows("updatedAt") ? (
                        <td className="px-3 xl:px-4 py-4 text-[#6E6E73] whitespace-nowrap">
                          <time dateTime={shp.updatedAt.toISOString()}>
                            {shp.updatedAt.toISOString().slice(0, 10)}
                          </time>
                        </td>
                      ) : null}

                      <td className="px-3 xl:px-4 py-4 text-right">
                        <Link
                          href={`/app/shipments/${shp.id}`}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] font-semibold text-xs rounded-lg transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
                        >
                          <span>Manage</span>
                          <span className="sr-only"> shipment {shp.shipmentNumber}</span>
                          <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={query.page}
          pageSize={query.pageSize}
          total={matchCount}
          params={params}
          basePath={BASE_PATH}
          label="shipments"
        />
      </div>
    </div>
  );
}
