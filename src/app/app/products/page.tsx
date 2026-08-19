import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, Upload } from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { getClientsData } from "@/lib/clients/clientsData";
import { Badge } from "@/components/ui";
import { SortableHeader } from "@/components/table/SortableHeader";
import { TablePagination } from "@/components/table/TablePagination";
import { tableHref } from "@/modules/tables/tableQuery";
import { holdsPermission, productActor } from "@/modules/product/productActor";
import { listProducts } from "@/modules/product/productService";
import { PRODUCT_SORT_COLUMNS, parseProductQuery } from "@/modules/product/productQuery";
import {
  classificationSummary,
  productStatusPresentation,
  reviewStatusPresentation,
} from "@/modules/product/productDisplay";
import { displayDate, displayText } from "@/lib/honest";
import { RowCheckbox, SelectAllCheckbox, SelectionProvider } from "@/components/table/BulkSelection";
import { ProductsBulkBar, type ProductExportRow } from "./ProductsBulkActions";

export const dynamic = "force-dynamic";

const BASE_PATH = "/app/products";

/** Chips and sort state ride along with a search, or searching silently clears them. */
const PRESERVED_ON_SEARCH = [
  "status",
  "reviewStatus",
  "jurisdiction",
  "needsRevalidation",
  "unclassified",
  "clientId",
  "sort",
  "dir",
  "pageSize",
] as const;

export default async function ProductsPage(props: {
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

  const [clientsRes, productRes] = await Promise.all([
    getClientsData(context),
    listProducts(productActor(context, "page"), parseProductQuery(params)),
  ]);

  const query = parseProductQuery(params);
  const clients = clientsRes.clients;
  const { rows, total } = productRes;

  const writable = canWrite(context);
  const mayCreate = writable && holdsPermission(context, "products.create");
  const mayImport = writable && holdsPermission(context, "products.import");

  const chipHref = (patch: Record<string, string | number | null>) =>
    tableHref(BASE_PATH, params, { ...patch, page: null });

  const hasFilter = Boolean(
    query.search ||
      query.status ||
      query.reviewStatus ||
      query.jurisdiction ||
      query.needsRevalidation ||
      query.unclassified ||
      query.clientId
  );

  const exportRows: ProductExportRow[] = rows.map((row) => ({
    id: row.id,
    productName: row.productName,
    internalSku: row.internalSku,
    brand: row.brand,
    reviewStatusLabel: reviewStatusPresentation(row.reviewStatus).label,
    statusLabel: productStatusPresentation(row.status).label,
    updatedAt: displayDate(row.updatedAt),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Products</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-3xl">
            The item master for {context.accountName}. A product holds what is true of the item
            everywhere; each customs classification and each origin claim is held per jurisdiction,
            with its own status and its own evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mayImport && (
            <Link
              href="/app/products/import"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-white text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Import
            </Link>
          )}
          {mayCreate && (
            <Link
              href="/app/products/new"
              className="inline-flex items-center h-10 px-4 rounded-xl bg-brand text-white text-sm font-semibold"
            >
              Add product
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
            <label htmlFor="product-search" className="block text-xs font-semibold text-ink-muted mb-1">
              Search name, SKU, brand, description, identifier or code
            </label>
            <input
              id="product-search"
              name="q"
              type="search"
              defaultValue={query.search ?? ""}
              className="w-full h-10 px-3 rounded-xl border border-border text-sm"
            />
          </div>
          <div>
            <label htmlFor="product-client" className="block text-xs font-semibold text-ink-muted mb-1">
              Client Scope
            </label>
            <select
              id="product-client"
              name="clientId"
              defaultValue={query.clientId ?? ""}
              className="h-10 px-3 rounded-xl border border-border text-sm bg-white"
            >
              <option value="">All Clients</option>
              <option value="unassigned">Unassigned (Account-wide)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="product-jurisdiction" className="block text-xs font-semibold text-ink-muted mb-1">
              Approved in
            </label>
            <input
              id="product-jurisdiction"
              name="jurisdiction"
              type="text"
              maxLength={16}
              placeholder="e.g. US"
              defaultValue={query.jurisdiction ?? ""}
              className="w-28 h-10 px-3 rounded-xl border border-border text-sm uppercase"
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
            href={chipHref({ unclassified: query.unclassified ? null : "true" })}
            className={`px-3 py-1.5 rounded-full border ${
              query.unclassified ? "border-brand text-brand" : "border-border text-[#6E6E73]"
            }`}
          >
            No approved classification anywhere
          </Link>
          <Link
            href={chipHref({ reviewStatus: query.reviewStatus === "UNREVIEWED" ? null : "UNREVIEWED" })}
            className={`px-3 py-1.5 rounded-full border ${
              query.reviewStatus === "UNREVIEWED" ? "border-brand text-brand" : "border-border text-[#6E6E73]"
            }`}
          >
            Unreviewed
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white border border-border p-10 text-center">
          <Package className="w-8 h-8 mx-auto text-ink-muted" aria-hidden="true" />
          <p className="mt-3 text-sm text-[#6E6E73]">
            {hasFilter
              ? "No product matches these filters."
              : "No products are recorded for this account yet."}
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
                    <SelectAllCheckbox ids={rows.map((row) => row.id)} label="products on this page" />
                  </th>
                  <SortableHeader
                    column="productName"
                    label="Product"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <th scope="col" className="px-3 xl:px-4 py-3.5">
                    Client Scope
                  </th>
                  <SortableHeader
                    column="internalSku"
                    label="SKU"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <SortableHeader
                    column="brand"
                    label="Brand"
                    query={query}
                    params={params}
                    basePath={BASE_PATH}
                  />
                  <th scope="col" className="px-3 xl:px-4 py-3.5">
                    Customs position
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
                  const status = productStatusPresentation(row.status);
                  const review = reviewStatusPresentation(row.reviewStatus);
                  return (
                    <tr key={row.id} className="hover:bg-surface-muted/50">
                      <td className="px-3 xl:px-4 py-3">
                        <RowCheckbox id={row.id} label={row.productName} />
                      </td>
                      <td className="px-3 xl:px-4 py-3">
                        <Link
                          href={`/app/products/${row.id}`}
                          className="font-semibold text-brand hover:underline"
                        >
                          {row.productName}
                        </Link>
                        {row.model !== null && (
                          <p className="text-xs text-[#6E6E73]">{row.model}</p>
                        )}
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73]">
                        {row.clientName ? (
                          <Badge variant="neutral">{row.clientName}</Badge>
                        ) : (
                          <span className="text-xs text-ink-muted">Account-wide</span>
                        )}
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73]">
                        {displayText(row.internalSku)}
                      </td>
                      <td className="px-3 xl:px-4 py-3 text-[#6E6E73]">{displayText(row.brand)}</td>
                      <td className="px-3 xl:px-4 py-3">
                        <span className="text-[#6E6E73]">
                          {classificationSummary(row.approvedJurisdictions)}
                        </span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {row.pendingClassificationCount > 0 && (
                            <Badge variant="neutral">
                              {row.pendingClassificationCount} not approved
                            </Badge>
                          )}
                          {row.openRevalidationCount > 0 && (
                            <Badge variant="warning">
                              {row.openRevalidationCount} to re-check
                            </Badge>
                          )}
                        </span>
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
            label="products"
          />
        </div>
        <ProductsBulkBar products={exportRows} />
        </SelectionProvider>
      )}

      <p className="text-xs text-[#6E6E73]">
        Sorting is available on {PRODUCT_SORT_COLUMNS.length} columns and lives in the URL, so a
        link reproduces the table exactly.
      </p>
    </div>
  );
}
