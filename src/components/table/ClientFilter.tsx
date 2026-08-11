"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resetPage, tableHref } from "@/modules/tables/tableQuery";

interface ClientFilterProps {
  clients: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * Client choice is pushed into the URL rather than kept in component state so
 * the server render, the deep link and the saved view all agree.
 */
export function ClientFilter({ clients }: ClientFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = searchParams.get("client") ?? "";

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="client-filter" className="sr-only">
        Filter by client
      </label>
      <select
        id="client-filter"
        value={selected}
        onChange={(event) =>
          router.push(
            tableHref(pathname, searchParams, resetPage({ client: event.target.value || null }))
          )
        }
        className="px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="">All Clients</option>
        <option value="UNASSIGNED">No Client</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </div>
  );
}
