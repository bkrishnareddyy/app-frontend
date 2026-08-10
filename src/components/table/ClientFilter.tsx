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
        className="px-3 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
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
