"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { TablePagination } from "@/components/table/TablePagination";

interface DecisionPaginationProps {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The queue is paged on the server, so the control has to carry the current
 * filter and sort parameters forward rather than resetting them.
 */
export function DecisionPagination({ page, pageSize, total }: DecisionPaginationProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <TablePagination
      page={page}
      pageSize={pageSize}
      total={total}
      params={new URLSearchParams(params.toString())}
      basePath={pathname}
      label="decisions"
    />
  );
}
