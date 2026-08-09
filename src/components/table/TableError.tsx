"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

interface TableErrorProps {
  message: string;
  onRetry: () => void;
  /** What failed, e.g. "shipments". Used for the retry button's label. */
  label: string;
}

/**
 * A failed load is not an empty table. Saying "no records" when the query
 * never completed reports an answer the system does not have.
 */
export function TableError({ message, onRetry, label }: TableErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-5 py-12 text-center"
    >
      <AlertTriangle className="w-8 h-8 text-amber-600 stroke-1" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-[#1D1D1F]">Could not load {label}</p>
        <p className="mt-1 text-xs text-[#6E6E73]">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D1D1F] text-white text-xs font-semibold hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Retry loading {label}</span>
      </button>
    </div>
  );
}
