"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface CountdownChipProps {
  /** Human-readable deadline type label, e.g. "ISF" */
  label: string;
  dueAt: Date;
  estimated?: boolean;
  /** USD exposure, shown alongside the countdown */
  exposureUsd?: number | null;
  /**
   * Days out at which the chip turns amber ("high"). Defaults to 3 — right
   * for short-fuse deadlines like ISF. Entry Filing runs a 15-day statutory
   * window with liquidated-damages exposure (19 CFR 141.68(a)), so brokers
   * need to see it turn amber earlier to leave enough lead time to work the
   * file — pass a larger value (5) for that deadline type.
   */
  warnDays?: number;
  className?: string;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "BREACHED";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

type Band = "breached" | "critical" | "high" | "normal";

function band(ms: number, warnDays: number): Band {
  if (ms <= 0) return "breached";
  if (ms <= 24 * 3_600_000) return "critical";
  if (ms <= warnDays * 24 * 3_600_000) return "high";
  return "normal";
}

const BAND_STYLES: Record<Band, string> = {
  breached: "bg-red-100 text-red-700 border-red-200",
  critical: "bg-red-50 text-red-600 border-red-200",
  high:    "bg-amber-50 text-amber-700 border-amber-200",
  normal:  "bg-surface-muted text-ink-muted border-border",
};

export function CountdownChip({ label, dueAt, estimated = false, exposureUsd, warnDays = 3, className }: CountdownChipProps) {
  const [msRemaining, setMsRemaining] = useState(() => dueAt.getTime() - Date.now());

  useEffect(() => {
    // Tick every 30s — precise enough for broker workflows, cheap enough to always run.
    const id = setInterval(() => setMsRemaining(dueAt.getTime() - Date.now()), 30_000);
    return () => clearInterval(id);
  }, [dueAt]);

  const currentBand = band(msRemaining, warnDays);
  const text = formatMs(msRemaining);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border",
        BAND_STYLES[currentBand],
        estimated && "opacity-75",
        className
      )}
      title={estimated ? `${label} deadline (estimated — based on ETA, not confirmed date)` : `${label} deadline`}
    >
      {estimated && <span className="text-[10px] leading-none">~</span>}
      <span>{label}</span>
      <span>·</span>
      <span className="tabular-nums">{text}</span>
      {exposureUsd != null && exposureUsd > 0 && (
        <>
          <span>·</span>
          <span>${exposureUsd.toLocaleString()}</span>
        </>
      )}
    </span>
  );
}
