"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  Scale,
  Sparkles,
  BarChart4,
} from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface Scenario {
  id: string;
  name: string;
  originCountry: string;
  htsReleaseDate?: string;
  totalDuty: number;
  totalMpf: number;
  totalHmf: number;
  totalLandedCost: number;
}

export default function SimulatorPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [newOrigin, setNewOrigin] = useState("China");
  const [htsCode, setHtsCode] = useState("8541.43.0010");

  // Cost inputs for real-time recalculation
  const [unitCost, setUnitCost] = useState(10);
  const [quantity, setQuantity] = useState(5000);
  const [freight, setFreight] = useState(1200);
  const [insurance, setInsurance] = useState(150);
  const [_inland, _setInland] = useState(400);

  // Compare results
  const [comparedScenarios, setComparedScenarios] = useState<Scenario[]>([]);
  const [savingsMatrix, setSavingsMatrix] = useState<any[]>([]);
  const [breakevenVol, setBreakevenVol] = useState<number | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const loadScenarios = async () => {
    try {
      const res = await fetch("/api/simulator/scenarios");
      const data = await res.json();
      if (data.scenarios) {
        setScenarios(data.scenarios.map((s: any) => ({
          id: s.id,
          name: s.name,
          originCountry: s.originCountry,
          htsReleaseDate: s.htsRelease?.effectiveFrom ? String(s.htsRelease.effectiveFrom).split("T")[0] : "2026-01-01",
          totalDuty: Number(s.lineItems[0]?.computedDuty || 0),
          totalMpf: Number(s.lineItems[0]?.computedFees || 0) * 0.7,
          totalHmf: Number(s.lineItems[0]?.computedFees || 0) * 0.3,
          totalLandedCost: Number(s.lineItems[0]?.computedLandedCost || 0),
        })));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadScenarios();
  }, []);

  const createScenario = async () => {
    if (!newScenarioName) return;
    try {
      // 1. Create scenario
      const scRes = await fetch("/api/simulator/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newScenarioName,
          originCountry: newOrigin,
        }),
      });
      const scData = await scRes.json();
      const scId = scData.scenario.id;

      // 2. Add line item
      await fetch(`/api/simulator/scenarios/${scId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          htsCode10: htsCode,
          unitValue: unitCost,
          quantity: quantity,
          freightCost: freight,
          insuranceCost: insurance,
        }),
      });

      // 3. Trigger calculation
      await fetch(`/api/simulator/scenarios/${scId}/calculate`, { method: "POST" });

      setNewScenarioName("");
      loadScenarios();
    } catch (e) {
      console.error(e);
    }
  };

  const runComparison = async () => {
    if (selectedIds.length === 0) return;
    setIsComparing(true);
    try {
      const res = await fetch("/api/simulator/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioIds: selectedIds }),
      });
      const data = await res.json();
      if (data.scenarios) {
        setComparedScenarios(data.scenarios);
        setSavingsMatrix(data.savingsMatrix || []);
        setBreakevenVol(data.breakevenVolume ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsComparing(false);
    }
  };

  const [_baseDutyPct, setBaseDutyPct] = useState(0.028);
  const [section301Pct, setSection301Pct] = useState(0.075);

  useEffect(() => {
    let active = true;
    const fetchRates = async () => {
      try {
        const countryCode = newOrigin === "China" ? "CN" : newOrigin === "Vietnam" ? "VN" : newOrigin === "Mexico" ? "MX" : "IN";
        const res = await fetch(`/api/v1/hts/codes/${encodeURIComponent(htsCode)}/rates?countryOfOrigin=${countryCode}&value=${unitCost * quantity}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (data.dutyStack) {
          const totalVal = unitCost * quantity;
          const base = totalVal > 0 ? data.dutyStack.base / totalVal : 0.028;
          const sec301 = totalVal > 0 ? data.dutyStack.section301 / totalVal : 0.0;
          setBaseDutyPct(Number.isFinite(base) ? base : 0.028);
          setSection301Pct(Number.isFinite(sec301) ? sec301 : 0.0);
        }
      } catch (err) {
        console.error("Failed to fetch HTS rates in simulator UI:", err);
      }
    };
    fetchRates();
    return () => { active = false; };
  }, [htsCode, newOrigin, unitCost, quantity]);

  const toggleSelectScenario = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Sourcing Breakeven Analysis (Task D-4)
  const displayBreakeven = breakevenVol !== null && breakevenVol > 0
    ? breakevenVol
    : Math.round((freight * 1.5) / (section301Pct > 0 ? section301Pct : 0.075));

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Tariff & Sourcing Simulator</h1>
        <p className="text-xs text-slate-500">Model landed cost scenarios, evaluate alternative sourcing, and compare duty stack delta.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Setup & Scenario Creator */}
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Create New Sourcing Scenario</h3>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Scenario Name</label>
                <input
                  type="text"
                  placeholder="e.g. Foxconn Vietnam Shift"
                  value={newScenarioName}
                  onChange={(e) => setNewScenarioName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Origin Country</label>
                  <select
                    value={newOrigin}
                    onChange={(e) => setNewOrigin(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="China">China</option>
                    <option value="Vietnam">Vietnam</option>
                    <option value="Mexico">Mexico</option>
                    <option value="India">India</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">HTS Code</label>
                  <input
                    type="text"
                    value={htsCode}
                    onChange={(e) => setHtsCode(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pt-2 border-t border-slate-100">Landed Cost Components</h4>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Unit Cost ($)</label>
                  <input
                    type="number"
                    value={unitCost}
                    onChange={(e) => setUnitCost(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Quantity</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Freight ($)</label>
                  <input
                    type="number"
                    value={freight}
                    onChange={(e) => setFreight(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Insurance ($)</label>
                  <input
                    type="number"
                    value={insurance}
                    onChange={(e) => setInsurance(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <button
                onClick={createScenario}
                disabled={!newScenarioName}
                className="w-full py-2 bg-brand text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Save & Model Scenario</span>
              </button>
            </div>
          </div>

          {/* Sourcing Comparison Panel */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Alternative Sourcing Breakeven</h3>

            <div className="p-3.5 bg-indigo-50/50 border border-indigo-200 rounded-xl text-xs text-indigo-900 space-y-1">
              <p className="font-bold flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-indigo-700" />
                <span>China vs Vietnam Breakeven Analysis</span>
              </p>
              <p className="text-[11px] text-indigo-800">
                Vietnam scenario is more competitive at higher volumes due to Section 301 savings. Below <span className="font-bold">{displayBreakeven} units</span>, China remains cheaper despite duties.
              </p>
            </div>
          </div>
        </div>

        {/* Center/Right Col: Active Scenarios & Comparison Workspace */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Active Modeling Scenarios</h3>
              <button
                onClick={runComparison}
                disabled={selectedIds.length === 0 || isComparing}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <Scale className="w-4 h-4" />
                <span>{isComparing ? "Comparing..." : "Compare Scenarios"}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scenarios.map((sc) => (
                <div
                  key={sc.id}
                  onClick={() => toggleSelectScenario(sc.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between min-h-[120px] ${
                    selectedIds.includes(sc.id)
                      ? "border-brand bg-brand/5 shadow-2xs"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                        {sc.originCountry}
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(sc.id)}
                        onChange={() => {}}
                        className="rounded text-brand focus:ring-brand"
                      />
                    </div>
                    <h4 className="text-xs font-bold text-slate-800 mt-2">{sc.name}</h4>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200/50 pt-2 mt-2">
                    <span className="text-[10px] text-slate-400">Calculated using HTS Release ({sc.htsReleaseDate || "2026-01-01"})</span>
                    <span className="text-sm font-extrabold text-slate-800">{displayCurrency(sc.totalLandedCost, "USD")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison Output Workspace */}
          {comparedScenarios.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <BarChart4 className="w-4 h-4 text-brand" />
                <span> LCO Landed Cost Breakdown Comparison</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {comparedScenarios.map((sc) => {
                  const savings = savingsMatrix.find((s) => s.scenarioId === sc.id)?.savingsDelta || 0;
                  const dutyPct = sc.totalLandedCost > 0 ? Math.min(100, Math.round((sc.totalDuty / sc.totalLandedCost) * 100)) : 0;
                  const feesPct = sc.totalLandedCost > 0 ? Math.min(100, Math.round(((sc.totalMpf + sc.totalHmf) / sc.totalLandedCost) * 100)) : 0;

                  return (
                    <div key={sc.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">{sc.name}</h4>
                        <span className="text-[10px] text-slate-500">Origin: {sc.originCountry}</span>
                      </div>

                      {/* Visual Component Stack Waterfall Representation */}
                      <div className="space-y-1.5 pt-2">
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Duty stack</span>
                            <span>{displayCurrency(sc.totalDuty, "USD")}</span>
                          </div>
                          <div className="w-full h-1.5 bg-red-100 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500" style={{ width: `${dutyPct}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Fees (MPF/HMF)</span>
                            <span>{displayCurrency(sc.totalMpf + sc.totalHmf, "USD")}</span>
                          </div>
                          <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${feesPct}%` }} />
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-800">Total</span>
                        <span className="text-sm font-extrabold text-slate-900">{displayCurrency(sc.totalLandedCost, "USD")}</span>
                      </div>

                      {savings > 0 && (
                        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[10px] font-bold text-center">
                          Savings Delta: +{displayCurrency(savings, "USD")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
