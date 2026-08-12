import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { importTemplateCsv } from "@/modules/product/productCsv";

/** The column headers the importer understands, as a downloadable CSV. */
export const GET = withAuthenticatedRoute(async () => {
  return new Response(importTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="qubere-product-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
});
