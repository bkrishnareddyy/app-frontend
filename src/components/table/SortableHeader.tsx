import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type SortDirection,
  type TableQuery,
  nextDirection,
  resetPage,
  tableHref,
} from "@/modules/tables/tableQuery";

interface SortableHeaderProps<TColumn extends string> {
  column: TColumn;
  label: string;
  query: TableQuery<TColumn>;
  params: URLSearchParams;
  basePath: string;
  align?: "left" | "right";
  className?: string;
}

const DIRECTION_LABEL: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

/**
 * Sorting is a link, not a click handler, so the order is in the URL and a
 * shared or bookmarked link reproduces the table exactly.
 */
export function SortableHeader<TColumn extends string>({
  column,
  label,
  query,
  params,
  basePath,
  align = "left",
  className = "",
}: SortableHeaderProps<TColumn>) {
  const isActive = query.sort === column;
  const direction = nextDirection(query, column);
  const href = tableHref(basePath, params, resetPage({ sort: column, dir: direction }));

  const Icon = !isActive ? ArrowUpDown : query.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      className={`px-3 xl:px-4 py-3.5 ${align === "right" ? "text-right" : ""} ${className}`}
      aria-sort={isActive ? DIRECTION_LABEL[query.direction] : "none"}
    >
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isActive ? "text-ink" : "hover:text-ink"
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">
          {isActive
            ? `sorted ${DIRECTION_LABEL[query.direction]}, activate to sort ${DIRECTION_LABEL[direction]}`
            : `activate to sort ${DIRECTION_LABEL[direction]}`}
        </span>
      </Link>
    </th>
  );
}
