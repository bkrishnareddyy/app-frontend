"use client";

import { useState, useMemo } from "react";
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
} from "lucide-react";
import { caughtMessage } from "@/lib/utils";

interface DocumentItem {
  id: string;
  docType: string;
  fileName: string;
  pageCount: number | null;
  confidence: number | null;
  status: string;
  fileUrl?: string | null;
}

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
  /** Serialised to an ISO string by the page before it crosses to the client. */
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
  documents: DocumentItem[];
  /**
   * Carried in the payload but not read by this screen -- the workbench lists
   * shipments and never inspects their line items or filings. Typed `unknown[]`
   * rather than given a shape this file does not depend on, so a change to either
   * row cannot silently invalidate a declaration nobody here checks.
   */
  lineItems: unknown[];
  customsFilings: unknown[];
}

interface ShipmentsWorkbenchClientProps {
  initialShipments: ShipmentItem[];
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

export function ShipmentsWorkbenchClient({
  initialShipments,
  teamMembers,
  clients,
  context,
}: ShipmentsWorkbenchClientProps) {
  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

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

  // Selected team member IDs. Default is [] (All Shipments) for the workbench view
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Column filters state
  const [columnFilters, setColumnFilters] = useState({
    shipmentNumber: "",
    importerName: "",
    entryTypePo: "",
    portMode: "",
    readiness: "ALL", // ALL, READY, NOT_READY
    status: "ALL",
    owner: "ALL",
    client: "ALL",
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [shipmentsList, setShipmentsList] = useState<ShipmentItem[]>(initialShipments);

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
          shp.importerName.toLowerCase().includes(q) ||
          (shp.entryType && shp.entryType.toLowerCase().includes(q)) ||
          (shp.poReference && shp.poReference.toLowerCase().includes(q)) ||
          (shp.portOfEntry && shp.portOfEntry.toLowerCase().includes(q));
        if (!matchesGlobal) return false;
      }

      // 3. Column Shipment # Filter
      if (
        columnFilters.shipmentNumber &&
        !shp.shipmentNumber.toLowerCase().includes(columnFilters.shipmentNumber.toLowerCase())
      ) {
        return false;
      }

      // 4. Column Importer of Record Filter
      if (
        columnFilters.importerName &&
        !shp.importerName.toLowerCase().includes(columnFilters.importerName.toLowerCase())
      ) {
        return false;
      }

      // 5. Column Entry Type / PO Filter
      if (columnFilters.entryTypePo) {
        const q = columnFilters.entryTypePo.toLowerCase();
        const match =
          (shp.entryType && shp.entryType.toLowerCase().includes(q)) ||
          (shp.poReference && shp.poReference.toLowerCase().includes(q));
        if (!match) return false;
      }

      // 6. Column Port & Mode Filter
      if (columnFilters.portMode) {
        const q = columnFilters.portMode.toLowerCase();
        const match =
          (shp.portOfEntry && shp.portOfEntry.toLowerCase().includes(q)) ||
          (shp.carrierName && shp.carrierName.toLowerCase().includes(q));
        if (!match) return false;
      }

      // 7. Column Readiness Filter
      if (columnFilters.readiness !== "ALL") {
        const isReady = (shp.readinessScore ?? 0) >= 85;
        if (columnFilters.readiness === "READY" && !isReady) return false;
        if (columnFilters.readiness === "NOT_READY" && isReady) return false;
      }

      // 8. Column Status Filter
      if (columnFilters.status !== "ALL" && shp.status !== columnFilters.status) {
        return false;
      }

      // 9. Column Owner Filter (Only if Admin)
      if (isEnterpriseAdmin && columnFilters.owner !== "ALL") {
        if (columnFilters.owner === "UNASSIGNED") {
          if (shp.assignedBrokerId) return false;
        } else if (shp.assignedBrokerId !== columnFilters.owner) {
          return false;
        }
      }

      // 10. Column Client Filter
      if (columnFilters.client !== "ALL") {
        if (columnFilters.client === "UNASSIGNED") {
          if (shp.clientId) return false;
        } else if (shp.clientId !== columnFilters.client) {
          return false;
        }
      }

      return true;
    });
    // Depends on `shipmentsList`, not `initialShipments`: reassigning a broker
    // updates `shipmentsList`, and with the prop as the dependency this memo did
    // not recompute, so the new owner never appeared in the table.
  }, [shipmentsList, selectedUserIds, columnFilters, searchQuery, isEnterpriseAdmin]);

  // Derived KPI Counts based on the current filtered list
  const totalCount = filteredShipments.length;
  const inProgressCount = filteredShipments.filter((s) => s.status === "In Progress").length;
  const readyCount = filteredShipments.filter(
    (s) => s.status === "Ready to File" || (s.readinessScore ?? 0) >= 90
  ).length;
  const holdCount = filteredShipments.filter(
    (s) => s.status === "On Hold" || s.healthStatus === "Critical"
  ).length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand">
              Shipment Operations Console
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-1">
            Shipment Workbench
          </h1>
          <p className="text-xs text-ink-muted">
            Active shipment management, document intake status, and readiness tracking for{" "}
            <strong className="text-ink">{context.accountName}</strong>.
          </p>
        </div>

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
        <div className="p-4 md:p-5 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF9F6]/50">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-ink">All Shipments</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-border text-ink">
              {totalCount}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {(columnFilters.shipmentNumber ||
              columnFilters.importerName ||
              columnFilters.entryTypePo ||
              columnFilters.portMode ||
              columnFilters.readiness !== "ALL" ||
              columnFilters.status !== "ALL" ||
              columnFilters.owner !== "ALL" ||
              columnFilters.client !== "ALL" ||
              searchQuery) && (
              <button
                onClick={() => {
                  setColumnFilters({
                    shipmentNumber: "",
                    importerName: "",
                    entryTypePo: "",
                    portMode: "",
                    readiness: "ALL",
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
                <th className="px-5 py-3.5">Importer of Record</th>
                <th className="px-5 py-3.5">Entry Type / PO</th>
                <th className="px-5 py-3.5">Port & Mode</th>
                <th className="px-5 py-3.5">Readiness</th>
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
                    onChange={(e) =>
                      setColumnFilters({ ...columnFilters, shipmentNumber: e.target.value })
                    }
                    placeholder="Filter #"
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={columnFilters.importerName}
                    onChange={(e) =>
                      setColumnFilters({ ...columnFilters, importerName: e.target.value })
                    }
                    placeholder="Filter Importer"
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={columnFilters.entryTypePo}
                    onChange={(e) =>
                      setColumnFilters({ ...columnFilters, entryTypePo: e.target.value })
                    }
                    placeholder="Filter Type/PO"
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={columnFilters.portMode}
                    onChange={(e) =>
                      setColumnFilters({ ...columnFilters, portMode: e.target.value })
                    }
                    placeholder="Filter Port"
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand"
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={columnFilters.readiness}
                    onChange={(e) =>
                      setColumnFilters({ ...columnFilters, readiness: e.target.value })
                    }
                    className="px-2.5 py-1 w-full bg-white border border-border rounded-lg text-[11px] font-medium focus:outline-none focus:border-brand cursor-pointer"
                  >
                    <option value="ALL">All Readiness</option>
                    <option value="READY">Ready (&gt;= 85%)</option>
                    <option value="NOT_READY">Incomplete (&lt; 85%)</option>
                  </select>
                </td>
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
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
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
                    colSpan={isEnterpriseAdmin ? 8 : 7}
                    className="px-5 py-12 text-center text-ink-muted"
                  >
                    <Package className="w-8 h-8 mx-auto text-ink-muted mb-2 stroke-1" />
                    <p className="font-semibold text-sm text-ink">No shipments match the filters</p>
                    <p className="text-xs mt-1">Try resetting the search filters to view active shipments.</p>
                  </td>
                </tr>
              ) : (
                filteredShipments.map((shp) => {
                  const isReady = (shp.readinessScore ?? 0) >= 85;
                  const isCritical = shp.healthStatus === "Critical";

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
                      </td>

                      <td className="px-5 py-4">
                        <div className="font-semibold text-ink">{shp.importerName}</div>
                        <div className="text-[11px] text-ink-muted">
                          {shp.countryOfExport || "Global"}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div>{shp.entryType}</div>
                        <div className="text-[11px] text-ink-muted">
                          {shp.poReference || "No PO"}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div>{shp.portOfEntry || "Port of LA"}</div>
                        <div className="text-[11px] text-ink-muted">
                          {shp.carrierName || "Ocean"}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-16 bg-border h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isReady ? "bg-emerald-500" : isCritical ? "bg-red-500" : "bg-amber-500"
                              }`}
                              style={{ width: `${shp.readinessScore}%` }}
                            />
                          </div>
                          <span className="font-semibold text-[11px]">{shp.readinessScore}%</span>
                        </div>
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
      </div>
    </div>
  );
}
