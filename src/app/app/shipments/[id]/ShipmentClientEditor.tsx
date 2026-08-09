"use client";

import { useState } from "react";
import { Edit2, Check, X, Building2 } from "lucide-react";

interface ShipmentClientEditorProps {
  shipmentId: string;
  initialClientId: string | null;
  initialClientName: string | null;
  clients: Array<{ id: string; name: string }>;
  canEdit: boolean;
}

export function ShipmentClientEditor({
  shipmentId,
  initialClientId,
  initialClientName,
  clients,
  canEdit,
}: ShipmentClientEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (clientId === (initialClientId ?? "")) {
      setIsEditing(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId || null }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to update client");
      }

      setIsEditing(false);
      window.location.reload();
    } catch (err: any) {
      alert(err.message || "Failed to update client");
      setClientId(initialClientId ?? "");
    } finally {
      setLoading(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center space-x-2">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={loading}
          autoFocus
          className="px-3 py-1 text-xs font-semibold text-[#1D1D1F] border border-[#0071E3] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white"
        >
          <option value="">No Client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleSave}
          disabled={loading}
          className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl hover:bg-emerald-100 cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => {
            setIsEditing(false);
            setClientId(initialClientId ?? "");
          }}
          disabled={loading}
          className="p-1.5 bg-red-50 text-red-700 border border-red-200 rounded-xl hover:bg-red-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-1.5 group">
      {initialClientName ? (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#0071E3]/10 text-[#0071E3]">
          <Building2 className="w-3 h-3" />
          <span>{initialClientName}</span>
        </span>
      ) : (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F5F7] text-[#86868B] border border-[#E5E5EA]">
          <Building2 className="w-3 h-3" />
          <span>No Client</span>
        </span>
      )}
      {canEdit && (
        <button
          onClick={() => setIsEditing(true)}
          className="p-1 rounded-lg hover:bg-[#F5F5F7] text-[#86868B]/80 hover:text-[#1D1D1F] transition-all cursor-pointer opacity-0 group-hover:opacity-100"
          title="Edit Client"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
