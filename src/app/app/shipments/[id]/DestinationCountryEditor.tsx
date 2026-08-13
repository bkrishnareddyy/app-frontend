"use client";

import { useState } from "react";
import { Edit2, Check, X, Globe2 } from "lucide-react";
import { caughtMessage } from "@/lib/utils";
import { COUNTRIES } from "@/modules/shipment/countryCode";

interface DestinationCountryEditorProps {
  shipmentId: string;
  initialDestinationCountry: string | null;
  canEdit: boolean;
}

/**
 * Every canonical-messaging config table (procedure mapping, message catalog,
 * response-status mapping, action rules) keys its wildcard lookup on this
 * exact value -- never inferred, because a wrong destination silently
 * misfiles an entry. This is the only UI path that writes it.
 */
export function DestinationCountryEditor({
  shipmentId,
  initialDestinationCountry,
  canEdit,
}: DestinationCountryEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialDestinationCountry ?? "");
  const [loading, setLoading] = useState(false);

  const label = COUNTRIES.find((c) => c.code === initialDestinationCountry)?.name ?? initialDestinationCountry;

  const handleSave = async () => {
    if (value === (initialDestinationCountry ?? "")) {
      setIsEditing(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationCountry: value || null }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to update destination country");
      }

      setIsEditing(false);
      window.location.reload();
    } catch (err) {
      alert(caughtMessage(err, "Failed to update destination country"));
      setValue(initialDestinationCountry ?? "");
    } finally {
      setLoading(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center space-x-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
          autoFocus
          className="px-3 py-1 text-xs font-semibold text-ink border border-brand rounded-xl focus:outline-none focus:ring-1 focus:ring-brand bg-white"
        >
          <option value="">Not set</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
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
            setValue(initialDestinationCountry ?? "");
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
      {initialDestinationCountry ? (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand/10 text-brand">
          <Globe2 className="w-3 h-3" />
          <span>{label}</span>
        </span>
      ) : (
        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Globe2 className="w-3 h-3" />
          <span>Destination not set</span>
        </span>
      )}
      {canEdit && (
        <button
          onClick={() => setIsEditing(true)}
          className="p-1 rounded-lg hover:bg-surface-muted text-ink-muted/80 hover:text-ink transition-all cursor-pointer opacity-0 group-hover:opacity-100"
          title="Edit Destination Country"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
