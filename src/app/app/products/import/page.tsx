import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { holdsPermission } from "@/modules/product/productActor";
import { ImportWizard } from "./ImportWizard";

export const dynamic = "force-dynamic";

export default async function ProductImportPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const writable = canWrite(context);
  const mayImport = writable && holdsPermission(context, "products.import");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/products" className="text-sm font-semibold text-brand">
          ← Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mt-2">Import products</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-3xl">
          Upload a file, read what it would do, then apply it. Nothing is written until you press
          Import, and a row whose identifiers already resolve to a product is skipped — so
          re-uploading the same file twice creates nothing the second time.
        </p>
      </div>

      {mayImport ? (
        <ImportWizard />
      ) : (
        <div role="status" className="rounded-2xl bg-white border border-border p-6 text-sm text-ink">
          {writable
            ? "You do not hold products.import in this account, so you cannot import products here."
            : READ_ONLY_MESSAGE}
        </div>
      )}
    </div>
  );
}
