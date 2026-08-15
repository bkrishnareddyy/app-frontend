"use client";

import { useState, useEffect } from "react";
import { Edit2, Check, X } from "lucide-react";
import { caughtMessage } from "@/lib/utils";
import { displayCurrency } from "@/lib/honest";

import { extendedAmount } from "./workspaceTypes";
import type { HtsSuggestion, ShipmentLineItemRow as LineItem } from "./workspaceTypes";
import { LineItemDetailTabsModal } from "./LineItemDetailTabsModal";

interface LineItemsTableProps {
  shipmentId: string;
  initialLineItems: LineItem[];
  isEnterpriseAdmin?: boolean;
  /**
   * ISO code the amounts are denominated in, or null when no document declared
   * one. Null renders bare numbers: the invoice behind this table can be in any
   * currency, and stamping a symbol on it we haven't read is a misstatement of
   * value, not a formatting nicety.
   */
  currency?: string | null;
}

export function LineItemsTable({ shipmentId, initialLineItems, currency }: LineItemsTableProps) {
  const [lineItems, setLineItems] = useState<LineItem[]>(initialLineItems);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [selectedDetailItem, setSelectedDetailItem] = useState<LineItem | null>(null);
  
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

  // Sorted for display regardless of what the caller passed. One source is a
  // database relation and the other is the order a model happened to emit items
  // in, and neither guarantees ascending lines. Sorted here so a fix is not
  // needed once per call site.
  const orderedLineItems = [...lineItems].sort((a, b) => a.lineNumber - b.lineNumber);

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between text-xs font-bold text-ink">
        <span>Extracted Line Items ({lineItems.length})</span>
      </div>
      {lineItems.length > 0 ? (
        <div className="border border-border rounded-xl text-xs max-h-96 overflow-y-auto">
          {/*
            Fixed layout with declared column widths, so the table is always exactly
            as wide as its container and never scrolls sideways.

            With automatic layout the columns sized themselves to their content, the
            row outgrew the panel -- opening a row for edit swaps two text cells for
            inputs and adds around 9rem -- and because overflow-y-auto makes
            overflow-x compute to auto, the overflow became a horizontal scrollbar
            that carried Total and Action out of sight. Widths must total 100.
          */}
          <table className="w-full table-fixed text-left border-collapse">
            <thead className="bg-surface-muted text-[10px] font-bold text-ink-muted uppercase border-b border-border">
              <tr>
                <th className="p-2.5 w-[6%]">Line</th>
                <th className="p-2.5 w-[30%]">Description</th>
                <th className="p-2.5 w-[20%]">HTS Code</th>
                <th className="p-2.5 w-[12%]">Origin</th>
                <th className="p-2.5 w-[8%] text-right">Qty</th>
                <th className="p-2.5 w-[15%] text-right">Total</th>
                <th className="p-2.5 w-[9%] text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orderedLineItems.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <tr key={item.id} className="hover:bg-surface-muted/30 transition-colors">
                    <td className="p-2.5 font-mono text-ink-muted font-semibold">{item.lineNumber}</td>
                    {/*
                      break-words, not truncate: descriptions arrive as long unbroken
                      runs like "TOPS,DRESSES,PULLOVERS,SUITS,C" that carry no space
                      to wrap at, and a customs description clipped mid-word is not a
                      description. The fixed column width bounds them instead.
                    */}
                    <td className="p-2.5 font-bold text-ink break-words">{item.description}</td>
                    
                    {/* HTS Code Column */}
                    <td className="p-2.5 font-mono relative">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editHts}
                            onChange={(e) => setEditHts(e.target.value)}
                            placeholder="Search HTS Code..."
                            className="w-full min-w-0 px-2 py-1 border border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white font-mono text-[11px]"
                            disabled={saveLoading}
                          />
                          {/* Autocomplete dropdown */}
                          {htsSuggestions.length > 0 && (
                            <div className="absolute left-2.5 z-40 bg-white border border-border rounded-xl shadow-lg mt-1 w-64 p-1.5 space-y-1 max-h-48 overflow-y-auto">
                              <p className="text-[9px] text-ink-muted font-bold px-1.5 uppercase tracking-wider">HTS Code Suggestions</p>
                              {htsSuggestions.map((sugg) => (
                                <button
                                  key={sugg.id}
                                  onClick={() => {
                                    setEditHts(sugg.htsNumberDisplay);
                                    setHtsSuggestions([]);
                                  }}
                                  className="w-full text-left p-1.5 rounded-lg hover:bg-surface-muted text-[10px] space-y-0.5 block transition-colors cursor-pointer"
                                >
                                  <span className="font-mono font-bold text-brand">{sugg.htsNumberDisplay}</span>
                                  <span className="text-ink-muted block truncate leading-snug">{sugg.description}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-brand font-semibold">{item.htsCode}</span>
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
                          className="w-full min-w-0 px-2 py-1 border border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white text-[11px]"
                          disabled={saveLoading}
                        />
                      ) : (
                        <span className="font-medium text-ink">{item.countryOfOrigin}</span>
                      )}
                    </td>

                    <td className="p-2.5 text-right font-mono">{item.quantity}</td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      {(() => {
                        const amount = extendedAmount(item);
                        if (amount === null) {
                          return (
                            <span className="text-ink-muted font-normal" title="No amount on the source document">
                              —
                            </span>
                          );
                        }
                        return currency
                          ? displayCurrency(amount, currency)
                          : amount.toLocaleString();
                      })()}
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
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => handleStartEdit(item)}
                            className="p-1 rounded-lg hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors cursor-pointer"
                            title="Edit HTS & Origin"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setSelectedDetailItem(item)}
                            className="px-2 py-0.5 rounded-md bg-brand/10 text-brand font-semibold text-[10px] hover:bg-brand/20 transition-colors cursor-pointer"
                            title="Open Advisory & Valuation Tabs"
                          >
                            Tabs
                          </button>
                        </div>
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

      {selectedDetailItem && (
        <LineItemDetailTabsModal
          item={selectedDetailItem}
          shipmentId={shipmentId}
          onClose={() => setSelectedDetailItem(null)}
        />
      )}
    </div>
  );
}
