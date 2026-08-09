"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Building2, UserPlus, Shield, CheckCircle2, AlertCircle, Loader2, Search } from "lucide-react";

interface AccountItem {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
  memberCount: number;
}

interface PlatformAdminConsoleProps {
  accounts: AccountItem[];
}

export function PlatformAdminConsole({ accounts }: PlatformAdminConsoleProps) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleCreateEnterpriseAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/platform-admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, ownerEmail }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: `Enterprise Account "${companyName}" created! Invitation sent to ${ownerEmail}.`,
        });
        setCompanyName("");
        setOwnerEmail("");
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create Enterprise Account" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = accounts.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase()) ||
      a.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
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

      {/* Provision Enterprise Account Section */}
      <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-1 flex items-center space-x-2">
          <Building2 className="w-5 h-5 text-amber-600" />
          <span>Provision Enterprise Customer Account</span>
        </h2>
        <p className="text-xs text-[#86868B] mb-6">
          Controlled administrative creation of customer company environments and Tenant Owner invitations.
        </p>

        <form onSubmit={handleCreateEnterpriseAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] uppercase tracking-wider mb-1.5">
              Company Name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Imports Corp"
              required
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] uppercase tracking-wider mb-1.5">
              Tenant Owner Email
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@acme.com"
              required
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-full text-sm shadow-md shadow-amber-600/20 flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              <span>Create Enterprise Account</span>
            </button>
          </div>
        </form>
      </div>

      {/* Platform Accounts List */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
              <Shield className="w-5 h-5 text-amber-600" />
              <span>All Platform Accounts</span>
            </h2>
            <p className="text-xs text-[#86868B] mt-0.5">
              Total {accounts.length} accounts provisioned across system.
            </p>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="pl-9 pr-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-full text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] w-64"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-xs uppercase font-bold text-[#86868B]">
              <tr>
                <th className="px-6 py-4">Account Name & ID</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Members</th>
                <th className="px-6 py-4">Created Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {filteredAccounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-[#1D1D1F]">{acc.name}</div>
                    <div className="text-xs font-mono text-[#86868B]">{acc.id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold font-mono border ${
                        acc.type === "ENTERPRISE"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-purple-50 text-purple-700 border-purple-200"
                      }`}
                    >
                      {acc.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {acc.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-[#1D1D1F]">
                    {acc.memberCount} Members
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">
                    {formatDate(acc.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
