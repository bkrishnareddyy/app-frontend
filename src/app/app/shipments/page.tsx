import Link from "next/link";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Package,
  Plus,
  Search,
  Filter,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowRight,
  FileText,
  Building2,
} from "lucide-react";

export default async function ShipmentsConsolePage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  const shipments = await db.shipment.findMany({
    where: { accountId: ctx.accountId, deletedAt: null },
    include: {
      documents: true,
      lineItems: true,
      customsFilings: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const totalCount = shipments.length;
  const inProgressCount = shipments.filter((s) => s.status === "In Progress").length;
  const readyCount = shipments.filter((s) => s.status === "Ready to File" || s.readinessScore >= 90).length;
  const holdCount = shipments.filter((s) => s.status === "On Hold" || s.healthStatus === "Critical").length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#0071E3]/10 text-[#0071E3]">
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
            <Plus className="w-4 h-4" />
            <span>+ Add Shipment</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Total Shipments</span>
            <Package className="w-4 h-4 text-[#0071E3]" />
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{totalCount}</p>
          <p className="text-[11px] text-[#86868B] mt-1">Active in workspace</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>In Progress</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{inProgressCount}</p>
          <p className="text-[11px] text-amber-600 mt-1">Under agent review</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Ready to File</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{readyCount}</p>
          <p className="text-[11px] text-emerald-600 mt-1">Cleared for filing</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#86868B] mb-2">
            <span>Exception Hold</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{holdCount}</p>
          <p className="text-[11px] text-red-500 mt-1">Attention required</p>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs overflow-hidden">
        {/* Table Header Bar */}
        <div className="p-4 md:p-5 border-b border-[#E5E5EA] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF9F6]/50">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-[#1D1D1F]">All Shipments</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E5E5EA] text-[#1D1D1F]">
              {totalCount}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#86868B] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search shipments..."
                className="pl-8 pr-3 py-1.5 bg-white border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] w-64 focus:outline-hidden focus:border-[#0071E3]"
              />
            </div>
          </div>
        </div>

        {/* Datatable */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] text-[#86868B] font-semibold border-b border-[#E5E5EA]">
              <tr>
                <th className="px-5 py-3.5">Shipment #</th>
                <th className="px-5 py-3.5">Importer of Record</th>
                <th className="px-5 py-3.5">Entry Type / PO</th>
                <th className="px-5 py-3.5">Port & Mode</th>
                <th className="px-5 py-3.5">Readiness</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[#86868B]">
                    <Package className="w-8 h-8 mx-auto text-[#86868B] mb-2 stroke-1" />
                    <p className="font-semibold text-sm text-[#1D1D1F]">No shipments found</p>
                    <p className="text-xs mt-1">Create your first shipment to start customs clearance processing.</p>
                    <Link
                      href="/app/shipments/new"
                      className="inline-flex items-center space-x-1.5 px-4 py-2 mt-4 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Create Shipment</span>
                    </Link>
                  </td>
                </tr>
              ) : (
                shipments.map((shp) => {
                  const isReady = shp.readinessScore >= 85;
                  const isCritical = shp.healthStatus === "Critical";

                  return (
                    <tr key={shp.id} className="hover:bg-[#F5F5F7]/60 transition-colors">
                      <td className="px-5 py-4 font-bold text-[#0071E3]">
                        <Link href={`/app/shipments/${shp.id}`} className="hover:underline flex items-center space-x-2">
                          <Package className="w-4 h-4 text-[#0071E3] shrink-0" />
                          <span>{shp.shipmentNumber}</span>
                        </Link>
                      </td>

                      <td className="px-5 py-4">
                        <div className="font-semibold text-[#1D1D1F]">{shp.importerName}</div>
                        <div className="text-[11px] text-[#86868B]">{shp.countryOfExport || "Global"}</div>
                      </td>

                      <td className="px-5 py-4">
                        <div>{shp.entryType}</div>
                        <div className="text-[11px] text-[#86868B]">{shp.poReference || "No PO"}</div>
                      </td>

                      <td className="px-5 py-4">
                        <div>{shp.portOfEntry || "Port of LA"}</div>
                        <div className="text-[11px] text-[#86868B]">{shp.carrierName || "Ocean"}</div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-16 bg-[#E5E5EA] h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isReady ? "bg-emerald-500" : isCritical ? "bg-red-500" : "bg-amber-500"}`}
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

                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/app/shipments/${shp.id}`}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] font-semibold text-xs rounded-lg transition-all"
                        >
                          <span>Manage</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
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
