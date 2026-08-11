"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Save, CheckCircle2, AlertCircle, Loader2, Globe, Shield } from "lucide-react";

interface TenantAdminFormProps {
  tenant: {
    id: string;
    name: string;
    slug: string;
    domain?: string | null;
    status: string;
    createdAt: string;
  };
  userRole: string;
}

export function TenantAdminForm({ tenant }: TenantAdminFormProps) {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [domain, setDomain] = useState(tenant.domain || "");
  const [status, setStatus] = useState(tenant.status);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, status }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Tenant profile updated successfully. Audit log created." });
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update tenant" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred while saving changes." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {message && (
        <div
          className={`p-4 rounded-xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-950/80 border-emerald-800 text-emerald-300"
              : "bg-red-950/80 border-red-800 text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Read-only Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Tenant ID
          </span>
          <p className="font-mono text-xs text-slate-300 select-all">{tenant.id}</p>
        </div>

        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Tenant Slug (URL Identity)
          </span>
          <p className="font-mono text-xs text-blue-400 select-all">{tenant.slug}</p>
        </div>
      </div>

      {/* Editable Fields */}
      <div className="space-y-4 glass-panel p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center space-x-2">
          <Building2 className="w-4 h-4 text-blue-400" />
          <span>Editable Tenant Attributes</span>
        </h3>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Company Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>Corporate Domain</span>
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span>Tenant Account Status</span>
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="ACTIVE">ACTIVE (Operational)</option>
            <option value="INACTIVE">INACTIVE (Maintenance)</option>
            <option value="SUSPENDED">SUSPENDED (Restricted Access)</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium rounded-xl text-sm shadow-lg shadow-blue-600/20 flex items-center space-x-2 transition-all disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>Save Tenant Changes</span>
        </button>
      </div>
    </form>
  );
}
