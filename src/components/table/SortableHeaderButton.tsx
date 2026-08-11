"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortDirection = "asc" | "desc";

interface SortableHeaderButtonProps<TColumn extends string> {
  column: TColumn;
  label: string;
  sort: TColumn;
  direction: SortDirection;
  onSort: (column: TColumn, direction: SortDirection) => void;
  className?: string;
}

const DIRECTION_LABEL: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

/** The button counterpart to SortableHeader, for tables whose state is not in the URL. */
export function SortableHeaderButton<TColumn extends string>({
  column,
  label,
  sort,
  direction,
  onSort,
  className = "",
}: SortableHeaderButtonProps<TColumn>) {
  const isActive = sort === column;
  const nextDirection: SortDirection = isActive && direction === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      className={`py-3 px-3 xl:px-4 ${className}`}
      aria-sort={isActive ? DIRECTION_LABEL[direction] : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column, nextDirection)}
        className={`inline-flex items-center gap-1.5 rounded-sm uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isActive ? "text-ink" : "hover:text-ink"
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">
          {isActive
            ? `sorted ${DIRECTION_LABEL[direction]}, activate to sort ${DIRECTION_LABEL[nextDirection]}`
            : `activate to sort ${DIRECTION_LABEL[nextDirection]}`}
        </span>
      </button>
    </th>
  );
}
