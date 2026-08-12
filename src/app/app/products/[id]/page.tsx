import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { Badge } from "@/components/ui";
import { CopilotContextRegistrar } from "@/components/copilot/CopilotContextRegistrar";
import { displayDate, displayText } from "@/lib/honest";
import { holdsPermission, productActor } from "@/modules/product/productActor";
import { getProduct } from "@/modules/product/productService";
import { allCapabilityStatuses } from "@/modules/product/productIntelligence";
import {
  parseChangeReason,
  productStatusPresentation,
  resolveTab,
  revalidationPresentation,
  reviewStatusPresentation,
} from "@/modules/product/productDisplay";
import { RevalidationActions } from "./ProductActions";
import { ProductTabs } from "./ProductTabs";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const actor = productActor(context, "page");
  const product = await getProduct(actor, id);
  // A product in another account is absent, not forbidden.
  if (product === null) notFound();

  const rawTab = searchParams.tab;
  const tab = resolveTab(typeof rawTab === "string" ? rawTab : null);

  const writable = canWrite(context);
  const mayEdit = writable && holdsPermission(context, "products.edit");
  const mayApprove = writable && holdsPermission(context, "products.classification.approve");
  const mayVerifyOrigin = writable && holdsPermission(context, "products.origin.verify");

  const status = productStatusPresentation(product.status);
  const review = reviewStatusPresentation(product.reviewStatus);
  const openFlags = product.revalidationFlags.filter((flag) => flag.status === "OPEN");
  const activeAttributes = product.attributes.filter((a) => a.status === "ACTIVE");
  const activeCompositions = product.compositions.filter((c) => c.status === "ACTIVE");
  const activeParties = product.parties.filter((p) => p.status === "ACTIVE");
  const approvedJurisdictions = [
    ...new Set(
      product.classifications.filter((c) => c.status === "APPROVED").map((c) => c.jurisdiction)
    ),
  ].sort();

  const capabilities = allCapabilityStatuses();

  return (
    <div className="space-y-6">
      {/* Lets "this product" mean this product in the Copilot. The id is a hint
          the server re-resolves against the account; it grants nothing. */}
      <CopilotContextRegistrar
        page="PRODUCT_DETAIL"
        entityType="PRODUCT"
        entityId={product.id}
        label={product.productName}
      />
      <div>
        <Link href="/app/products" className="text-sm font-semibold text-brand">
          ← Products
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{product.productName}</h1>
            <p className="text-sm text-ink-muted mt-1">
              {displayText(product.internalSku, "No internal SKU")} · version {product.currentVersion}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={review.tone}>{review.label}</Badge>
            <Badge variant={status.tone}>{status.label}</Badge>
          </div>
        </div>
      </div>

      {openFlags.length > 0 && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-amber-900">
              {openFlags.length === 1
                ? "One thing is waiting to be re-checked"
                : `${openFlags.length} things are waiting to be re-checked`}
            </h2>
            <p className="text-xs text-amber-900/80 mt-1">
              These are requests for a person to look again. Nothing here has changed a
              classification, an origin, or a value — the approved positions below still stand.
            </p>
          </div>
          <ul className="space-y-3">
            {openFlags.map((flag) => {
              const presentation = revalidationPresentation(flag.flag);
              return (
                <li key={flag.id} className="rounded-xl bg-white border border-amber-200 p-4 space-y-2">
                  <p className="text-sm font-semibold text-ink">{presentation.label}</p>
                  <div className="space-y-1">
                    {parseChangeReason(flag.reason).map((segment, index) => (
                      <p key={index} className="text-xs text-[#6E6E73]">
                        {segment.source && (
                          <span className="font-mono text-[11px] text-[#6E6E73]/70 mr-1">{segment.source}</span>
                        )}
                        {segment.text}
                      </p>
                    ))}
                  </div>
                  <p className="text-xs text-[#6E6E73]">{presentation.description}</p>
                  <p className="text-xs text-[#6E6E73]">Raised {displayDate(flag.createdAt)}</p>
                  {mayEdit && <RevalidationActions productId={id} flagId={flag.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ProductTabs
        productId={id}
        initialTab={tab}
        product={product}
        mayEdit={mayEdit}
        mayApprove={mayApprove}
        mayVerifyOrigin={mayVerifyOrigin}
        activeAttributes={activeAttributes}
        activeCompositions={activeCompositions}
        activeParties={activeParties}
        approvedJurisdictions={approvedJurisdictions}
        capabilities={capabilities}
      />
    </div>
  );
}
