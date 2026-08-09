"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Package, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import { ENTRY_TYPES } from "@/modules/filing/entryType";

export default function NewShipmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);

  // Every field has a placeholder; pre-filling them produced shipments full of
  // invented importer, carrier and port data for anyone who just pressed Create.
  const [formData, setFormData] = useState({
    importerName: "",
    poReference: "",
    entryType: "",
    incoterm: "",
    portOfEntry: "",
    carrierName: "",
    countryOfExport: "",
    estimatedArrival: "",
    clientId: "",
  });

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients || []))
      .catch((err) => console.error("Failed to fetch clients:", err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, clientId: formData.clientId || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Failed to create shipment");
      }

      const shipmentId = data.shipment?.id;
      if (shipmentId) {
        router.push(`/app/shipments/${shipmentId}`);
      } else {
        router.push("/app/shipments");
      }
    } catch (err: unknown) {
      console.error("Error creating shipment:", err);
      setError(err instanceof Error ? err.message : "Failed to create shipment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex items-center space-x-4">
        <Link
          href="/app/dashboard"
          className="p-2 bg-white border border-[#E5E5EA] rounded-xl hover:bg-[#F5F5F7] transition-all text-[#1D1D1F]"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#0071E3]/10 text-[#0071E3]">
              Shipment Management
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1D1D1F] mt-1">Create New Shipment</h1>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center space-x-3 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Form Card */}
      <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6">
        <div className="border-b border-[#E5E5EA] pb-4 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#1D1D1F]">Shipment & Importer Details</h2>
            <p className="text-xs text-[#86868B]">Enter logistics details to initialize compliance checking & document ingestion.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Importer Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Importer of Record Name *</label>
            <input
              type="text"
              required
              value={formData.importerName}
              onChange={(e) => setFormData({ ...formData, importerName: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. ABC Manufacturing India Pvt Ltd"
            />
          </div>

          {/* PO Reference */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Purchase Order (PO) Reference</label>
            <input
              type="text"
              value={formData.poReference}
              onChange={(e) => setFormData({ ...formData, poReference: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. PO-778899"
            />
          </div>

          {/* Entry Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Customs Entry Type</label>
            <select
              value={formData.entryType}
              onChange={(e) => setFormData({ ...formData, entryType: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
            >
              <option value="">Select an entry type</option>
              {ENTRY_TYPES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.code} — {entry.label}
                </option>
              ))}
            </select>
          </div>

          {/* Incoterm */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Incoterms & Delivery Port</label>
            <input
              type="text"
              value={formData.incoterm}
              onChange={(e) => setFormData({ ...formData, incoterm: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. CIF Los Angeles"
            />
          </div>

          {/* Port of Entry */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">US Port of Entry</label>
            <input
              type="text"
              value={formData.portOfEntry}
              onChange={(e) => setFormData({ ...formData, portOfEntry: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. Port of Los Angeles (2704)"
            />
          </div>

          {/* Carrier Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Carrier / Ocean Vessel</label>
            <input
              type="text"
              value={formData.carrierName}
              onChange={(e) => setFormData({ ...formData, carrierName: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. Maersk Line"
            />
          </div>

          {/* Country of Export */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Country of Export</label>
            <input
              type="text"
              value={formData.countryOfExport}
              onChange={(e) => setFormData({ ...formData, countryOfExport: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
              placeholder="e.g. Germany"
            />
          </div>

          {/* Estimated Arrival */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Estimated Date of Arrival (ETA)</label>
            <input
              type="date"
              value={formData.estimatedArrival}
              onChange={(e) => setFormData({ ...formData, estimatedArrival: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
            />
          </div>

          {/* Client */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F]">Client</label>
            <select
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
            >
              <option value="">No Client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-[#E5E5EA] flex items-center justify-end space-x-3">
          <Link
            href="/app/dashboard"
            className="px-4 py-2.5 border border-[#E5E5EA] text-[#1D1D1F] hover:bg-[#F5F5F7] text-xs font-semibold rounded-xl transition-all"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating Shipment...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Initialize Shipment</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
