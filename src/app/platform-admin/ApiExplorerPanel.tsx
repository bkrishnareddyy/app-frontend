"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Search, Code2, Lock, Globe, PenLine, RefreshCw } from "lucide-react";
import type { ApiCatalogResponse, ApiCollection, RouteEntry } from "@/app/api/platform-admin/api-catalog/route";

// ── Method badge colours ──────────────────────────────────────────────────────
const METHOD_STYLES: Record<string, string> = {
  GET:     "bg-emerald-100 text-emerald-800 border-emerald-200",
  POST:    "bg-blue-100 text-blue-800 border-blue-200",
  PATCH:   "bg-amber-100 text-amber-800 border-amber-200",
  PUT:     "bg-purple-100 text-purple-800 border-purple-200",
  DELETE:  "bg-red-100 text-red-800 border-red-200",
  HEAD:    "bg-slate-100 text-slate-700 border-slate-200",
  OPTIONS: "bg-gray-100 text-gray-600 border-gray-200",
};

// ── Collection accent colours (left border + header) ─────────────────────────
const ACCENT: Record<string, string> = {
  amber:   "border-amber-400 bg-amber-50",
  blue:    "border-blue-400 bg-blue-50",
  cyan:    "border-cyan-400 bg-cyan-50",
  emerald: "border-emerald-400 bg-emerald-50",
  fuchsia: "border-fuchsia-400 bg-fuchsia-50",
  gray:    "border-gray-300 bg-gray-50",
  green:   "border-green-400 bg-green-50",
  indigo:  "border-indigo-400 bg-indigo-50",
  lime:    "border-lime-400 bg-lime-50",
  neutral: "border-neutral-300 bg-neutral-50",
  orange:  "border-orange-400 bg-orange-50",
  pink:    "border-pink-400 bg-pink-50",
  purple:  "border-purple-400 bg-purple-50",
  red:     "border-red-400 bg-red-50",
  rose:    "border-rose-400 bg-rose-50",
  sky:     "border-sky-400 bg-sky-50",
  slate:   "border-slate-400 bg-slate-50",
  stone:   "border-stone-400 bg-stone-50",
  teal:    "border-teal-400 bg-teal-50",
  violet:  "border-violet-400 bg-violet-50",
  yellow:  "border-yellow-400 bg-yellow-50",
  zinc:    "border-zinc-400 bg-zinc-50",
};

// ── Method badge ─────────────────────────────────────────────────────────────
function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold font-mono border rounded leading-none tracking-wide ${METHOD_STYLES[method] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
    >
      {method}
    </span>
  );
}

// ── Single route row (collapsible) ───────────────────────────────────────────
function RouteRow({ route }: { route: RouteEntry }) {
  const [open, setOpen] = useState(false);

  // Highlight path params like [id] in the route path
  const formattedPath = route.path.replace(/\[([^\]]+)\]/g, (_, p) => `{${p}}`);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted transition-colors group"
      >
        <span className="text-ink-muted group-hover:text-ink transition-colors">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>

        {/* Methods */}
        <span className="flex items-center gap-1 shrink-0">
          {route.methods.map((m) => <MethodBadge key={m} method={m} />)}
        </span>

        {/* Path */}
        <span className="font-mono text-xs text-ink flex-1 truncate">{formattedPath}</span>

        {/* Flags */}
        <span className="flex items-center gap-1.5 shrink-0">
          {route.isPublic && (
            <span title="Public — no auth required" className="flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
              <Globe className="w-3 h-3" />
              <span>public</span>
            </span>
          )}
          {route.requiresWrite && !route.isPublic && (
            <span title="Requires write access" className="flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              <PenLine className="w-3 h-3" />
              <span>write</span>
            </span>
          )}
          {route.permission && (
            <span title={`Required permission: ${route.permission}`} className="flex items-center gap-0.5 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 max-w-[160px] truncate">
              <Lock className="w-3 h-3 shrink-0" />
              <span className="truncate">{route.permission}</span>
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-8 py-3 bg-surface-muted border-t border-border space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Methods</span>
            {route.methods.map((m) => <MethodBadge key={m} method={m} />)}
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider shrink-0 mt-0.5">Path</span>
            <code className="text-xs font-mono text-ink bg-white border border-border rounded px-2 py-1 break-all">{formattedPath}</code>
          </div>
          {route.permission && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Permission</span>
              <code className="text-xs font-mono text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">{route.permission}</code>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            {route.isPublic && <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-emerald-600" /> No authentication required</span>}
            {route.requiresWrite && <span className="flex items-center gap-1"><PenLine className="w-3.5 h-3.5 text-amber-600" /> Requires write role (not read-only)</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collection card (collapsible) ────────────────────────────────────────────
function CollectionCard({ col, defaultOpen }: { col: ApiCollection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const accent = ACCENT[col.color] ?? ACCENT.gray;

  const methodCounts: Record<string, number> = {};
  for (const r of col.routes) {
    for (const m of r.methods) {
      methodCounts[m] = (methodCounts[m] ?? 0) + 1;
    }
  }

  return (
    <div className={`rounded-2xl border-l-4 border border-border bg-white overflow-hidden ${accent.split(" ")[0]}`}>
      <button
        onClick={() => setOpen((p) => !p)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/50 transition-colors ${open ? "border-b border-border" : ""}`}
      >
        <span className="text-ink-muted">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="font-bold text-sm text-ink flex-1">{col.name}</span>
        <span className="flex items-center gap-1.5">
          {Object.entries(methodCounts).map(([m, count]) => (
            <span key={m} className={`flex items-center gap-0.5 text-[10px] font-bold font-mono border rounded px-1.5 py-0.5 ${METHOD_STYLES[m] ?? ""}`}>
              <span>{m}</span>
              <span className="opacity-60">×{count}</span>
            </span>
          ))}
        </span>
        <span className="text-xs text-ink-muted tabular-nums shrink-0 ml-1">
          {col.routes.length} route{col.routes.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <div>
          {col.routes.map((r) => <RouteRow key={r.path} route={r} />)}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────
export function ApiExplorerPanel() {
  const [catalog, setCatalog] = useState<ApiCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<string | null>(null);

  const fetchCatalog = () => {
    setLoading(true);
    setError(null);
    fetch("/api/platform-admin/api-catalog")
      .then((r) => r.json())
      .then((data: ApiCatalogResponse) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  };

  useEffect(() => { fetchCatalog(); }, []);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.toLowerCase();

    return catalog.collections
      .map((col) => ({
        ...col,
        routes: col.routes.filter((r) => {
          const matchesSearch = !q || r.path.toLowerCase().includes(q) || col.name.toLowerCase().includes(q);
          const matchesMethod = !methodFilter || r.methods.includes(methodFilter);
          return matchesSearch && matchesMethod;
        }),
      }))
      .filter((col) => col.routes.length > 0);
  }, [catalog, search, methodFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-muted text-sm gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Scanning API routes…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="apple-card rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
        Failed to load API catalog: {error}
      </div>
    );
  }

  if (!catalog) return null;

  const totalEndpoints = filtered.reduce((sum, c) => sum + c.routes.reduce((s, r) => s + r.methods.length, 0), 0);

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">API Explorer</h2>
              <p className="text-xs text-ink-muted">
                {catalog.totalRoutes} route files · {catalog.totalEndpoints} endpoints across {catalog.collections.length} collections
              </p>
            </div>
          </div>

          <button
            onClick={fetchCatalog}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink px-3 py-1.5 rounded-full border border-border hover:bg-surface-muted transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Summary chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(["GET", "POST", "PATCH", "DELETE", "PUT"] as const).map((m) => {
            const count = catalog.collections
              .flatMap((c) => c.routes)
              .reduce((s, r) => s + (r.methods.includes(m) ? 1 : 0), 0);
            if (count === 0) return null;
            return (
              <button
                key={m}
                onClick={() => setMethodFilter(methodFilter === m ? null : m)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                  methodFilter === m
                    ? METHOD_STYLES[m] + " ring-2 ring-offset-1 ring-current"
                    : METHOD_STYLES[m] + " opacity-70 hover:opacity-100"
                }`}
              >
                <span>{m}</span>
                <span className="font-mono opacity-60">{count}</span>
              </button>
            );
          })}
          {methodFilter && (
            <button
              onClick={() => setMethodFilter(null)}
              className="px-3 py-1 rounded-full text-xs text-ink-muted border border-border hover:bg-surface-muted transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search routes or collections…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-full border border-border bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 text-ink placeholder:text-ink-muted"
          />
        </div>
        <span className="text-xs text-ink-muted shrink-0 tabular-nums">
          {filtered.reduce((s, c) => s + c.routes.length, 0)} routes · {totalEndpoints} endpoints shown
        </span>
      </div>

      {/* Collections */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-ink-muted text-sm">
            No routes match your search.
          </div>
        ) : (
          filtered.map((col) => (
            <CollectionCard
              key={col.tag}
              col={col}
              defaultOpen={search.length > 0 || methodFilter !== null}
            />
          ))
        )}
      </div>

      {catalog.generatedAt && (
        <p className="text-xs text-ink-muted text-center">
          Scanned at {new Date(catalog.generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
