"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Edit2, X } from "lucide-react";
import { displayCurrency, displayPercent, displayText } from "@/lib/honest";

export interface LineItemRow {
  id: string;
  lineNumber: number;
  description: string | null;
  htsCode: string | null;
  htsConfidence: number | null;
  countryOfOrigin: string | null;
  status: string | null;
  quantity: number;
  /** Pre-serialised: a Prisma Decimal cannot cross the server/client boundary. */
  totalValue: string;
}

interface LineItemsTableProps {
  shipmentId: string;
  lineItems: LineItemRow[];
  canEdit: boolean;
}

export function LineItemsTable({ shipmentId, lineItems, canEdit }: LineItemsTableProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [htsCode, setHtsCode] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (item: LineItemRow) => {
    setEditingId(item.id);
    setHtsCode(item.htsCode ?? "");
    setCountryOfOrigin(item.countryOfOrigin ?? "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const save = async (item: LineItemRow) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: [
            {
              id: item.id,
              htsCode: htsCode.trim() || null,
              countryOfOrigin: countryOfOrigin.trim() || null,
            },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error("The classification could not be saved.");
      }
      setEditingId(null);
      // A manual classification re-runs dependent agents, so the whole page is refetched.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The classification could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <div className="border border-[#E5E5EA] rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <caption className="sr-only">Line items extracted for this shipment</caption>
          <thead className="bg-[#F5F5F7] text-[11px] font-bold text-[#6E6E73] uppercase tracking-wider border-b border-[#E5E5EA]">
            <tr>
              <th scope="col" className="p-2.5">Line</th>
              <th scope="col" className="p-2.5">Description</th>
              <th scope="col" className="p-2.5 whitespace-nowrap">HTS code</th>
              <th scope="col" className="p-2.5 whitespace-nowrap">Model confidence</th>
              <th scope="col" className="p-2.5">Origin</th>
              <th scope="col" className="p-2.5">Status</th>
              <th scope="col" className="p-2.5 text-right">Quantity</th>
              <th scope="col" className="p-2.5 text-right whitespace-nowrap">Total value</th>
              {canEdit ? (
                <th scope="col" className="p-2.5 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E5EA]">
            {lineItems.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <tr key={item.id}>
                  <td className="p-2.5 font-mono text-[#6E6E73]">{item.lineNumber}</td>
                  <td className="p-2.5 font-bold text-[#1D1D1F]">{displayText(item.description)}</td>
                  <td className="p-2.5 font-mono text-[#0071E3]">
                    {isEditing ? (
                      <input
                        aria-label={`HTS code for line ${item.lineNumber}`}
                        value={htsCode}
                        onChange={(e) => setHtsCode(e.target.value)}
                        disabled={saving}
                        autoFocus
                        className="w-32 px-2 py-1 font-mono border border-[#0071E3] rounded-lg focus:outline-hidden"
                      />
                    ) : (
                      displayText(item.htsCode, "Not classified")
                    )}
                  </td>
                  <td
                    className={`p-2.5 font-semibold ${
                      item.htsConfidence === null
                        ? "text-[#86868B]"
                        : item.htsConfidence < 80
                          ? "text-amber-700"
                          : "text-emerald-700"
                    }`}
                  >
                    {displayPercent(item.htsConfidence)}
                  </td>
                  <td className="p-2.5 text-[#1D1D1F]">
                    {isEditing ? (
                      <input
                        aria-label={`Country of origin for line ${item.lineNumber}`}
                        value={countryOfOrigin}
                        onChange={(e) => setCountryOfOrigin(e.target.value)}
                        disabled={saving}
                        className="w-28 px-2 py-1 border border-[#0071E3] rounded-lg focus:outline-hidden"
                      />
                    ) : (
                      displayText(item.countryOfOrigin)
                    )}
                  </td>
                  <td className="p-2.5 text-[#1D1D1F]">{displayText(item.status)}</td>
                  <td className="p-2.5 text-right font-mono">{item.quantity}</td>
                  <td className="p-2.5 text-right font-mono font-bold">
                    {displayCurrency(item.totalValue)}
                  </td>
                  {canEdit ? (
                    <td className="p-2.5 text-right whitespace-nowrap">
                      {isEditing ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void save(item)}
                            disabled={saving}
                            aria-label={`Save classification for line ${item.lineNumber}`}
                            className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            aria-label={`Cancel editing line ${item.lineNumber}`}
                            className="p-1.5 bg-[#F5F5F7] text-[#6E6E73] border border-[#E5E5EA] rounded-lg hover:bg-[#E5E5EA] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-[#0071E3] hover:underline cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Edit HTS &amp; origin
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <p className="text-sm text-[#6E6E73]">
          A saved classification is recorded as broker-confirmed and re-runs the dependent agents.
        </p>
      ) : null}
    </div>
  );
}
