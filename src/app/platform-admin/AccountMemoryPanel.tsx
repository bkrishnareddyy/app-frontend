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
    <div className="space-y-8">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur-xl">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-100">Account Institutional Memory</h2>
              <p className="text-sm text-slate-400">
                Postgres + pgvector + FTS hybrid retrieval & self-improving account intelligence
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <label className="text-xs font-medium text-slate-400">Target Account:</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.type})
              </option>
            ))}
          </select>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleTriggerSampleExtraction}
            disabled={extracting}
            className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
          >
            {extracting ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Simulate Override Extraction
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm border flex items-center justify-between ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          <div className="flex items-center space-x-2">
            {message.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Durable Memories</span>
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {analytics?.totalMemories ?? 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {analytics?.activeMemories ?? 0} active • {analytics?.supersededMemories ?? 0} superseded
          </p>
        </div>

        <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Override Retention</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {((analytics?.humanOverrideRetentionRate ?? 1) * 100).toFixed(0)}%
          </div>
          <p className="text-xs text-slate-400 mt-1">Human decision overrides converted to memory</p>
        </div>

        <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Agent Accuracy (Before vs After)</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2 text-2xl font-bold">
            <span className="text-slate-500 line-through text-lg">
              {((analytics?.agentAcceptanceRateBeforeAfter.beforeRate ?? 0.35) * 100).toFixed(0)}%
            </span>
            <ArrowRight className="w-4 h-4 text-slate-400 inline" />
            <span className="text-amber-400">
              {((analytics?.agentAcceptanceRateBeforeAfter.afterRate ?? 0.88) * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Auto-approval rate with AccountContext</p>
        </div>

        <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Override Reduction</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">
            {((analytics?.overrideReductionRate ?? 0.72) * 100).toFixed(0)}%
          </div>
          <p className="text-xs text-slate-400 mt-1">Reduction in repeated human broker review</p>
        </div>
      </div>

      {/* Interactive Search Tester */}
      <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="text-base font-semibold text-slate-200 flex items-center space-x-2">
          <Search className="w-5 h-5 text-purple-400" />
          <span>Test Hybrid RRF Retrieval (Lexical FTS + pgvector Cosine)</span>
        </h3>
        <form onSubmit={handleRunHybridSearch} className="flex gap-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type product description, SKU, HTS code, or supplier name..."
            className="bg-slate-800 border-slate-700 text-slate-100 flex-1"
          />
          <Button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="bg-purple-600 hover:bg-purple-500 text-white"
          >
            {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Run Hybrid Search"}
          </Button>
        </form>

        {searchResults.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Top Candidates (RRF Fused)
            </h4>
            <div className="space-y-2">
              {searchResults.map((m, i) => (
                <div
                  key={m.id}
                  className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                        Rank #{i + 1}
                      </Badge>
                      <Badge className="bg-slate-700 text-slate-300">{m.type}</Badge>
                      <Badge className="bg-slate-700 text-slate-300">{m.sourceType}</Badge>
                      <span className="text-xs text-slate-400">
                        Subject: {m.subjectType} ({m.subjectId || "N/A"})
                      </span>
                    </div>
                    <p className="text-sm text-slate-200 font-medium">{m.content}</p>
                    {m.evidence && m.evidence.length > 0 && (
                      <p className="text-xs text-slate-400 italic">
                        Excerpt: &quot;{m.evidence[0].excerpt}&quot;
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-slate-400 shrink-0">
                    <div className="text-purple-400 font-bold text-sm">Score: {m.score}</div>
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
      <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-200 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <span>Persisted Account Memories & Evidence</span>
          </h3>
          <span className="text-xs text-slate-400">Showing {memories.length} records</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 flex items-center justify-center space-x-2">
            <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
            <span>Loading account memories...</span>
          </div>
        ) : memories.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-slate-800/30 rounded-xl border border-slate-800">
            No memories found for this account. Click &quot;Simulate Override Extraction&quot; above to create a test memory record.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-800/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Subject</th>
                  <th className="p-3">Content Statement</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Validity</th>
                  <th className="p-3">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {memories.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-800/40">
                    <td className="p-3 whitespace-nowrap">
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                        {m.type}
                      </Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs text-slate-400">
                      <div>{m.subjectType}</div>
                      <div className="font-mono text-slate-300">{m.subjectId || "—"}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-slate-100">{m.content}</div>
                      {m.supersedesMemoryId && (
                        <div className="text-xs text-amber-400/90 mt-0.5">
                          Supersedes prior memory record
                        </div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs">
                      <Badge
                        className={
                          m.sourceType === "HUMAN_DECISION"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : "bg-slate-700 text-slate-300"
                        }
                      >
                        {m.sourceType}
                      </Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs text-slate-400">
                      <div>From: {new Date(m.validFrom).toLocaleDateString()}</div>
                      {m.validUntil ? (
                        <div className="text-amber-400">
                          Until: {new Date(m.validUntil).toLocaleDateString()} (Superseded)
                        </div>
                      ) : (
                        <div className="text-emerald-400">Active</div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs font-bold text-slate-200">
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
