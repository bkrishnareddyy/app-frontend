"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, ShieldCheck, ChevronDown, ChevronUp, FileText, UserCheck, Edit2, Loader2 } from "lucide-react";
import { FactProvenance } from "@/modules/shipment/canonicalShipmentService";

interface CanonicalFactsSectionProps {
  shipmentId: string;
  facts: FactProvenance[];
  currentCountryOfOrigin: string | null;
}

export function CanonicalFactsSection({ shipmentId, facts, currentCountryOfOrigin }: CanonicalFactsSectionProps) {
  const router = useRouter();
  const [expandedFact, setExpandedFact] = useState<string | null>(null);

  // Edit Origin Modal State -- must default to the shipment's actual current
  // value, not a fixed country, since submitting without changing anything
  // should be a no-op rather than silently overwriting the real origin.
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);
  const [newOrigin, setNewOrigin] = useState(currentCountryOfOrigin || "");
  const [saveLoading, setSaveLoading] = useState(false);

  const handleSaveOrigin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveLoading(true);

    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryOfOrigin: newOrigin }),
      });

      if (res.ok) {
        setIsEditingOrigin(false);
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update country of origin");
      }
    } catch (err) {
      console.error(err);
      alert("Network error updating country of origin");
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4">
        <div>
          <h3 className="text-base font-extrabold text-[#1D1D1F] flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-[#0071E3]" />
            <span>Canonical Shipment Facts & Provenance</span>
          </h3>
          <p className="text-xs text-[#86868B] mt-0.5">
            Qubere&apos;s verified understanding of this shipment compiled from trade documents, user input, and agent intelligence.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              setNewOrigin(currentCountryOfOrigin || "");
              setIsEditingOrigin(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-white border border-[#E5E5EA] text-[#0071E3] font-bold text-xs hover:bg-[#F5F5F7] transition-all flex items-center space-x-1.5 shadow-2xs"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Edit Country of Origin</span>
          </button>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-blue-50 text-[#0071E3] border border-blue-100">
            Source Provenance
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {facts.map((fact) => {
          const isExpanded = expandedFact === fact.field;
          const isConflict = fact.status === "CONFLICT";

          return (
            <div
              key={fact.field}
              onClick={() => setExpandedFact(isExpanded ? null : fact.field)}
              className={`p-4 rounded-2xl border cursor-pointer transition-all select-none ${
                isConflict
                  ? "bg-amber-50/50 border-amber-200 hover:border-amber-300"
                  : "bg-[#F5F5F7]/50 border-[#E5E5EA] hover:border-[#0071E3]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-[#86868B] tracking-wider block mb-1">
                    {fact.field}
                  </span>
                  <div className="text-sm font-bold text-[#1D1D1F] font-mono">{String(fact.value)}</div>
                </div>

                <div className="flex items-center space-x-1.5">
                  {isConflict ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-100 text-amber-800 border border-amber-300 flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span>Conflict</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>{fact.confidence}% Confidence</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-[#E5E5EA] flex items-center justify-between text-xs text-[#86868B]">
                <span>{fact.sources.length} Evidence {fact.sources.length === 1 ? "Source" : "Sources"}</span>
                <span className="text-[#0071E3] font-bold text-[11px] flex items-center space-x-0.5">
                  <span>View Evidence</span>
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </span>
              </div>

              {/* Provenance Evidence Dropdown */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-[#E5E5EA] space-y-2 text-xs">
                  <span className="text-[10px] font-extrabold uppercase text-[#86868B] block">Evidence Breakdown</span>
                  {fact.sources.map((src, idx) => (
                    <div key={idx} className="p-2 rounded-xl bg-white border border-[#E5E5EA] flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {src.sourceType === "USER" ? (
                          <UserCheck className="w-3.5 h-3.5 text-[#0071E3]" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-[#86868B]" />
                        )}
                        <div>
                          <span className="font-bold text-[#1D1D1F] text-[11px]">{src.sourceType}</span>
                          <div className="text-[10px] text-[#86868B] font-mono">{String(src.value)}</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-[#86868B]">{src.confidence}% Match</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Country of Origin Modal */}
      {isEditingOrigin && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#E5E5EA] max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <div>
                <h4 className="text-base font-bold text-[#1D1D1F]">Edit Country of Origin</h4>
                <p className="text-xs text-[#86868B]">
                  Manually update origin state. Selective agents will re-evaluate compliance and preferential tariffs.
                </p>
              </div>
              <button onClick={() => setIsEditingOrigin(false)} className="text-[#86868B] font-bold text-sm">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveOrigin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Country of Origin</label>
                <select
                  value={newOrigin}
                  onChange={(e) => setNewOrigin(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs font-bold text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
                >
                  {!currentCountryOfOrigin && <option value="">Not set — select origin</option>}
                  <option value="Germany">Germany (DE)</option>
                  <option value="India">India (IN)</option>
                  <option value="United States">United States (US)</option>
                  <option value="China">China (CN)</option>
                  <option value="Vietnam">Vietnam (VN)</option>
                  <option value="Mexico">Mexico (MX)</option>
                  <option value="Canada">Canada (CA)</option>
                </select>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#E5E5EA]">
                <button
                  type="button"
                  onClick={() => setIsEditingOrigin(false)}
                  className="px-4 py-2 text-xs font-bold text-[#86868B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveLoading}
                  className="px-5 py-2.5 bg-[#0071E3] text-white text-xs font-bold rounded-xl hover:bg-[#0071E3]/90 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {saveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Edit2 className="w-3.5 h-3.5" />}
                  <span>Save Origin & Re-run Affected Agents</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
