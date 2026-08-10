import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageCount, tableHref } from "@/modules/tables/tableQuery";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  params: URLSearchParams;
  basePath: string;
  /** Plural noun for the screen-reader summary, e.g. "shipments". */
  label: string;
}

/**
 * The range is computed from the real total, so a partial last page says how
 * many records it holds rather than repeating the page size.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  params,
  basePath,
  label,
}: TablePaginationProps) {
  const pages = pageCount(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const previousHref = tableHref(basePath, params, { page: page - 1 <= 1 ? null : page - 1 });
  const nextHref = tableHref(basePath, params, { page: page + 1 });

  const buttonClass =
    "inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const disabledClass =
    "inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-surface-muted text-xs font-semibold text-ink-muted cursor-not-allowed";

  return (
    <nav
      className="flex items-center justify-between gap-4 px-3 xl:px-4 py-3.5 border-t border-border"
      aria-label={`${label} pagination`}
    >
      <p className="text-xs text-[#6E6E73]">
        {total === 0 ? `No ${label}` : `${first}–${last} of ${total} ${label}`}
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-[#6E6E73]">
          Page {page} of {pages}
        </span>

        {page > 1 ? (
          <Link href={previousHref} rel="prev" className={buttonClass}>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Previous</span>
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Previous</span>
          </span>
        )}

        {page < pages ? (
          <Link href={nextHref} rel="next" className={buttonClass}>
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}
