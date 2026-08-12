"use client";

import { useState, type ReactNode } from "react";
import { Activity, FileText, Layers } from "lucide-react";

type ShipmentTab = "workspace" | "filing" | "audit";

interface ShipmentTabsPanelProps {
  initialTab: string;
  auditCount: number;
  workspaceContent: ReactNode;
  filingContent: ReactNode;
  auditContent: ReactNode;
}

function normalizeTab(tab: string): ShipmentTab {
  return tab === "filing" || tab === "audit" ? tab : "workspace";
}

/**
 * Switches between the shipment detail page's three tabs entirely
 * client-side.
 *
 * `view` used to be a server searchParam driving which tab the page's Server
 * Component rendered, so every tab click re-fetched and re-rendered the
 * entire page (readiness ribbon, exceptions, everything) just to swap which
 * pre-computed section was visible. All three tab bodies are cheap to build
 * server-side (same data already loaded for the page), so they're rendered
 * once and handed to this component as props; switching tabs here just
 * changes which already-rendered tree is mounted.
 */
export function ShipmentTabsPanel({
  initialTab,
  auditCount,
  workspaceContent,
  filingContent,
  auditContent,
}: ShipmentTabsPanelProps) {
  const [activeTab, setActiveTab] = useState<ShipmentTab>(() => normalizeTab(initialTab));

  const selectTab = (tab: ShipmentTab) => {
    setActiveTab(tab);
    // Keeps the URL shareable/deep-linkable without going through the
    // router -- a router navigation here is exactly the full-page
    // re-render this component exists to avoid.
    const url = new URL(window.location.href);
    url.searchParams.set("view", tab);
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <div className="flex items-center space-x-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => selectTab("workspace")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
            activeTab === "workspace" ? "bg-brand text-white" : "bg-slate-100 text-ink-muted hover:text-ink"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Operational Workspace</span>
        </button>
        <button
          type="button"
          onClick={() => selectTab("filing")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
            activeTab === "filing" ? "bg-brand text-white" : "bg-slate-100 text-ink-muted hover:text-ink"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Filing Data</span>
        </button>
        <button
          type="button"
          onClick={() => selectTab("audit")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
            activeTab === "audit" ? "bg-brand text-white" : "bg-slate-100 text-ink-muted hover:text-ink"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Agent Executions & Audit Log ({auditCount})</span>
        </button>
      </div>

      {activeTab === "filing" ? filingContent : activeTab === "workspace" ? workspaceContent : auditContent}
    </>
  );
}
