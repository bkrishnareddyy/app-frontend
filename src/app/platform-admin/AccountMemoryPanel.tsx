"use client";

import { useState, useEffect } from "react";
import {
  Brain,
  Search,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Layers,
  Zap,
  ArrowRight,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import type { AccountMemoryRecord, MemoryAnalyticsSummary, ScoredMemory } from "@/modules/memory/memory.types";

interface AccountItem {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface AccountMemoryPanelProps {
  accounts: AccountItem[];
}

export function AccountMemoryPanel({ accounts }: AccountMemoryPanelProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const [analytics, setAnalytics] = useState<MemoryAnalyticsSummary | null>(null);
  const [memories, setMemories] = useState<AccountMemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ScoredMemory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const fetchMemoryData = async (accId: string) => {
    if (!accId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/platform-admin/memory?accountId=${accId}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
        setAnalytics(data.analytics || null);
      }
    } catch (err) {
      console.error("Failed to load memory data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) {
      fetchMemoryData(selectedAccountId);
    }
  }, [selectedAccountId]);

  const handleRunHybridSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !selectedAccountId) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/platform-admin/memory?accountId=${selectedAccountId}&q=${encodeURIComponent(
          searchQuery
        )}&mode=search`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.searchResults || []);
      }
    } catch (err) {
      console.error("Search error", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleTriggerSampleExtraction = async () => {
    if (!selectedAccountId) return;
    setExtracting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/platform-admin/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract_sample",
          accountId: selectedAccountId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: `Extracted memory: "${data.memory?.content || "Sample memory created"}"`,
        });
        fetchMemoryData(selectedAccountId);
      } else {
        setMessage({ type: "error", text: data.error || "Extraction failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error triggering extraction" });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header Card */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-2xl bg-brand/10 text-brand">
            <Brain className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-ink tracking-tight">Account Institutional Memory</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Postgres + pgvector + FTS hybrid retrieval & account-scoped intelligence
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-surface-muted border border-border rounded-xl px-3 py-1.5">
            <Building2 className="w-4 h-4 text-ink-muted" />
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="bg-transparent text-ink text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.type})
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleTriggerSampleExtraction}
            disabled={extracting}
          >
            {extracting ? (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-brand" />
            )}
            Simulate Override Extraction
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold border flex items-center justify-between ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center space-x-2">
            {message.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-xs text-ink-muted hover:text-ink">
            Dismiss
          </button>
        </div>
      )}

      {/* Executive KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
            <span>Durable Memories</span>
            <Layers className="w-3.5 h-3.5 text-brand" />
          </div>
          <p className="text-2xl font-extrabold text-ink tabular-nums">
            {analytics?.totalMemories ?? 0}
          </p>
          <p className="text-[10px] text-ink-muted mt-1">
            {analytics?.activeMemories ?? 0} active • {analytics?.supersededMemories ?? 0} superseded
          </p>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
            <span>Override Retention</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-600 tabular-nums">
            {((analytics?.humanOverrideRetentionRate ?? 0) * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-ink-muted mt-1">Human overrides converted to durable facts</p>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
            <span>Agent Accuracy Impact</span>
            <Zap className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="flex items-baseline space-x-2 text-2xl font-extrabold tabular-nums">
            <span className="text-ink-muted line-through text-lg">
              {((analytics?.agentAcceptanceRateBeforeAfter.beforeRate ?? 0) * 100).toFixed(0)}%
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-ink-muted inline" />
            <span className="text-amber-600">
              {((analytics?.agentAcceptanceRateBeforeAfter.afterRate ?? 0) * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-[10px] text-ink-muted mt-1">Agent acceptance rate with AccountContext</p>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between text-ink-muted text-xs font-bold uppercase tracking-wider mb-2">
            <span>Override Reduction</span>
            <Clock className="w-3.5 h-3.5 text-brand" />
          </div>
          <p className="text-2xl font-extrabold text-brand tabular-nums">
            {((analytics?.overrideReductionRate ?? 0) * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-ink-muted mt-1">Reduction in repeated human broker review</p>
        </div>
      </div>

      {/* Interactive Hybrid RRF Search Tester */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-ink flex items-center space-x-2">
              <Search className="w-4 h-4 text-brand" />
              <span>Test Hybrid RRF Retrieval (Lexical FTS + pgvector Cosine)</span>
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Strictly scoped to account ID: <code className="font-mono text-ink font-bold">{selectedAccountId}</code>
            </p>
          </div>
        </div>

        <form onSubmit={handleRunHybridSearch} className="flex gap-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SKU, HTS code, supplier, or product description..."
            className="bg-surface-muted border-border text-ink flex-1 text-xs"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSearching || !searchQuery.trim()}
          >
            {isSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Run Hybrid Search"}
          </Button>
        </form>

        {searchResults.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
              Top Retrieved Candidates (RRF Fused)
            </h4>
            <div className="space-y-2">
              {searchResults.map((m, i) => (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl bg-surface-muted border border-border flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Badge variant="info">Rank #{i + 1}</Badge>
                      <Badge variant="neutral">{m.type}</Badge>
                      <Badge variant={m.sourceType === "HUMAN_DECISION" ? "success" : "neutral"}>
                        {m.sourceType}
                      </Badge>
                      <span className="text-[10px] text-ink-muted">
                        Subject: {m.subjectType} ({m.subjectId || "N/A"})
                      </span>
                    </div>
                    <p className="text-xs text-ink font-semibold">{m.content}</p>
                    {m.evidence && m.evidence.length > 0 && (
                      <p className="text-[11px] text-ink-muted italic">
                        Excerpt: &quot;{m.evidence[0].excerpt}&quot;
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-ink-muted shrink-0">
                    <div className="text-brand font-bold text-xs">Score: {m.score}</div>
                    <div>Lexical: {m.lexicalRank ? `#${m.lexicalRank}` : "N/A"}</div>
                    <div>Vector: {m.vectorRank ? `#${m.vectorRank}` : "N/A"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Account Memory Explorer Table */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-brand" />
            <h3 className="text-base font-bold text-ink">Persisted Account Memories</h3>
          </div>
          <Badge variant="neutral">
            {memories.length} records for {accounts.find((a) => a.id === selectedAccountId)?.name}
          </Badge>
        </div>

        {loading ? (
          <div className="p-8 text-center text-ink-muted flex items-center justify-center space-x-2 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-brand" />
            <span>Loading account memories...</span>
          </div>
        ) : memories.length === 0 ? (
          <div className="p-8 text-center text-ink-muted bg-surface-muted rounded-2xl border border-border text-xs">
            No memories found for this account. Click &quot;Simulate Override Extraction&quot; above to create a test memory record.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-ink">
              <thead className="text-[10px] font-bold uppercase tracking-wider bg-surface-muted text-ink-muted border-b border-border">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Subject</th>
                  <th className="p-3">Content Statement</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Validity</th>
                  <th className="p-3 text-right">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {memories.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="p-3 whitespace-nowrap">
                      <Badge variant="info">{m.type}</Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-ink-muted">
                      <div className="font-semibold text-ink">{m.subjectType}</div>
                      <div className="font-mono text-[11px] text-ink-muted">{m.subjectId || "—"}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-ink">{m.content}</div>
                      {m.supersedesMemoryId && (
                        <div className="text-[10px] text-amber-700 font-medium mt-0.5">
                          Supersedes prior memory record
                        </div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <Badge variant={m.sourceType === "HUMAN_DECISION" ? "success" : "neutral"}>
                        {m.sourceType}
                      </Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-ink-muted">
                      <div>From: {new Date(m.validFrom).toLocaleDateString()}</div>
                      {m.validUntil ? (
                        <div className="text-amber-700 font-medium">
                          Until: {new Date(m.validUntil).toLocaleDateString()} (Superseded)
                        </div>
                      ) : (
                        <div className="text-emerald-700 font-medium">Active</div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap text-right font-extrabold text-ink tabular-nums">
                      {(m.confidence * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
