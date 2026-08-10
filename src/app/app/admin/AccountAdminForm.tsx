"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Save, CheckCircle2, AlertCircle, Loader2, Shield, Globe, Languages } from "lucide-react";
import { COUNTRIES, useLanguage, Locale } from "@/lib/i18n/LanguageContext";

interface AccountAdminFormProps {
  account: {
    id: string;
    name: string;
    type: string;
    status: string;
    createdAt: string;
  };
  userRole: string;
  /** Called after a successful save, in addition to router.refresh(), so embedders that don't rely on the route's server data (e.g. a modal fetching client-side) can refresh their own copy. */
  onSaved?: () => void;
}

export function AccountAdminForm({ account, userRole, onSaved }: AccountAdminFormProps) {
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [status, setStatus] = useState(account.status);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { country, setCountryByCode, locale, setLocale } = useLanguage();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Account profile and country preferences saved. Audit log created." });
        router.refresh();
        onSaved?.();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update account" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      {/* Read-only Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-white border border-[#E5E5EA] rounded-2xl shadow-xs">
          <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider block mb-1">
            Account ID
          </span>
          <p className="font-mono text-xs text-[#1D1D1F] select-all">{account.id}</p>
        </div>

        <div className="p-4 bg-white border border-[#E5E5EA] rounded-2xl shadow-xs">
          <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider block mb-1">
            Account Type
          </span>
          <span className="inline-block text-xs font-bold font-mono px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0071E3] uppercase border border-blue-100">
            {account.type}
          </span>
        </div>
      </div>

      {/* Country & Language Localization Preference (New Profile Section) */}
      <div className="space-y-4 apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-2 flex items-center space-x-2">
          <Globe className="w-4 h-4 text-[#0071E3]" />
          <span>Country & Language Localization</span>
        </h3>
        <p className="text-xs text-[#86868B] mb-4">
          Select your primary operating country. Qubere automatically adapts interface localization, language defaults, and regional customs regulations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1.5">Operating Country & Region</label>
            <select
              value={country.code}
              onChange={(e) => setCountryByCode(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} — {c.languageName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1.5 flex items-center space-x-1.5">
              <Languages className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Interface Language</span>
            </label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
            >
              <option value="en">🇺🇸 English (United States)</option>
              <option value="es">🇲🇽 / 🇪🇸 Español (Spanish)</option>
            </select>
          </div>
        </div>

        <div className="p-3.5 bg-blue-50/60 rounded-2xl border border-blue-100 flex items-center space-x-3 text-xs text-[#0071E3]">
          <span className="text-xl">{country.flag}</span>
          <div>
            <p className="font-extrabold text-[#1D1D1F]">
              Active Region: {country.name} ({country.languageName})
            </p>
            <p className="text-[11px] text-[#86868B] mt-0.5">
              Customs & Tariff Authority: <strong className="text-[#0071E3]">{country.regionalTariffAuthority}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Editable Fields */}
      <div className="space-y-4 apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-4 flex items-center space-x-2">
          <Building2 className="w-4 h-4 text-[#0071E3]" />
          <span>Account Attributes</span>
        </h3>

        <div>
          <label className="block text-xs font-bold text-[#1D1D1F] mb-1.5">Account / Workspace Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#1D1D1F] mb-1.5 flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-[#86868B]" />
            <span>Account Operational Status</span>
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-sm focus:outline-none focus:border-[#0071E3] transition-colors"
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
          className="px-6 py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full text-sm shadow-md shadow-[#0071E3]/20 flex items-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save Profile Preferences</span>
        </button>
      </div>
    </form>
  );
}
