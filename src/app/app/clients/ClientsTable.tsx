"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Contact2, UserPlus, Loader2, CheckCircle2, AlertCircle, Package } from "lucide-react";

interface ClientItem {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status: string;
  createdAt: string;
  shipmentCount: number;
}

interface ClientsTableProps {
  clients: ClientItem[];
}

export function ClientsTable({ clients }: ClientsTableProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactName, contactEmail, contactPhone }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Client "${name}" added.` });
        setName("");
        setContactName("");
        setContactEmail("");
        setContactPhone("");
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to add client" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Add Client Card */}
      <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-4 flex items-center space-x-2">
          <UserPlus className="w-4 h-4 text-[#0071E3]" />
          <span>Add Client</span>
        </h3>

        <form onSubmit={handleCreateClient} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Client Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Target Corporation"
              required
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Contact Name</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Optional"
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Contact Email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Optional"
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={createLoading}
              className="w-full py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md shadow-[#0071E3]/20 disabled:opacity-50"
            >
              {createLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" />
              )}
              <span>Add Client</span>
            </button>
          </div>
        </form>
      </div>

      {/* Clients Table */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA]">
          <h3 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <Contact2 className="w-5 h-5 text-[#0071E3]" />
            <span>Clients ({clients.length})</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-xs uppercase font-bold text-[#86868B]">
              <tr>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Shipments</th>
                <th className="px-6 py-4">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-[#86868B] text-sm">
                    No clients yet. Add your first client above.
                  </td>
                </tr>
              )}
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-[#1D1D1F]">{c.name}</td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">
                    {c.contactName || c.contactEmail || c.contactPhone ? (
                      <div className="space-y-0.5">
                        {c.contactName && <div>{c.contactName}</div>}
                        {c.contactEmail && <div className="font-mono">{c.contactEmail}</div>}
                        {c.contactPhone && <div className="font-mono">{c.contactPhone}</div>}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        c.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">
                    <div className="flex items-center space-x-1.5">
                      <Package className="w-3.5 h-3.5 text-[#0071E3]" />
                      <span>{c.shipmentCount}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
