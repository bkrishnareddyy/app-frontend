"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  FileText,
  BadgeCheck,
  TrendingUp,
  AlertTriangle,
  History,
  Coins,
  ArrowRight,
  ClipboardCheck,
} from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface RefundOpportunity {
  id: string;
  opportunityType: string;
  estimatedRefundAmount: number;
  confidence: number;
  status: string;
  filingEntryNumber: string;
}

interface DrawbackLot {
  id: string;
  entryNumber: string;
  htsCode: string;
  quantity: number;
  availableQty: number;
  dutyPaidPerUnit: number;
  exportDeadline: string;
}

interface Section301Stat {
  list: string;
  entries: number;
  dutyPaid: number;
}

export function VaultClient() {
  const [activeTab, setActiveTab] = useState<"opportunities" | "drawback" | "section301">("opportunities");
  
  // Opportunities state
  const [opportunities, setOpportunities] = useState<RefundOpportunity[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  // Drawback state
  const [lots, setLots] = useState<DrawbackLot[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [isMatching, setIsMatching] = useState(false);

  // Section 301 state
  const [section301Stats, setSection301Stats] = useState<Section301Stat[]>([]);
  const [total301Entries, setTotal301Entries] = useState(0);
  const [total301DutyPaid, setTotal301DutyPaid] = useState(0);

  useEffect(() => {
    loadOpportunities();
    loadDrawbackData();
    loadSection301Data();
  }, []);

  const loadOpportunities = () => {
    fetch("/api/refunds/opportunities/scan", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.opportunities) {
          setOpportunities(data.opportunities);
        }
      })
      .catch(console.error);
  };

  const loadDrawbackData = () => {
    // Fetch Drawback Claims
    fetch("/api/drawback/claims")
      .then((res) => res.json())
      .then((data) => {
        if (data.drawbackClaims) setClaims(data.drawbackClaims);
      })
      .catch(console.error);

    // Fetch mock/available lots for layout representation
    setLots([
      {
        id: "lot_1",
        entryNumber: "ENT-2026-000001",
        htsCode: "8541.43.0010",
        quantity: 1000,
        availableQty: 1000,
        dutyPaidPerUnit: 2.50,
        exportDeadline: "2031-08-13",
      },
      {
        id: "lot_2",
        entryNumber: "ENT-2026-000002",
        htsCode: "8471.30.0100",
        quantity: 500,
        availableQty: 250,
        dutyPaidPerUnit: 4.80,
        exportDeadline: "2031-09-01",
      }
    ]);
  };

  const loadSection301Data = () => {
    fetch("/api/refunds/section301")
      .then((res) => res.json())
      .then((data) => {
        if (data.byList) {
          setSection301Stats(data.byList);
          setTotal301Entries(data.totalEntries);
          setTotal301DutyPaid(data.totalDutyPaid);
        }
      })
      .catch(console.error);
  };

  const triggerScan = async () => {
    setIsScanning(true);
    setScanMessage("Scanning entry historical files for duty savings...");
    try {
      const res = await fetch("/api/refunds/opportunities/scan", { method: "POST" });
      const data = await res.json();
      setOpportunities(data.opportunities || []);
      setScanMessage(data.message);
    } catch {
      setScanMessage("Scan failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const triggerDrawbackMatch = async () => {
    setIsMatching(true);
    try {
      const matchRes = await fetch("/api/drawback/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchMethod: "FIFO" }),
      });
      const matchData = await matchRes.json();

      if (matchData.proposedMatches && matchData.proposedMatches.length > 0) {
        // Create draft claim from matches
        const claimRes = await fetch("/api/drawback/claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimType: "unused_merchandise",
            matches: matchData.proposedMatches,
          }),
        });
        const claimData = await claimRes.json();
        if (claimData.drawbackClaim) {
          alert(`Draft Drawback Claim Created: ${claimData.internalRef}`);
          loadDrawbackData();
        }
      } else {
        alert("No export lots found matching available import lots.");
      }
    } catch (e) {
      alert("Error matching lots.");
    } finally {
      setIsMatching(false);
    }
  };

  // Task A-5 Opportunity ranking logic: 1. Confirmed recovery amount DESC, 2. confidence DESC, 3. deadline proximity ASC
  const sortedOpportunities = [...opportunities].sort((a, b) => {
    if (a.status === "Confirmed" && b.status !== "Confirmed") return -1;
    if (a.status !== "Confirmed" && b.status === "Confirmed") return 1;
    const amountA = a.estimatedRefundAmount ?? 0;
    const amountB = b.estimatedRefundAmount ?? 0;
    if (amountB !== amountA) {
      return amountB - amountA;
    }
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    const deadlineA = (a as any).deadline ? new Date((a as any).deadline).getTime() : Infinity;
    const deadlineB = (b as any).deadline ? new Date((b as any).deadline).getTime() : Infinity;
    return deadlineA - deadlineB;
  });

  const confirmedOpportunities = sortedOpportunities.filter(
    (o) => o.status === "Confirmed" || o.status === "Identified"
  );
  const pendingOpportunities = sortedOpportunities.filter((o) => o.status === "Analyzing");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Recovery & Drawback Control Center</h1>
          <p className="text-xs text-slate-500">Identify retroactive exclusions, execute drawback inventory matching, and track refunds.</p>
        </div>

        <button
          onClick={triggerScan}
          disabled={isScanning}
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>{isScanning ? "Scanning..." : "Scan for Refund Opportunities"}</span>
        </button>
      </div>

      {scanMessage && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-800">
          {scanMessage}
        </div>
      )}

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab("opportunities")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "opportunities" ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Refund Opportunities ({opportunities.length})
        </button>
        <button
          onClick={() => setActiveTab("drawback")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "drawback" ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Drawback Matching & Claims
        </button>
        <button
          onClick={() => setActiveTab("section301")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "section301" ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Section 301 Readiness Inventory
        </button>
      </div>

      {/* Opportunities Tab */}
      {activeTab === "opportunities" && (
        <div className="space-y-6">
          {/* High Confidence / Confirmed Opportunities */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-emerald-600" />
              <span>Confirmed & High-Confidence Savings</span>
            </h3>

            {confirmedOpportunities.length === 0 ? (
              <p className="text-xs text-slate-500">No active recovery opportunities identified yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {confirmedOpportunities.map((opp) => (
                  <div key={opp.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-4">
                    <div>
                      <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded-md text-[10px] font-bold text-indigo-700 block w-max mb-1">
                        {opp.opportunityType.replace(/_/g, " ")}
                      </span>
                      <p className="text-xs font-bold text-slate-800">Filing Ref: {opp.filingEntryNumber || "Retroactive Review"}</p>
                      <p className="text-[10px] text-slate-500">Confidence Match: {opp.confidence}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-extrabold text-emerald-700">+{displayCurrency(opp.estimatedRefundAmount, "USD")}</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {opp.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Analyzing Opportunities */}
          {pendingOpportunities.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-500" />
                <span>Opportunities Currently in Analysis</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingOpportunities.map((opp) => (
                  <div key={opp.id} className="p-4 bg-amber-50/30 border border-amber-200 rounded-xl flex items-start justify-between gap-4">
                    <div>
                      <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-md text-[10px] font-bold text-amber-700 block w-max mb-1">
                        {opp.opportunityType.replace(/_/g, " ")}
                      </span>
                      <p className="text-xs font-bold text-slate-800">Filing Ref: {opp.filingEntryNumber || "Awaiting Data"}</p>
                      <p className="text-[10px] text-slate-500">Confidence: {opp.confidence}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-extrabold text-amber-600">Pending</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Analyzing
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drawback Tab */}
      {activeTab === "drawback" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Available Lots */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Coins className="w-4 h-4 text-brand" />
                <span>Eligible Import Lots (Unused Merchandise & Manufacturing)</span>
              </h3>

              <button
                onClick={triggerDrawbackMatch}
                disabled={isMatching}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{isMatching ? "Matching..." : "Create Drawback Claim"}</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-800">
                <thead className="bg-slate-50 uppercase tracking-wider text-[10px] font-bold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Import Entry</th>
                    <th className="py-2.5 px-3">HTS Code</th>
                    <th className="py-2.5 px-3 text-right">Available Qty</th>
                    <th className="py-2.5 px-3 text-right">Attributed Duty / Unit</th>
                    <th className="py-2.5 px-3 text-right">Export Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="py-3 px-3 font-mono font-bold text-brand">{lot.entryNumber}</td>
                      <td className="py-3 px-3">{lot.htsCode}</td>
                      <td className="py-3 px-3 text-right font-bold">{lot.availableQty} / {lot.quantity}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-semibold">{displayCurrency(lot.dutyPaidPerUnit, "USD")}</td>
                      <td className="py-3 px-3 text-right text-red-600 font-semibold">{lot.exportDeadline}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historical / Draft Claims */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600" />
              <span>Drawback Claim Log</span>
            </h3>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {claims.length === 0 ? (
                <p className="text-xs text-slate-500">No drawback claims registered yet.</p>
              ) : (
                claims.map((claim) => (
                  <div key={claim.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                    <p className="text-xs font-bold text-slate-800">{claim.cbpClaimNumber || "Draft Claim"}</p>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500">Type: {claim.claimType.replace(/_/g, " ")}</span>
                      <span className="font-extrabold text-emerald-700">{displayCurrency(Number(claim.totalRefundClaimed), "USD")}</span>
                    </div>
                    <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      {claim.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 301 Tab */}
      {activeTab === "section301" && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Total China Entries</span>
              <span className="text-xl font-extrabold text-slate-800">{total301Entries}</span>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Total Section 301 Paid</span>
              <span className="text-xl font-extrabold text-red-600">{displayCurrency(total301DutyPaid, "USD")}</span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Historical Exclusions Inventory By Tranche List</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {section301Stats.map((stat) => (
                <div key={stat.list} className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs font-bold text-slate-800">{stat.list}</p>
                  <div className="flex justify-between text-[11px] mt-2">
                    <span className="text-slate-500">Entries: {stat.entries}</span>
                    <span className="font-bold text-slate-700">{displayCurrency(stat.dutyPaid, "USD")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
