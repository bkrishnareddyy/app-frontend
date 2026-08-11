"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Save, CheckCircle2, AlertCircle, Loader2, Shield, Globe, Languages } from "lucide-react";
import { COUNTRIES, useLanguage, Locale } from "@/lib/i18n/LanguageContext";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

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

      {/* Account Identity Card */}
      <div className="p-4 bg-white border border-border rounded-2xl shadow-xs flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-ink uppercase tracking-wider">Account ID</span>
            <Badge variant="warning" className="shrink-0 font-semibold">Enterprise</Badge>
          </div>
          <p className="font-mono text-xs text-ink select-all">{account.id}</p>
        </div>
        <Badge variant="info" className="font-mono normal-case shrink-0">{account.type}</Badge>
      </div>

      {/* Country & Language Localization Preference (New Profile Section) */}
      <div className="space-y-4 apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-2 flex items-center space-x-2">
          <Globe className="w-4 h-4 text-brand" />
          <span>Country & Language Localization</span>
        </h3>
        <p className="text-xs text-ink-muted mb-4">
          Select your primary operating country. Qubere automatically adapts interface localization, language defaults, and regional customs regulations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1.5">Operating Country & Region</Label>
            <Select
              value={country.code}
              onChange={(e) => setCountryByCode(e.target.value)}
              className="text-sm"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} — {c.languageName}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label className="block mb-1.5 flex items-center space-x-1.5">
              <Languages className="w-3.5 h-3.5 text-brand" />
              <span>Interface Language</span>
            </Label>
            <Select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="text-sm"
            >
              <option value="en">🇺🇸 English (United States)</option>
              <option value="es">🇲🇽 / 🇪🇸 Español (Spanish)</option>
            </Select>
          </div>
        </div>

        <div className="p-3.5 bg-blue-50/60 rounded-2xl border border-blue-100 flex items-center space-x-3 text-xs text-brand">
          <span className="text-xl">{country.flag}</span>
          <div>
            <p className="font-extrabold text-ink">
              Active Region: {country.name} ({country.languageName})
            </p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Customs & Tariff Authority: <strong className="text-brand">{country.regionalTariffAuthority}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Editable Fields */}
      <div className="space-y-4 apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-4 flex items-center space-x-2">
          <Building2 className="w-4 h-4 text-brand" />
          <span>Account Attributes</span>
        </h3>

        <div>
          <Label className="block mb-1.5">Account Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="text-sm"
          />
        </div>

        <div>
          <Label className="block mb-1.5 flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-ink-muted" />
            <span>Account Operational Status</span>
          </Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm">
            <option value="ACTIVE">ACTIVE (Operational)</option>
            <option value="INACTIVE">INACTIVE (Maintenance)</option>
            <option value="SUSPENDED">SUSPENDED (Restricted Access)</option>
          </Select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading} size="lg" className="shadow-md shadow-brand/20">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save Profile Preferences</span>
        </Button>
      </div>
    </form>
  );
}
