"use client";

import { useState } from "react";
import { Edit2, Check, X } from "lucide-react";
import { caughtMessage } from "@/lib/utils";

interface ShipmentTitleEditorProps {
  shipmentId: string;
  initialShipmentNumber: string;
  isEnterpriseAdmin: boolean;
}

export function ShipmentTitleEditor({
  shipmentId,
  initialShipmentNumber,
  isEnterpriseAdmin,
}: ShipmentTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initialShipmentNumber);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (title.trim() === "" || title.trim() === initialShipmentNumber) {
      setIsEditing(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shipmentNumber: title.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to rename shipment");
      }

      setIsEditing(false);
      window.location.reload(); // Refresh the page to update the URL/sidebar
    } catch (err) {
      alert(caughtMessage(err, "Failed to rename shipment"));
      setTitle(initialShipmentNumber);
    } finally {
      setLoading(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setIsEditing(false);
              setTitle(initialShipmentNumber);
            }
          }}
          className="px-3 py-1 text-2xl font-extrabold text-[#1D1D1F] border border-[#0071E3] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white w-72"
          disabled={loading}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="p-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl hover:bg-emerald-100 cursor-pointer"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setIsEditing(false);
            setTitle(initialShipmentNumber);
          }}
          disabled={loading}
          className="p-2 bg-red-50 text-red-700 border border-red-200 rounded-xl hover:bg-red-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 group">
      <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">
        {title}
      </h1>
      {isEnterpriseAdmin && (
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B]/80 hover:text-[#1D1D1F] transition-all cursor-pointer"
          title="Rename Shipment"
        >
          <Edit2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
