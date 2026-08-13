"use client";

import { useState } from "react";
import { useClearSelection, useSelectedIds } from "@/components/table/BulkSelection";
import { downloadCsv } from "@/lib/csvExport";

export interface ProductExportRow {
  id: string;
  productName: string;
  internalSku: string | null;
  brand: string | null;
  reviewStatusLabel: string;
  statusLabel: string;
  updatedAt: string;
}

const HEADERS = ["Product", "SKU", "Brand", "Review", "Status", "Updated"];

function toRow(product: ProductExportRow): string[] {
  return [
    product.productName,
    product.internalSku ?? "",
    product.brand ?? "",
    product.reviewStatusLabel,
    product.statusLabel,
    product.updatedAt,
  ];
}

/** D-3: Bulk classification via POST /api/v1/batch/classification */
function useClassifySelected(productIds: string[]) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [result, setResult] = useState<{ queued: number; skipped: number; errors: number } | null>(null);

  const classify = async () => {
    setState("pending");
    try {
      const res = await fetch("/api/v1/batch/classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });
      if (!res.ok) throw new Error("Classification request failed");
      const data = await res.json();
      setResult({
        queued: data.queued?.length ?? 0,
        skipped: data.skipped?.length ?? 0,
        errors: data.errors?.length ?? 0,
      });
      setState("done");
    } catch {
      setState("error");
    }
  };

  return { state, result, classify };
}

export function ProductsBulkBar({ products }: { products: readonly ProductExportRow[] }) {
  const selected = useSelectedIds();
  const clear = useClearSelection();
  const count = selected.size;

  const chosen = products.filter((product) => selected.has(product.id));
  const selectedIds = [...selected];

  const { state: classifyState, result: classifyResult, classify } = useClassifySelected(selectedIds);

  if (count === 0) return null;

  const estimatedSeconds = Math.ceil(count * 2);
  const estimatedLabel =
    estimatedSeconds < 60 ? `~${estimatedSeconds}s` : `~${Math.ceil(estimatedSeconds / 60)}m`;

  return (
    <div className="fixed inset-x-0 bottom-6 flex justify-center px-4 z-20">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-ink text-white shadow-lg px-5 py-3">
        <span className="text-sm font-semibold">
          {count} {count === 1 ? "product" : "products"} selected
        </span>

        {classifyState === "done" && classifyResult ? (
          <span className="text-sm text-green-300">
            Queued {classifyResult.queued}, skipped {classifyResult.skipped}
            {classifyResult.errors > 0 ? `, ${classifyResult.errors} errors` : ""}
          </span>
        ) : (
          <button
            type="button"
            disabled={classifyState === "pending"}
            onClick={classify}
            className="h-9 px-4 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60"
            title={`Classify ${count} product${count !== 1 ? "s" : ""}. Estimated time: ${estimatedLabel}`}
          >
            {classifyState === "pending"
              ? "Queuing…"
              : `Classify selected (${estimatedLabel})`}
          </button>
        )}

        {classifyState === "error" && (
          <span className="text-sm text-red-300">Classification failed</span>
        )}

        <button
          type="button"
          onClick={() =>
            downloadCsv(`products-export-${chosen.length}.csv`, HEADERS, chosen.map(toRow))
          }
          className="h-9 px-4 rounded-xl bg-white text-ink text-sm font-semibold"
        >
          Export CSV
        </button>

        <button
          type="button"
          onClick={clear}
          className="text-sm font-semibold text-white/70 hover:text-white"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
