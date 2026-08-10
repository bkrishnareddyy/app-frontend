"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3 } from "lucide-react";
import {
  type ColumnSpec,
  serializeColumns,
  tableHref,
  visibleColumns,
} from "@/modules/tables/tableQuery";

interface ColumnChooserProps<TId extends string> {
  columns: readonly ColumnSpec<TId>[];
  label: string;
}

/**
 * Column choice is pushed into the URL rather than kept in component state so
 * the server render, the deep link and the saved view all agree.
 */
export function ColumnChooser<TId extends string>({ columns, label }: ColumnChooserProps<TId>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = visibleColumns(searchParams.get("cols"), columns);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function toggle(id: TId) {
    const next = selected.includes(id)
      ? selected.filter((column) => column !== id)
      : columns.filter((column) => column.id === id || selected.includes(column.id)).map((c) => c.id);

    // Hiding the last column would render a table with no data at all.
    if (next.length === 0) return;

    router.push(tableHref(pathname, searchParams, { cols: serializeColumns(next, columns) }));
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Columns</span>
        <span className="sr-only">
          {selected.length} of {columns.length} {label} columns shown
        </span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-border bg-white p-2 shadow-lg">
          <fieldset>
            <legend className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Visible columns
            </legend>
            {columns.map((column) => {
              const checked = selected.includes(column.id);
              const isLast = checked && selected.length === 1;
              return (
                <label
                  key={column.id}
                  className={`flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-xs text-ink ${
                    isLast ? "opacity-60" : "hover:bg-surface-muted cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLast}
                    onChange={() => toggle(column.id)}
                    className="accent-brand"
                  />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
