import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { importTemplateCsv } from "@/modules/party/partyCsv";

/** The column headers the importer understands, as a downloadable CSV. */
export const GET = withAuthenticatedRoute(async () => {
  return new Response(importTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="qubere-party-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
});
