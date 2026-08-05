import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Send,
  Download,
  MessageSquare,
  ArrowRight,
  Check,
} from "lucide-react";

export default async function CustomsFilingPage() {
  const context = await getAccountContext();
  if (!context) return null;

  const filings = await db.customsFiling.findMany({
    where: { accountId: context.accountId },
    include: {
      shipment: { include: { documents: true } },
      responses: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const mainFiling = filings[0];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Customs Filing & Response Center</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Entry Released
            </span>
          </div>
          <p className="text-xs text-[#86868B] mt-1">
            Shipment: <strong className="text-[#1D1D1F]">SHP-2026-004872</strong> • Entry Type: Consumption Entry • Port: Los Angeles
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Filing Readiness: <strong>87% (All critical validations passed)</strong></span>
          </div>

          <Link
            href="/app/shipments/SHP-2026-004872"
            className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all"
          >
            View Readiness
          </Link>
        </div>
      </div>

      {/* 4-Step Pipeline Stepper Header */}
      <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs flex items-center justify-around text-xs font-semibold">
        <div className="flex items-center space-x-2 text-[#86868B]">
          <span className="w-6 h-6 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center font-bold text-[11px]">1</span>
          <span>Prepare Filing</span>
        </div>
        <ChevronRight className="w-4 h-4 text-[#86868B]" />
        <div className="flex items-center space-x-2 text-[#0071E3] font-bold">
          <span className="w-6 h-6 rounded-full bg-[#0071E3] text-white flex items-center justify-center font-bold text-[11px]">2</span>
          <span>File with Customs</span>
        </div>
        <ChevronRight className="w-4 h-4 text-[#86868B]" />
        <div className="flex items-center space-x-2 text-[#86868B]">
          <span className="w-6 h-6 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center font-bold text-[11px]">3</span>
          <span>Track & Respond</span>
        </div>
        <ChevronRight className="w-4 h-4 text-[#86868B]" />
        <div className="flex items-center space-x-2 text-[#86868B]">
          <span className="w-6 h-6 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center font-bold text-[11px]">4</span>
          <span>Close Entry</span>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Filing Summary & Documents (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Filing Summary Panel */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Filing Summary</h3>

            <div className="space-y-2 text-xs divide-y divide-[#E5E5EA]">
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Filing Status</span><span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Filed</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Filed On</span><span className="font-bold text-[#1D1D1F]">12 May 2026 10:32 AM</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Filed By</span><span className="font-bold text-[#1D1D1F]">Stephen (Broker)</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Customs Authority</span><span className="font-bold text-[#1D1D1F]">US Customs (CBP)</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Entry Type</span><span className="font-bold text-[#1D1D1F]">Consumption Entry</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Entry Number</span><span className="font-bold text-[#0071E3]">5901-26-004872</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Filing Type</span><span className="font-bold text-[#1D1D1F]">ABI - Automated</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Payment Status</span><span className="font-bold text-emerald-600">Paid</span></div>
              <div className="pt-2 flex justify-between"><span className="text-[#86868B]">Total Duties & Taxes</span><span className="font-extrabold text-[#1D1D1F]">USD $16,250.00</span></div>
            </div>

            <button className="w-full py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs flex items-center justify-center space-x-1.5 transition-all">
              <Download className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>View Filing Package</span>
            </button>
          </div>

          {/* Filing Documents List */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Filing Documents</h3>

            <div className="space-y-2 text-xs">
              {[
                { title: "CBP Entry Summary", sub: "5901-26-004872.pdf", status: "Filed" },
                { title: "Entry Data (ABI)", sub: "5901_26_004872.edi", status: "Filed" },
                { title: "Commercial Invoice", sub: "INV-45678.pdf", status: "Submitted" },
                { title: "Packing List", sub: "PKL-45678.xlsx", status: "Submitted" },
                { title: "Bill of Lading", sub: "BOL-78912.pdf", status: "Submitted" },
              ].map((d, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <FileText className="w-4 h-4 text-[#0071E3] shrink-0" />
                    <div>
                      <p className="font-bold text-[#1D1D1F]">{d.title}</p>
                      <p className="text-[10px] text-[#86868B]">{d.sub}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Column: Filing Progress & Duty Details Table (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Filing Progress Stepper */}
          <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Filing Progress</h3>

            <div className="grid grid-cols-5 gap-2 text-center text-xs font-semibold">
              <div className="space-y-1"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">✓</span><p className="text-[10px] text-[#1D1D1F]">Submitted</p></div>
              <div className="space-y-1"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">✓</span><p className="text-[10px] text-[#1D1D1F]">Accepted</p></div>
              <div className="space-y-1"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">✓</span><p className="text-[10px] text-[#1D1D1F]">In Process</p></div>
              <div className="space-y-1"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">✓</span><p className="text-[10px] text-emerald-600 font-bold">Released</p></div>
              <div className="space-y-1"><span className="w-6 h-6 rounded-full bg-slate-200 text-[#86868B] inline-flex items-center justify-center">5</span><p className="text-[10px] text-[#86868B]">Finalized</p></div>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span><strong>Entry released by customs.</strong> Your shipment has been cleared.</span>
            </div>
          </div>

          {/* Entry & Duty Details Breakdown Table */}
          <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Entry & Duty Details</h3>

            {/* Top 4 Duty Cards */}
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]"><p className="text-[10px] text-[#86868B]">Merchandise Value</p><p className="font-bold text-[#1D1D1F]">USD $17,750.00</p></div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]"><p className="text-[10px] text-[#86868B]">Duties</p><p className="font-bold text-[#1D1D1F]">USD $2,850.00</p></div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]"><p className="text-[10px] text-[#86868B]">Taxes (Fed/State)</p><p className="font-bold text-[#1D1D1F]">USD $13,100.00</p></div>
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200"><p className="text-[10px] text-emerald-700">Total Paid</p><p className="font-extrabold text-emerald-700">USD $16,250.00</p></div>
            </div>

            {/* Itemized Duty Table */}
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E5EA] text-[#86868B]">
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2">Taxable Amount (USD)</th>
                  <th className="pb-2 text-right">Amount (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5EA]">
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Duty</td><td className="py-2 text-[#86868B]">Basic Customs Duty</td><td className="py-2 text-[#1D1D1F]">2.50%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">443.75</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Duty</td><td className="py-2 text-[#86868B]">Additional Duty (301)</td><td className="py-2 text-[#1D1D1F]">7.50%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">1,331.25</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Tax</td><td className="py-2 text-[#86868B]">Merchandise Processing Fee</td><td className="py-2 text-[#1D1D1F]">0.3464%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">61.48</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Tax</td><td className="py-2 text-[#86868B]">Harbor Maintenance Fee</td><td className="py-2 text-[#1D1D1F]">0.125%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">22.19</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Tax</td><td className="py-2 text-[#86868B]">Estimated Duty Tax (State)</td><td className="py-2 text-[#1D1D1F]">8.50%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">1,508.75</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Tax</td><td className="py-2 text-[#86868B]">Customs User Fee (MPF)</td><td className="py-2 text-[#1D1D1F]">0.00346%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">0.61</td></tr>
                <tr><td className="py-2 font-bold text-[#1D1D1F]">Tax</td><td className="py-2 text-[#86868B]">FDA User Fee</td><td className="py-2 text-[#1D1D1F]">0.010%</td><td className="py-2 text-[#1D1D1F]">17,750.00</td><td className="py-2 text-right font-bold text-[#1D1D1F]">1.78</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Customs Responses & AI Support (3 Cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Customs Responses Feed */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Customs Responses</h3>

            <div className="space-y-3 text-xs">
              {[
                { title: "ACK - Acceptance", desc: "Customs has accepted your entry summary.", status: "Accepted", time: "12 May 2026 10:33 AM", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
                { title: "RFRA - Additional Info Request", desc: "Request for FDA registration number.", status: "Responded", time: "12 May 2026 11:02 AM", color: "text-blue-600 bg-blue-50 border-blue-200" },
                { title: "AOC - Advice of Continuation", desc: "Your entry is in process.", status: "In Process", time: "12 May 2026 11:45 AM", color: "text-amber-600 bg-amber-50 border-amber-200" },
                { title: "RELE - Release", desc: "Entry released by customs.", status: "Released", time: "12 May 2026 02:15 PM", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
              ].map((r, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-[#1D1D1F]">{r.title}</p>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${r.color}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#86868B]">{r.desc}</p>
                  <p className="text-[9px] text-[#86868B]">{r.time}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Support Box */}
          <div className="bg-gradient-to-br from-[#0071E3]/5 to-purple-50 p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[#0071E3]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">AI Support</h3>
            </div>

            <div className="space-y-1.5 text-xs">
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                Why did customs ask for additional info?
              </button>
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                Explain this customs response
              </button>
              <button className="w-full text-left p-2 rounded-xl bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] transition-all">
                What happens after release?
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
