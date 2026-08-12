import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, Upload } from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { Badge } from "@/components/ui";
import { SortableHeader } from "@/components/table/SortableHeader";
import { TablePagination } from "@/components/table/TablePagination";
import { tableHref } from "@/modules/tables/tableQuery";
import { holdsPermission, partyActor } from "@/modules/party/partyActor";
import { listParties } from "@/modules/party/partyService";
import { PARTY_SORT_COLUMNS, parsePartyQuery } from "@/modules/party/partyQuery";
import { partyStatusPresentation, reviewStatusPresentation, roleTypeLabel } from "@/modules/party/partyDisplay";
import { displayDate, displayText } from "@/lib/honest";
import { RowCheckbox, SelectAllCheckbox, SelectionProvider } from "@/components/table/BulkSelection";
import { PartiesBulkBar, type PartyExportRow } from "./PartiesBulkActions";

export const dynamic = "force-dynamic";

const BASE_PATH = "/app/parties";

/** Chips and sort state ride along with a search, or searching silently clears them. */
const PRESERVED_ON_SEARCH = [
  "status",
  "reviewStatus",
  "roleType",
  "needsRevalidation",
  "sort",
  "dir",
  "pageSize",
] as const;

export default async function PartiesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }

  const query = parsePartyQuery(params);
  const { rows, total } = await listParties(partyActor(context, "page"), query);

  const writable = canWrite(context);
  const mayCreate = writable && holdsPermission(context, "parties.create");
  const mayImport = writable && holdsPermission(context, "parties.import");
  const mayEdit = writable && holdsPermission(context, "parties.edit");
  const mayApprove = writable && holdsPermission(context, "parties.review.approve");

  const chipHref = (patch: Record<string, string | number | null>) =>
    tableHref(BASE_PATH, params, { ...patch, page: null });

  const hasFilter = Boolean(query.search || query.status || query.reviewStatus || query.roleType || query.needsRevalidation);

  const exportRows: PartyExportRow[] = rows.map((row) => ({
    id: row.id,
    displayName: displayText(row.displayName, "Unnamed party"),
    internalPartyCode: row.internalPartyCode,
    roles: row.activeRoles.length === 0 ? "—" : row.activeRoles.map((role) => roleTypeLabel(role)).join(", "),
    reviewStatusLabel: reviewStatusPresentation(row.reviewStatus).label,
    statusLabel: partyStatusPresentation(row.status).label,
    updatedAt: displayDate(row.updatedAt),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Parties</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-3xl">
            The party master for {context.accountName}. A party holds identity only; each name,
            identifier, registration and address is its own fact with its own status and its own
            evidence, and none of it is a screening result.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mayImport && (
            <Link
              href="/app/parties/import"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Import
            </Link>
          )}
          {mayCreate && (
            <Link
              href="/app/parties/new"
              className="inline-flex items-center h-10 px-4 rounded-xl bg-brand text-white text-sm font-semibold"
            >
              Add party
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-border p-4 space-y-4">
        <form action={BASE_PATH} method="get" className="flex flex-wrap items-end gap-3">
          {PRESERVED_ON_SEARCH.map((key) => {
            const value = params.get(key);
            return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
          })}
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="party-search" className="block text-xs font-semibold text-ink-muted mb-1">
              Search name, internal code or identifier
            </label>
            <input
              id="party-search"
              name="q"
              type="search"
              defaultValue={query.search ?? ""}
              className="w-full h-10 px-3 rounded-xl border border-border text-sm"
            />
          </div>
          <div>
            <label htmlFor="party-role" className="block text-xs font-semibold text-ink-muted mb-1">
              Holds role
            </label>
            <input
              id="party-role"
              name="roleType"
              type="text"
              maxLength={32}
              placeholder="e.g. SUPPLIER"
              defaultValue={query.roleType ?? ""}
              className="w-40 h-10 px-3 rounded-xl border border-border text-sm uppercase"
            />
          </div>
          <button type="submit" className="h-10 px-4 rounded-xl bg-brand text-white text-sm font-semibold">
            Search
          </button>
          {hasFilter && (
            <Link href={BASE_PATH} className="h-10 px-3 flex items-center text-sm font-semibold text-brand">
              Clear
            </Link>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={chipHref({ needsRevalidation: query.needsRevalidation ? null : "true" })}
            className={`px-3 py-1.5 rounded-full border ${
              query.needsRevalidation ? "border-brand text-brand" : "border-border text-[#6E6E73]"
            }`}
          >
            Awaiting revalidation
          </Link>
          <Link
            href={chipHref({ reviewStatus: query.reviewStatus === "UNREVIEWED" ? null : "UNREVIEWED" })}
            className={`px-3 py-1.5 rounded-full border ${
              query.reviewStatus === "UNREVIEWED" ? "border-brand text-brand" : "border-border text-[#6E6E73]"
            }`}
          >
            Unreviewed
          </Link>
          <Link
            href={chipHref({ reviewStatus: query.reviewStatus === "NEEDS_REVIEW" ? null : "NEEDS_REVIEW" })}
            className={`px-3 py-1.5 rounded-full border ${
              query.reviewStatus === "NEEDS_REVIEW" ? "border-brand text-brand" : "border-border text-[#6E6E73]"
            }`}
          >
            Needs review
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white border border-border p-10 text-center">
          <Landmark className="w-8 h-8 mx-auto text-ink-muted" aria-hidden="true" />
          <p className="mt-3 text-sm text-[#6E6E73]">
            {hasFilter ? "No party matches these filters." : "No parties are recorded for this account yet."}
          </p>
        </div>
      ) : (
        <SelectionProvider>
        <div className="rounded-2xl bg-white border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wider text-ink-muted bg-surface-muted">
                <tr>
                  <th scope="col" className="px-3 xl:px-4 py-3.5 w-10">
                    <SelectAllCheckbox ids={rows.map((row) => row.id)} label="parties on this page" />
                  </th>
                  <th scope="col" className="px-3 xl:px-4 py-3.5">
                    Party
                  </th>
                  <SortableHeader
                    column="internalPartyCode"
                    label="Code"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <th scope="col" className="px-3 xl:px-4 py-3.5">
                    Roles
                  </th>
                  <SortableHeader
                    column="reviewStatus"
                    label="Review"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <SortableHeader
                    column="status"
                    label="Status"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <SortableHeader
                    column="updatedAt"
                    label="Updated"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const status = partyStatusPresentation(row.status);
                  const review = reviewStatusPresentation(row.reviewStatus);
                  return (
                    <tr key={row.id} className="hover:bg-surface-muted/50">
                      <td className="px-3 xl:px-4 py-3">
                        <RowCheckbox id={row.id} label={displayText(row.displayName, "Unnamed party")} />
                      </td>
                      <td className="px-3 xl:px-4 py-3">
                        <Link href={`/app/parties/${row.id}`} className="font-semibold text-brand hover:underline">
                          {displayText(row.displayName, "Unnamed party")}
                        </Link>
                        {row.openRevalidationCount > 0 && (
                          <span className="block mt-1">
                            <Badge variant="warning">{row.openRevalidationCount} to re-check</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73]">
                        {displayText(row.internalPartyCode)}
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73]">
                        {row.activeRoles.length === 0
                          ? "—"
                          : row.activeRoles.map((role) => roleTypeLabel(role)).join(", ")}
                      </td>
                      <td className="px-3 xl:px-4 py-3">
                        <Badge variant={review.tone}>{review.label}</Badge>
                      </td>
                      <td className="px-3 xl:px-4 py-3">
                        <Badge variant={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73] whitespace-nowrap">
                        {displayDate(row.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={query.page}
            pageSize={query.pageSize}
            total={total}
            params={params}
            basePath={BASE_PATH}
            label="parties"
          />
        </div>
        <PartiesBulkBar parties={exportRows} canReview={mayEdit} canApprove={mayApprove} />
        </SelectionProvider>
      )}

      <p className="text-xs text-[#6E6E73]">
        Sorting is available on {PARTY_SORT_COLUMNS.length} columns and lives in the URL, so a link
        reproduces the table exactly.
      </p>
    </div>
  );
}
