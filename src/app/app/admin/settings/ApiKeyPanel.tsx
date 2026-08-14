"use client";

import { useState } from "react";
import { Key, Plus, Trash2, Copy, Check, Clock } from "lucide-react";

export interface ApiKeyItem {
  id: string;
  label: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface ApiKeyPanelProps {
  initialKeys: ApiKeyItem[];
}

export function ApiKeyPanel({ initialKeys }: ApiKeyPanelProps) {
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys);
  const [isCreating, setIsCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string>("*");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const scopeArray = scopes.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/admin/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), scopes: scopeArray }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create API key");

      setNewRawKey(data.rawKey);
      setKeys((prev) => [data.apiKey, ...prev]);
      setLabel("");
      setIsCreating(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating API key");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeKey(id: string) {
    if (!confirm("Are you sure you want to revoke this API key? Applications using it will lose access immediately.")) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/settings/api-keys/${id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to revoke API key");
      }

      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: "REVOKED", revokedAt: new Date().toISOString() } : k))
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
            <Key className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">API Keys</h2>
            <p className="text-xs text-slate-500">Manage machine-to-machine access tokens for webhooks and ingestion APIs</p>
          </div>
        </div>
        <button
          onClick={() => {
            setIsCreating(!isCreating);
            setNewRawKey(null);
          }}
          className="px-3.5 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Generate API Key</span>
        </button>
      </div>

      {newRawKey && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
            <span>API Key Created Successfully</span>
            <span className="text-[10px] font-normal text-emerald-700">Save this key now; it will not be displayed again.</span>
          </div>
          <div className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-emerald-300 font-mono text-xs text-emerald-950">
            <span className="flex-1 break-all">{newRawKey}</span>
            <button
              onClick={() => copyToClipboard(newRawKey)}
              className="p-1.5 hover:bg-emerald-50 rounded-md text-emerald-700 shrink-0 cursor-pointer"
              title="Copy Key"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleCreateKey} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">New API Key</h3>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Label</label>
              <input
                type="text"
                placeholder="e.g. ERP Integration Service"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-brand bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Scopes (comma separated)</label>
              <input
                type="text"
                placeholder="* (Full access) or filings.submit, products.read"
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-brand bg-white"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              {loading ? "Creating..." : "Create Key"}
            </button>
          </div>
        </form>
      )}

      <div className="divide-y divide-slate-100">
        {keys.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No API keys found. Generate a key to integrate with automated ingestion services.
          </div>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="py-3.5 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">{k.label}</span>
                  <span className="font-mono text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                    {k.keyPrefix}...
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      k.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {k.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span>Scopes: <code className="text-slate-700">{k.scopes.join(", ")}</code></span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    Last used: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                  </span>
                  <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              {k.status === "ACTIVE" && (
                <button
                  onClick={() => handleRevokeKey(k.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                  title="Revoke Key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Outbound Webhook Signing Secret */}
      <WebhookSecretSection />
    </div>
  );
}

function WebhookSecretSection() {
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/settings/webhooks", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setWebhookSecret(data.secret || data.signingSecret || JSON.stringify(data));
      } else {
        alert(data.error?.message || "Failed to generate webhook secret");
      }
    } catch (err) {
      console.error("Error generating webhook secret", err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Outbound Webhook Security</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Generate an HMAC signing secret to verify signature headers on outbound webhook events.
          </p>
        </div>
        <button
          type="button"
          disabled={generating}
          onClick={handleGenerate}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Key className="w-3.5 h-3.5" />
          <span>{generating ? "Generating..." : "Generate Webhook Secret"}</span>
        </button>
      </div>
      {webhookSecret && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
          <p className="text-[11px] font-bold text-amber-900">New Webhook Signing Secret (Copy now — shown once):</p>
          <code className="block font-mono text-xs text-amber-950 select-all break-all">{webhookSecret}</code>
        </div>
      )}
    </div>
  );
}
