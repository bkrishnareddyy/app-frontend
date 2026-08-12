"use client";

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

/** Products have no bulk review-transition endpoint, so this stays export-only. */
export function ProductsBulkBar({ products }: { products: readonly ProductExportRow[] }) {
  const selected = useSelectedIds();
  const clear = useClearSelection();
  const count = selected.size;

  if (count === 0) return null;

  const chosen = products.filter((product) => selected.has(product.id));

  return (
    <div className="fixed inset-x-0 bottom-6 flex justify-center px-4 z-20">
      <div className="flex items-center gap-4 rounded-2xl bg-ink text-white shadow-lg px-5 py-3">
        <span className="text-sm font-semibold">
          {count} {count === 1 ? "product" : "products"} selected
        </span>
        <button
          type="button"
          onClick={() => downloadCsv(`products-export-${chosen.length}.csv`, HEADERS, chosen.map(toRow))}
          className="h-9 px-4 rounded-xl bg-white text-ink text-sm font-semibold"
        >
          Export CSV
        </button>
        <button type="button" onClick={clear} className="text-sm font-semibold text-white/70 hover:text-white">
          Clear
        </button>
      </div>
    </div>
  );
}
