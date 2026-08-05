import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  Send,
  Building2,
  DollarSign,
  AlertCircle,
  ChevronRight,
  Download,
  Info,
} from "lucide-react";

export default async function CustomsFilingPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const filing = await db.customsFiling.findFirst({
    where: { accountId: context.accountId },
    include: {
      shipment: { include: { documents: true } },
      responses: { orderBy: { receivedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const dutyBreakdown = (filing?.dutyBreakdown as any[]) || [
    { feeName: "Basic Customs Duty (2.5%)", amount: 335.0, rate: "2.5%" },
    { feeName: "Section 301 China Duty (7.5%)", amount: 630.0, rate: "7.5%" },
    { feeName: "Merchandise Processing Fee (MPF)", amount: 46.42, rate: "0.3464%" },
    { feeName: "Harbor Maintenance Fee (HMF)", amount: 16.75, rate: "0.125%" },
    { feeName: "State Harbor Tax", amount: 8.5, rate: "Fixed" },
  ];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-5 h-5 text-[#0071E3]" />
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Customs Filing & Response Center</h1>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            Automated ABI entry summary filing and real-time CBP response tracking
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all flex items-center space-x-1.5">
            <Download className="w-3.5 h-3.5" />
            <span>Export 7501 Package</span>
          </button>
          <button className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5">
            <Send className="w-3.5 h-3.5" />
            <span>Transmit to CBP (ABI)</span>
          </button>
        </div>
      </div>

      {/* 4-Step Timeline Stepper */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Customs Filing Timeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          {[
            { step: 1, name: "Prepare Filing Package", status: "Completed", date: "15 May 10:00 AM", color: "border-emerald-500 bg-emerald-50 text-emerald-800" },
            { step: 2, name: "Transmit to CBP (ABI)", status: "Completed", date: "15 May 10:15 AM", color: "border-emerald-500 bg-emerald-50 text-emerald-800" },
            { step: 3, name: "CBP Response & Clearance", status: "In Progress", date: "Active", color: "border-[#0071E3] bg-blue-50 text-blue-900 font-bold" },
            { step: 4, name: "Close Entry & Payment", status: "Pending", date: "Waiting", color: "border-[#E5E5EA] bg-[#F5F5F7] text-[#86868B]" },
          ].map((st) => (
            <div key={st.step} className={`p-4 rounded-xl border ${st.color} space-y-1`}>
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-sm">Step {st.step}</span>
                <span className="text-[10px] uppercase font-bold">{st.status}</span>
              </div>
              <p className="font-bold text-[#1D1D1F]">{st.name}</p>
              <p className="text-[10px] text-[#86868B]">{st.date}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Filing Summary & Duty Breakdown (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                  Entry Summary: {filing?.entryNumber || "5901-26-004872"}
                </h3>
                <p className="text-xs text-[#86868B]">Filing Authority: {filing?.authority || "US Customs (CBP)"}</p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Status: {filing?.filingStatus || "Filed"}
              </span>
            </div>

            {/* Entry Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div><p className="text-[#86868B]">Entry Type</p><p className="font-bold text-[#1D1D1F]">{filing?.entryType || "Consumption Entry"}</p></div>
              <div><p className="text-[#86868B]">Filing Method</p><p className="font-bold text-[#1D1D1F]">{filing?.filingType || "ABI - Automated"}</p></div>
              <div><p className="text-[#86868B]">Payment Status</p><p className="font-bold text-emerald-600">{filing?.paymentStatus || "Paid"}</p></div>
              <div><p className="text-[#86868B]">Entered Value</p><p className="font-bold text-[#1D1D1F]">USD ${(filing?.totalValue || 17750).toLocaleString()}</p></div>
            </div>

            {/* Duty & Tax Breakdown Table (DYNAMIC FROM DATABASE) */}
            <div className="space-y-3 pt-3 border-t border-[#E5E5EA]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Duty & Tax Breakdown</h4>

              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] text-[#86868B]">
                    <th className="pb-2">Duty Fee Item</th>
                    <th className="pb-2">Calculation Rate</th>
                    <th className="pb-2 text-right">Amount (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {dutyBreakdown.map((duty: any, idx: number) => (
                    <tr key={idx} className="hover:bg-[#F5F5F7]">
                      <td className="py-2.5 font-semibold text-[#1D1D1F]">{duty.feeName}</td>
                      <td className="py-2.5 text-[#86868B]">{duty.rate}</td>
                      <td className="py-2.5 text-right font-bold text-[#1D1D1F]">
                        ${duty.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end pt-3 border-t border-[#E5E5EA] text-xs space-y-1 text-right">
                <div>
                  <p className="text-[#86868B]">Total Duties: <span className="font-bold text-[#1D1D1F]">${(filing?.totalDuties || 2850).toFixed(2)}</span></p>
                  <p className="text-[#86868B]">Total Taxes: <span className="font-bold text-[#1D1D1F]">${(filing?.totalTaxes || 13100).toFixed(2)}</span></p>
                  <p className="font-extrabold text-sm text-[#0071E3] mt-1">Total Due: ${(filing?.totalAmount || 16250).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: CBP Responses Feed (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">CBP Responses Feed</h3>
              <span className="text-xs text-[#86868B]">Live Customs ABI Feed</span>
            </div>

            <div className="space-y-3">
              {(filing?.responses || []).map((resp) => (
                <div key={resp.id} className="p-3.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1D1D1F]">{resp.title}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        resp.code === "ACK"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : resp.code === "RELE"
                          ? "bg-blue-50 text-[#0071E3] border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {resp.code}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#86868B]">{resp.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
