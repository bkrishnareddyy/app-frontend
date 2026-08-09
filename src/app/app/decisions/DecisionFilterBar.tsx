"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import {
  AGE_BANDS,
  AGE_BAND_LABEL,
  CONFIDENCE_BANDS,
  CONFIDENCE_BAND_LABEL,
} from "@/modules/decisions/decisionQuery";
import { tableHref, resetPage } from "@/modules/tables/tableQuery";

interface DecisionQueryState {
  search: string | null;
  status: string | null;
  agentName: string | null;
  confidence: string | null;
  age: string | null;
  page: number;
  pageSize: number;
}

interface DecisionFilterBarProps {
  query: DecisionQueryState;
  total: number;
  shown: number;
  agentNames: string[];
  statuses: string[];
}

/**
 * Every control writes to the URL, so a filtered queue is shareable and the
 * server does the filtering. A count shown beside a filter has to be the count
 * that filter produces, which a browser-side filter over one page cannot be.
 */
export function DecisionFilterBar({
  query,
  total,
  shown,
  agentNames,
  statuses,
}: DecisionFilterBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const current = new URLSearchParams(params.toString());

  const href = (patch: Record<string, string | number | null>) =>
    tableHref(pathname, current, resetPage(patch));

  const chip = (active: boolean) =>
    `px-3 py-1 rounded-lg text-xs font-semibold transition-all border ${
      active
        ? "bg-[#0071E3] text-white border-[#0071E3]"
        : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:bg-[#F5F5F7]"
    }`;

  const select =
    "px-3 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] font-medium focus:outline-none focus:border-[#0071E3]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form method="GET" action={pathname} className="relative">
          {/* The other filters ride along so searching does not silently drop them. */}
          {(["status", "agent", "confidence", "age", "sort", "dir", "shipmentId"] as const).map((key) => {
            const value = current.get(key);
            return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
          })}
          <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-2.5" aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={query.search ?? ""}
            placeholder="Search agent, summary, HTS code, or shipment"
            aria-label="Search decisions"
            className="pl-9 pr-4 py-2 bg-white border border-[#E5E5EA] focus:border-[#0071E3] rounded-xl text-xs text-[#1D1D1F] w-80 transition-all outline-none font-medium"
          />
        </form>

        <label className="sr-only" htmlFor="decision-status">
          Filter by status
        </label>
        <select
          id="decision-status"
          className={select}
          defaultValue={query.status ?? ""}
          onChange={(e) => {
            router.push(href({ status: e.target.value || null }));
          }}
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="decision-agent">
          Filter by agent
        </label>
        <select
          id="decision-agent"
          className={select}
          defaultValue={query.agentName ?? ""}
          onChange={(e) => {
            router.push(href({ agent: e.target.value || null }));
          }}
        >
          <option value="">All agents</option>
          {agentNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <span className="text-xs text-[#86868B] font-medium ml-auto">
          {total === 0
            ? "No decisions"
            : `Showing ${shown} of ${total} matching decision${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#86868B] mr-1">Model confidence</span>
        {CONFIDENCE_BANDS.map((band) => (
          <Link
            key={band}
            href={href({ confidence: query.confidence === band ? null : band })}
            title={CONFIDENCE_BAND_LABEL[band]}
            aria-current={query.confidence === band ? "true" : undefined}
            className={chip(query.confidence === band)}
          >
            {band === "unscored" ? "Unscored" : band[0].toUpperCase() + band.slice(1)}
          </Link>
        ))}

        <span className="text-xs font-semibold text-[#86868B] mx-1 ml-4">Age</span>
        {AGE_BANDS.map((band) => (
          <Link
            key={band}
            href={href({ age: query.age === band ? null : band })}
            title={AGE_BAND_LABEL[band]}
            aria-current={query.age === band ? "true" : undefined}
            className={chip(query.age === band)}
          >
            {band === "today" ? "Last 24h" : band === "week" ? "Last 7 days" : "Over 7 days"}
          </Link>
        ))}

        {(query.search || query.status || query.agentName || query.confidence || query.age) && (
          <Link
            href={pathname}
            className="text-xs font-semibold text-[#0071E3] hover:underline ml-2"
          >
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}
