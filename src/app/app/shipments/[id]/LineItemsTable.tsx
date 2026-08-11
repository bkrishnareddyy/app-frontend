"use client";

import { useState, useEffect } from "react";
import { Edit2, Check, X } from "lucide-react";
import { caughtMessage } from "@/lib/utils";

import type { HtsSuggestion, ShipmentLineItemRow as LineItem } from "./workspaceTypes";

interface LineItemsTableProps {
  shipmentId: string;
  initialLineItems: LineItem[];
  isEnterpriseAdmin?: boolean;
}

export function LineItemsTable({ shipmentId, initialLineItems }: LineItemsTableProps) {
  const [lineItems, setLineItems] = useState<LineItem[]>(initialLineItems);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  
  // Inline edit state
  const [editHts, setEditHts] = useState("");
  const [editCoo, setEditCoo] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [htsSuggestions, setHtsSuggestions] = useState<HtsSuggestion[]>([]);

  useEffect(() => {
    if (editingItemId && editHts.trim().length >= 2) {
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/hts/search?q=${encodeURIComponent(editHts.trim())}&limit=5`);
          if (res.ok) {
            const data = await res.json();
            setHtsSuggestions(data.items || []);
          }
        } catch (err) {
          console.error("Failed to query HTS suggestions:", err);
        }
      }, 300);

      return () => clearTimeout(timer);
    } else {
      
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHtsSuggestions([]);
    }
  }, [editHts, editingItemId]);

  const handleStartEdit = (item: LineItem) => {
    setEditingItemId(item.id);
    setEditHts(item.htsCode);
    setEditCoo(item.countryOfOrigin);
    setHtsSuggestions([]);
  };

  const handleSave = async (itemId: string) => {
    if (editHts.trim() === "" || editCoo.trim() === "") return;
    setSaveLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lineItems: [
            {
              id: itemId,
              htsCode: editHts.trim(),
              countryOfOrigin: editCoo.trim(),
            },
          ],
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to update line item");
      }

      setLineItems(
        lineItems.map((item) =>
          item.id === itemId
            ? { ...item, htsCode: editHts.trim(), countryOfOrigin: editCoo.trim(), htsConfidence: 100 }
            : item
        )
      );
      setEditingItemId(null);
      
      // Highlight update to other parent lists
      window.location.reload();
    } catch (err) {
      alert(caughtMessage(err, "Failed to save changes"));
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between text-xs font-bold text-[#1D1D1F]">
        <span>Extracted Line Items ({lineItems.length})</span>
      </div>
      {lineItems.length > 0 ? (
        <div className="border border-[#E5E5EA] rounded-xl overflow-visible text-xs max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F5F5F7] text-[10px] font-bold text-[#86868B] uppercase border-b border-[#E5E5EA]">
              <tr>
                <th className="p-2.5">Line</th>
                <th className="p-2.5">Description</th>
                <th className="p-2.5">HTS Code</th>
                <th className="p-2.5">Origin</th>
                <th className="p-2.5 text-right">Qty</th>
                <th className="p-2.5 text-right">Total</th>
                <th className="p-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {lineItems.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <tr key={item.id} className="hover:bg-[#F5F5F7]/30 transition-colors">
                    <td className="p-2.5 font-mono text-[#86868B] font-semibold">{item.lineNumber}</td>
                    <td className="p-2.5 font-bold text-[#1D1D1F] max-w-xs break-words">{item.description}</td>
                    
                    {/* HTS Code Column */}
                    <td className="p-2.5 font-mono relative">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editHts}
                            onChange={(e) => setEditHts(e.target.value)}
                            placeholder="Search HTS Code..."
                            className="w-32 px-2 py-1 border border-[#0071E3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white font-mono text-[11px]"
                            disabled={saveLoading}
                          />
                          {/* Autocomplete dropdown */}
                          {htsSuggestions.length > 0 && (
                            <div className="absolute left-2.5 z-40 bg-white border border-[#E5E5EA] rounded-xl shadow-lg mt-1 w-64 p-1.5 space-y-1 max-h-48 overflow-y-auto">
                              <p className="text-[9px] text-[#86868B] font-bold px-1.5 uppercase tracking-wider">HTS Code Suggestions</p>
                              {htsSuggestions.map((sugg) => (
                                <button
                                  key={sugg.id}
                                  onClick={() => {
                                    setEditHts(sugg.htsNumberDisplay);
                                    setHtsSuggestions([]);
                                  }}
                                  className="w-full text-left p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[10px] space-y-0.5 block transition-colors cursor-pointer"
                                >
                                  <span className="font-mono font-bold text-[#0071E3]">{sugg.htsNumberDisplay}</span>
                                  <span className="text-[#86868B] block truncate leading-snug">{sugg.description}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#0071E3] font-semibold">{item.htsCode}</span>
                      )}
                    </td>

                    {/* Country of Origin Column */}
                    <td className="p-2.5">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editCoo}
                          onChange={(e) => setEditCoo(e.target.value)}
                          placeholder="e.g. Germany"
                          className="w-24 px-2 py-1 border border-[#0071E3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white text-[11px]"
                          disabled={saveLoading}
                        />
                      ) : (
                        <span className="font-medium text-[#1D1D1F]">{item.countryOfOrigin}</span>
                      )}
                    </td>

                    <td className="p-2.5 text-right font-mono">{item.quantity}</td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      ${(Number(item.quantity) * Number(item.unitPrice)).toLocaleString()}
                    </td>
                    
                    {/* Inline edit actions */}
                    <td className="p-2.5 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => handleSave(item.id)}
                            disabled={saveLoading}
                            className="p-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
                            title="Save Changes"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingItemId(null)}
                            disabled={saveLoading}
                            className="p-1 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 cursor-pointer"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="p-1 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
                          title="Edit HTS & Origin"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
          <p className="font-bold">No Commercial Line Items Extracted</p>
          <p className="text-[11px]">Line items will appear here automatically upon document vision extraction.</p>
        </div>
      )}
    </div>
  );
}
