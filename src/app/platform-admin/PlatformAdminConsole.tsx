"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, cn } from "@/lib/utils";
import { Building2, UserPlus, Shield, CheckCircle2, AlertCircle, Search, Globe2, Rocket, Bot, Code2, Clock, Database, Gavel } from "lucide-react";
import { HtsAdminPanel, HtsAdminData } from "./HtsAdminPanel";
import { DeploymentsPanel } from "./DeploymentsPanel";
import { AgentsAnalyticsPanel } from "./AgentsAnalyticsPanel";
import { ApiExplorerPanel } from "./ApiExplorerPanel";
import { CronPanel } from "./CronPanel";
import { DataAdminPanel } from "./DataAdminPanel";
import { RateReviewPanel } from "./RateReviewPanel";
import { Button } from "@/components/ui/Button";
import { Input, Label, FormField } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import type { AiUsageAnalytics } from "@/lib/ai/aiUsageAnalytics";
import type { DocumentProcessingAnalytics } from "@/lib/documents/documentProcessingAnalytics";

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
  htsAdmin: HtsAdminData;
  aiUsage: AiUsageAnalytics;
  documentProcessing: DocumentProcessingAnalytics;
}

export function PlatformAdminConsole({ accounts, htsAdmin, aiUsage, documentProcessing }: PlatformAdminConsoleProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    "accounts" | "hts" | "deployments" | "agents" | "api" | "cron" | "data" | "rate-review"
  >("accounts");
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const handleDeactivateAccount = async (accountId: string, accountName: string) => {
    if (!confirm(`Are you sure you want to deactivate account "${accountName}" (${accountId})?`)) {
      return;
    }
    setDeactivatingId(accountId);
    try {
      const res = await fetch(`/api/platform-admin/accounts/${accountId}/deactivate`, {
        method: "POST",
      });
      if (res.ok) {
        setMessage({ type: "success", text: `Account "${accountName}" has been deactivated.` });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: data.error || "Failed to deactivate account" });
      }
    } catch (err) {
      console.error("Error deactivating account", err);
    } finally {
      setDeactivatingId(null);
    }
  };

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

      {/* Tab Switcher */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => setActiveTab("accounts")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "accounts" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Accounts</span>
        </button>
        <button
          onClick={() => setActiveTab("data")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "data" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Data</span>
        </button>
        <button
          onClick={() => setActiveTab("rate-review")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "rate-review" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Gavel className="w-3.5 h-3.5" />
          <span>Rate Review</span>
        </button>
        <button
          onClick={() => setActiveTab("hts")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "hts" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Globe2 className="w-3.5 h-3.5" />
          <span>HS / HTS Master Data</span>
        </button>
        <button
          onClick={() => setActiveTab("deployments")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "deployments" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>Deployments</span>
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "agents" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Agents</span>
        </button>
        <button
          onClick={() => setActiveTab("api")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "api" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>API</span>
        </button>
        <button
          onClick={() => setActiveTab("cron")}
          className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === "cron" ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:text-ink"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Cron</span>
        </button>
      </div>

      {activeTab === "data" && <DataAdminPanel />}

      {activeTab === "rate-review" && <RateReviewPanel />}

      {activeTab === "hts" && <HtsAdminPanel data={htsAdmin} />}

      {activeTab === "deployments" && <DeploymentsPanel />}

      {activeTab === "agents" && <AgentsAnalyticsPanel data={aiUsage} documentProcessing={documentProcessing} />}

      {activeTab === "api" && <ApiExplorerPanel />}

      {activeTab === "cron" && <CronPanel />}

      {activeTab === "accounts" && (
        <>
      {/* Provision Enterprise Account Section */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <h2 className="text-lg font-bold text-ink mb-1 flex items-center space-x-2">
          <Building2 className="w-5 h-5 text-amber-600" />
          <span>Provision Enterprise Customer Account</span>
        </h2>
        <p className="text-xs text-ink-muted mb-6">
          Controlled administrative creation of customer company environments and Tenant Owner invitations.
        </p>

        <form onSubmit={handleCreateEnterpriseAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField>
            <Label className="font-bold uppercase tracking-wider">Company Name</Label>
            <Input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Imports Corp"
              required
              className="px-4 text-sm transition-colors focus:ring-0"
            />
          </FormField>

          <FormField>
            <Label className="font-bold uppercase tracking-wider">Tenant Owner Email</Label>
            <Input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@acme.com"
              required
              className="px-4 text-sm transition-colors focus:ring-0"
            />
          </FormField>

          <div className="flex items-end">
            <Button
              type="submit"
              disabled={loading}
              loading={loading}
              className="w-full bg-amber-600 hover:bg-amber-700 shadow-md shadow-amber-600/20 rounded-full text-sm"
            >
              {!loading && <UserPlus className="w-4 h-4" />}
              <span>Create Enterprise Account</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Platform Accounts List */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
              <Shield className="w-5 h-5 text-amber-600" />
              <span>All Platform Accounts</span>
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Total {accounts.length} accounts provisioned across system.
            </p>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-3" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="pl-9 pr-4 py-2 rounded-full w-64 focus:ring-0"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-surface-muted border-b border-border text-xs uppercase font-bold text-ink-muted">
              <tr>
                <th className="px-6 py-4">Account Name & ID</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Members</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAccounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-ink">{acc.name}</div>
                    <div className="text-xs font-mono text-ink-muted">{acc.id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      className={cn(
                        "font-mono normal-case text-sm",
                        acc.type === "ENTERPRISE"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-purple-50 text-purple-700 border-purple-200"
                      )}
                    >
                      {acc.type}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      variant={acc.status === "INACTIVE" || acc.status === "DEACTIVATED" ? "danger" : "success"}
                      className="font-medium normal-case text-xs"
                    >
                      {acc.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-ink">
                    {acc.memberCount} Members
                  </td>
                  <td className="px-6 py-4 text-xs text-ink-muted">
                    {formatDate(acc.createdAt)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {acc.status !== "INACTIVE" && acc.status !== "DEACTIVATED" && (
                      <button
                        type="button"
                        disabled={deactivatingId === acc.id}
                        onClick={() => handleDeactivateAccount(acc.id, acc.name)}
                        className="px-2.5 py-1 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {deactivatingId === acc.id ? "Deactivating..." : "Deactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
