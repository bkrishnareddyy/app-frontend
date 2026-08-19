import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { getClientsData } from "@/lib/clients/clientsData";
import { holdsPermission } from "@/modules/product/productActor";
import { NewProductForm } from "./NewProductForm";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const [clientsRes] = await Promise.all([getClientsData(context)]);

  const writable = canWrite(context);
  const mayCreate = writable && holdsPermission(context, "products.create");

  const clientOptions = clientsRes.clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/products" className="text-sm font-semibold text-brand">
          ← Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mt-2">Add a product</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-3xl">
          This records what the item is. Classification is not asked for here: a tariff code is a
          decision made for one jurisdiction, against evidence, by someone who holds the permission
          to approve it — so it is proposed on the product&apos;s Trade &amp; customs tab, not typed
          in at creation.
        </p>
      </div>

      {mayCreate ? (
        <NewProductForm clients={clientOptions} />
      ) : (
        <div role="status" className="rounded-2xl bg-white border border-border p-6 text-sm text-ink">
          {writable
            ? "You do not hold products.create in this account, so you cannot add a product here."
            : READ_ONLY_MESSAGE}
        </div>
      )}
    </div>
  );
}
