"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Package,
  Plus,
  Search,
  ShieldCheck,
  AlertTriangle,
  Clock,
  User,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { caughtMessage } from "@/lib/utils";
import { PAGE_SIZE_DEFAULT, pageWindow } from "@/modules/tables/tableQuery";

interface ShipmentItem {
  id: string;
  shipmentNumber: string;
  importerName: string;
  countryOfExport?: string | null;
  entryType?: string | null;
  poReference?: string | null;
  portOfEntry?: string | null;
  carrierName?: string | null;
  readinessScore?: number | null;
  healthStatus?: string | null;
  status: string;
  createdAt: string;
  clientId?: string | null;
  client?: { id: string; name: string } | null;
  assignedBrokerId?: string | null;
  assignedBroker?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
}

type DeadlineInfo = { dueAt: string | null; status: string; estimated: boolean };
type DeadlinesByShipment = Record<string, { isf?: DeadlineInfo; entryFiling?: DeadlineInfo }>;

interface ShipmentsWorkbenchClientProps {
  initialShipments: ShipmentItem[];
  deadlinesByShipment?: DeadlinesByShipment;
  teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  clients: Array<{ id: string; name: string }>;
  context: {
    userId: string;
    roleNames: string[];
    accountType: string;
    accountName: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
}

// Sort key for a deadline cell: lower = more urgent; Infinity = no data / satisfied.
function deadlineSortMs(info: DeadlineInfo | undefined): number {
  if (!info || info.status === "SATISFIED") return Infinity;
  if (info.status === "MISSED") return -1;
  if (!info.dueAt) return Infinity;
  return Math.max(-1, new Date(info.dueAt).getTime() - Date.now());
}

// Renders a single ISF or Entry Filing deadline cell.
// `warnDays` is when the cell turns amber. ISF's natural window is short, so
// the default 3 days is timely; Entry Filing runs CBP's 15-day statutory
// window with liquidated-damages exposure (19 CFR 141.68(a)/142.15), so it
// needs to catch a broker's eye earlier to leave time to work the file.
// `now` is passed in (rather than read via Date.now() here) so the render
// stays pure -- the caller ticks it on an interval.
function DeadlineCell({ info, now, warnDays = 3 }: { info: DeadlineInfo | undefined; now: number; warnDays?: number }) {
  if (!info) return <span className="text-ink-muted tabular-nums">—</span>;
  if (info.status === "SATISFIED") return <span className="text-emerald-600 font-semibold text-[11px]">✓ Filed</span>;
  if (info.status === "MISSED") return <span className="text-red-700 font-bold text-[11px] uppercase tracking-wide">Missed</span>;
  if (!info.dueAt) return <span className="text-ink-muted tabular-nums">—</span>;

  const ms = new Date(info.dueAt).getTime() - now;
  if (ms <= 0) return <span className="text-red-700 font-bold text-[11px] uppercase tracking-wide">Breached</span>;

  const totalMins = Math.floor(ms / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const text = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const color =
    ms <= 24 * 3_600_000 ? "text-red-600 font-bold" :
    ms <= warnDays * 24 * 3_600_000 ? "text-amber-700 font-semibold" :
    "text-ink-muted";

  return (
    <span className={`text-[11px] tabular-nums ${color}`}>
      {info.estimated && <span className="opacity-50 mr-0.5">~</span>}{text}
    </span>
  );
}

export function ShipmentsWorkbenchClient({
  initialShipments,
  deadlinesByShipment = {},
  teamMembers,
  clients,
  context,
}: ShipmentsWorkbenchClientProps) {
  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  // Ticked on an interval so DeadlineCell's countdowns can stay pure during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Construct full team list containing the logged-in admin themselves
  const fullTeamList = useMemo(() => {
    const list = [...teamMembers];
    const hasMe = list.some((m) => m.userId === context.userId);
    if (!hasMe) {
      list.unshift({
        userId: context.userId,
        email: context.email || "me@qubere.ai",
        firstName: context.firstName || "Me",
        lastName: context.lastName || "",
      });
    }
    return list;
  }, [teamMembers, context]);

  // Pagination over the filtered result, not the raw list. The KPI cards above and
  // the search below both read the whole set, so paginating the data source would
  // make "Total: 25" mean "25 on this page" and let a search miss every match that
  // is not on the page being viewed.
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [page, setPage] = useState(1);

  // Selected team member IDs. Default is [] (All Shipments) for the workbench view
  const [selectedUserIds, setSelectedUserIdsValue] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Column filters state
  const [columnFilters, setColumnFiltersValue] = useState({
    shipmentNumber: "",
    status: "ALL",
    owner: "ALL",
    client: "ALL",
  });

  const [searchQuery, setSearchQueryValue] = useState("");
  const [shipmentsList, setShipmentsList] = useState<ShipmentItem[]>(initialShipments);
  const [sortCol, setSortCol] = useState<"isf" | "ef" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Every filter change returns to the first page. Wrapped at the setter rather
  // than at each of the sixteen call sites, so a filter added later cannot forget
  // to do it and strand the operator on a page the new result no longer has.
  const setSelectedUserIds: typeof setSelectedUserIdsValue = (value) => {
    setPage(1);
    setSelectedUserIdsValue(value);
  };
  const setColumnFilters: typeof setColumnFiltersValue = (value) => {
    setPage(1);
    setColumnFiltersValue(value);
  };
  const setSearchQuery: typeof setSearchQueryValue = (value) => {
    setPage(1);
    setSearchQueryValue(value);
  };

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleReassign = async (shipmentId: string, newBrokerId: string | null) => {
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assignedBrokerId: newBrokerId }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to reassign shipment");
      }

      // Update local state
      setShipmentsList((prev) =>
        prev.map((shp) => {
          if (shp.id === shipmentId) {
            const chosenMember = fullTeamList.find((m) => m.userId === newBrokerId);
            return {
              ...shp,
              assignedBrokerId: newBrokerId,
              assignedBroker: chosenMember
                ? {
                    id: chosenMember.userId,
                    firstName: chosenMember.firstName,
                    lastName: chosenMember.lastName,
                    email: chosenMember.email,
                  }
                : null,
            };
          }
          return shp;
        })
      );
    } catch (err) {
      alert(caughtMessage(err, "Failed to reassign shipment"));
    }
  };

  const toggleSort = (col: "isf" | "ef") => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  };

  const sortIcon = (col: "isf" | "ef") =>
    sortCol !== col ? " ↕" : sortDir === "asc" ? " ↑" : " ↓";

  // Filter shipments based on top-level filter, column filters, and global search query
  const filteredShipments = useMemo(() => {
    return shipmentsList.filter((shp) => {
      // 1. Top assignee filter
      if (isEnterpriseAdmin) {
        if (selectedUserIds.length > 0) {
          if (!shp.assignedBrokerId || !selectedUserIds.includes(shp.assignedBrokerId)) {
            return false;
          }
        }
      }

      // 2. Global search query
      if (searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase();
        const matchesGlobal =
          shp.shipmentNumber.toLowerCase().includes(q) ||
          shp.importerName.toLowerCase().includes(q);
        if (!matchesGlobal) return false;
      }

      // 3. Column Shipment # Filter
      if (
        columnFilters.shipmentNumber &&
        !shp.shipmentNumber.toLowerCase().includes(columnFilters.shipmentNumber.toLowerCase())
      ) {
        return false;
      }

      // 4. Column Status Filter
      if (columnFilters.status !== "ALL" && shp.status !== columnFilters.status) {
        return false;
      }

      // 5. Column Owner Filter (Only if Admin)
      if (isEnterpriseAdmin && columnFilters.owner !== "ALL") {
        if (columnFilters.owner === "UNASSIGNED") {
          if (shp.assignedBrokerId) return false;
        } else if (shp.assignedBrokerId !== columnFilters.owner) {
          return false;
        }
      }

      // 6. Column Client Filter
      if (columnFilters.client !== "ALL") {
        if (columnFilters.client === "UNASSIGNED") {
          if (shp.clientId) return false;
        } else if (shp.clientId !== columnFilters.client) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (!sortCol) return 0;
      const da = deadlinesByShipment[a.shipmentNumber];
      const db_ = deadlinesByShipment[b.shipmentNumber];
      const msA = deadlineSortMs(sortCol === "isf" ? da?.isf : da?.entryFiling);
      const msB = deadlineSortMs(sortCol === "isf" ? db_?.isf : db_?.entryFiling);
      return sortDir === "asc" ? msA - msB : msB - msA;
    });
  }, [shipmentsList, selectedUserIds, columnFilters, searchQuery, isEnterpriseAdmin, sortCol, sortDir, deadlinesByShipment]);

  // Derived KPI Counts based on the current filtered list
  const totalCount = filteredShipments.length;
  const inProgressCount = filteredShipments.filter((s) => s.status === "In Progress").length;
  const readyCount = filteredShipments.filter(
    (s) => s.status === "Ready to File" || (s.readinessScore ?? 0) >= 90
  ).length;
  const holdCount = filteredShipments.filter(
    (s) => s.status === "On Hold" || s.healthStatus === "Critical"
  ).length;

  const { pages, page: currentPage, firstRow, lastRow, start, end } = pageWindow(
    totalCount,
    pageSize,
    page
  );
  const pagedShipments = useMemo(
    () => filteredShipments.slice(start, end),
    [filteredShipments, start, end]
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Shipment Workbench
        </h1>

        <div className="flex items-center space-x-3">
          <Link
            href="/app/shipments/new"
            className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-2 shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Shipment</span>
          </Link>
        </div>
      </div>

      {/* Enterprise Admin Top Filter Controls */}
      {isEnterpriseAdmin && (
        <div className="bg-white p-4 rounded-2xl border border-border shadow-2xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-2.5">
            <Users className="w-4 h-4 text-brand" />
            <span className="text-xs font-bold text-ink uppercase tracking-wider">
              Assignee View
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-surface-muted p-1 rounded-xl border border-border text-xs">
              <button
                onClick={() => setSelectedUserIds([])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 0 ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
                }`}
              >
                All Shipments
              </button>
              <button
                onClick={() => setSelectedUserIds([context.userId])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 1 && selectedUserIds[0] === context.userId
                    ? "bg-white text-ink shadow-3xs"
                    : "text-ink-muted"
                }`}
              >
                My Shipments
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs relative">
              <span className="text-ink-muted font-semibold">Team Members:</span>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="px-3.5 py-1.5 rounded-xl border border-border bg-white text-xs text-ink focus:outline-none focus:border-brand font-semibold cursor-pointer flex items-center space-x-1.5 shadow-3xs"
              >
                <span>
                  {selectedUserIds.length === 0
                    ? "All Team Members"
                    : selectedUserIds.length === 1
                    ? selectedUserIds[0] === context.userId
                      ? `My Shipments (${context.firstName || "Me"})`
                      : (() => {
                          const user = fullTeamList.find((u) => u.userId === selectedUserIds[0]);
                          return user
                            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
                            : "1 Selected";
                        })()
                    : `${selectedUserIds.length} Selected`}
                </span>
                <span className="text-ink-muted text-[9px]">▼</span>
              </button>

              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-border rounded-2xl shadow-lg p-3 z-20 space-y-2 max-h-60 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-border pb-2 mb-1 text-[10px] font-bold text-ink-muted uppercase">
                      <span>Select Members</span>
                      <div className="space-x-2">
                        <button
                          onClick={() => setSelectedUserIds(fullTeamList.map((t) => t.userId))}
                          className="text-brand hover:underline cursor-pointer"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setSelectedUserIds([])}
                          className="text-brand hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {fullTeamList.map((member) => {
                        const isChecked = selectedUserIds.includes(member.userId);
                        const memberName =
                          member.firstName || member.lastName
                            ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                            : member.email;

                        return (
                          <label
                            key={member.userId}
                            className="flex items-center space-x-2.5 p-2 hover:bg-surface-muted rounded-xl cursor-pointer text-left transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleUser(member.userId)}
                              className="rounded border-border text-brand focus:ring-brand cursor-pointer"
                            />
                            <div className="truncate">
                              <p className="font-bold text-ink text-xs truncate">
                                {memberName}
                                {member.userId === context.userId && " (Me)"}
                              </p>
                              <p className="text-[10px] text-ink-muted truncate">
                                {member.email}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted mb-2">
            <span>Total Shipments</span>
            <Package className="w-4 h-4 text-brand" />
          </div>
          <p className="text-2xl font-bold text-ink">{totalCount}</p>
          <p className="text-[11px] text-ink-muted mt-1">Matched by filters</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted mb-2">
            <span>In Progress</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-ink">{inProgressCount}</p>
          <p className="text-[11px] text-amber-600 mt-1">Under agent review</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted mb-2">
            <span>Ready to File</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-ink">{readyCount}</p>
          <p className="text-[11px] text-emerald-600 mt-1">Cleared for filing</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs">
          <div className="flex items-center justify-between text-xs text-ink-muted mb-2">
            <span>Exception Hold</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <p className="text-2xl font-bold text-ink">{holdCount}</p>
          <p className="text-[11px] text-red-500 mt-1">Attention required</p>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="bg-white rounded-2xl border border-border shadow-2xs overflow-hidden">
        {/* Table Header Bar */}
        <div className="px-4 py-2.5 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#FAF9F6]/50">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-ink">All Shipments</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-border text-ink">
              {totalCount}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {(columnFilters.shipmentNumber ||
              columnFilters.status !== "ALL" ||
              columnFilters.owner !== "ALL" ||
              columnFilters.client !== "ALL" ||
              searchQuery) && (
              <button
                onClick={() => {
                  setColumnFilters({
                    shipmentNumber: "",
                    status: "ALL",
                    owner: "ALL",
                    client: "ALL",
                  });
                  setSearchQuery("");
                }}
                className="px-3 py-1.5 bg-surface-muted hover:bg-border border border-border rounded-xl text-xs font-semibold text-ink transition-colors cursor-pointer"
              >
                Clear Filters
              </button>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Global search shipments..."
                className="pl-8 pr-3 py-1.5 bg-white border border-border rounded-xl text-xs text-ink w-64 focus:outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>

        {/* Datatable */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-ink">
            <thead className="bg-surface-muted text-ink-muted font-bold border-b border-border">
              <tr>
                <th className="px-5 py-3.5">Shipment #</th>
                <th className="px-5 py-3.5 cursor-pointer select-none hover:text-ink" onClick={() => toggleSort("isf")}>
                  ISF{sortIcon("isf")}
                </th>
                <th className="px-5 py-3.5 cursor-pointer select-none hover:text-ink" onClick={() => toggleSort("ef")}>
                  Entry Filing{sortIcon("ef")}
                </th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Client</th>
                {isEnterpriseAdmin && <th className="px-5 py-3.5">Owner</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Column Filters Row */}
              <tr className="bg-[#FAF9F6]/40 border-b border-border">
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={columnFilters.shipmentNumber}
                    onChange={(e) => setColumnFilters({ ...columnFilters, shipmentNumber: e.target.value })}
                    placeholder="Filter #"
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand"
                  />
                </td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2">
                  <select
                    value={columnFilters.status}
                    onChange={(e) => setColumnFilters({ ...columnFilters, status: e.target.value })}
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand cursor-pointer"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Ready to File">Ready to File</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Completed">Completed</option>
                    <option value="On Hold">On Hold</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select
                    value={columnFilters.client}
                    onChange={(e) => setColumnFilters({ ...columnFilters, client: e.target.value })}
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand cursor-pointer"
                  >
                    <option value="ALL">All Clients</option>
                    <option value="UNASSIGNED">No Client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                {isEnterpriseAdmin && (
                  <td className="px-4 py-2">
                    <select
                      value={columnFilters.owner}
                      onChange={(e) => setColumnFilters({ ...columnFilters, owner: e.target.value })}
                      className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand cursor-pointer"
                    >
                      <option value="ALL">All Owners</option>
                      <option value="UNASSIGNED">Unassigned</option>
                      {fullTeamList.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.firstName || member.lastName
                            ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                            : member.email}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>

              {filteredShipments.length === 0 ? (
                <tr>
                  <td
                    colSpan={isEnterpriseAdmin ? 6 : 5}
                    className="px-5 py-12 text-center text-ink-muted"
                  >
                    <Package className="w-8 h-8 mx-auto text-ink-muted mb-2 stroke-1" />
                    <p className="font-semibold text-sm text-ink">No shipments match the filters</p>
                    <p className="text-xs mt-1">Try resetting the search filters to view active shipments.</p>
                  </td>
                </tr>
              ) : (
                pagedShipments.map((shp) => {
                  return (
                    <tr key={shp.id} className="hover:bg-surface-muted/60 transition-colors">
                      <td className="px-5 py-4 font-bold text-brand">
                        <Link
                          href={`/app/shipments/${shp.id}`}
                          className="hover:underline flex items-center space-x-2"
                        >
                          <Package className="w-4 h-4 text-brand shrink-0" />
                          <span>{shp.shipmentNumber}</span>
                        </Link>
                        <div className="mt-0.5 text-[11px] font-normal text-ink-muted truncate max-w-[180px]">
                          {shp.importerName}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <DeadlineCell info={deadlinesByShipment[shp.shipmentNumber]?.isf} now={now} />
                      </td>

                      <td className="px-5 py-4">
                        <DeadlineCell info={deadlinesByShipment[shp.shipmentNumber]?.entryFiling} now={now} warnDays={5} />
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
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

                      <td className="px-5 py-4">
                        {shp.client ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand/10 text-brand">
                            {shp.client.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-muted">—</span>
                        )}
                      </td>

                      {isEnterpriseAdmin && (
                        <td className="px-5 py-4">
                          <div className="flex items-center space-x-1.5 text-xs">
                            <User className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                            <select
                              value={shp.assignedBrokerId || "UNASSIGNED"}
                              onChange={async (e) => {
                                const newBrokerId = e.target.value === "UNASSIGNED" ? null : e.target.value;
                                await handleReassign(shp.id, newBrokerId);
                              }}
                              className="bg-transparent border-b border-transparent hover:border-brand py-0.5 focus:outline-none focus:border-brand font-semibold text-ink cursor-pointer"
                            >
                              <option value="UNASSIGNED">Unassigned</option>
                              {fullTeamList.map((m) => (
                                <option key={m.userId} value={m.userId}>
                                  {m.firstName || m.lastName
                                    ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim()
                                    : m.email}
                                  {m.userId === context.userId && " (Me)"}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Range counted from the filtered total, so a partial last page reports
            how many rows it actually holds instead of repeating the page size. */}
        <nav
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-border"
          aria-label="Shipments pagination"
        >
          <div className="flex items-center gap-3">
            <p className="text-xs text-ink-muted">
              {totalCount === 0
                ? "No shipments"
                : `${firstRow}–${lastRow} of ${totalCount} shipment${totalCount === 1 ? "" : "s"}`}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span>Rows</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  // Back to the first page: keeping the page number while changing
                  // its size scrolls the operator to an unrelated slice.
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Rows per page"
                className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-semibold text-ink focus:outline-none focus:border-brand"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">
              Page {currentPage} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:bg-surface-muted disabled:text-ink-muted disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pages}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:bg-surface-muted disabled:text-ink-muted disabled:cursor-not-allowed cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
