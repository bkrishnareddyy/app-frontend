import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { activateRateCardAction, createNewRateCardVersionAction, retireRateCardAction, duplicateRateCardAction } from "../../actions";
import { MappingClient } from "./MappingClient";
import { RateRuleEditor } from "./RateRuleEditor";

export const revalidate = 0;

export default async function RateCardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const canView = await hasPermission("billing.ratecard.manage") || await hasPermission("billing.ratecard.view");
  if (!canView) redirect("/app/billing");

  const { id } = await params;
  const rateCard = await db.rateCard.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        include: { rules: { include: { capabilityMappings: { include: { eventDefinition: true } } } } },
      },
    },
  });

  if (!rateCard) notFound();
  const rateCardId = rateCard.id;
  const latestVersion = rateCard.versions[0];
  const formattedRules = (latestVersion?.rules ?? []).map((r) => ({
    id: r.id,
    lineItemName: r.lineItemName,
    pricingModel: r.pricingModel,
    rate: Number(r.rate),
    mappedEvents: r.capabilityMappings.map((m) => m.eventDefinition.eventCode),
  }));

  const isDraft = latestVersion?.status === "DRAFT";
  const isActive = rateCard.status === "ACTIVE";
  const isRetired = rateCard.status === "RETIRED";

  async function activateCurrentRateCard() {
    "use server";
    await activateRateCardAction(rateCardId);
  }

  async function createNewVersion() {
    "use server";
    await createNewRateCardVersionAction(rateCardId);
  }

  async function retireCard() {
    "use server";
    await retireRateCardAction(rateCardId);
  }

  async function duplicateCard() {
    "use server";
    const result = await duplicateRateCardAction(rateCardId);
    redirect(`/app/billing/rate-cards/${result.rateCardId}`);
  }

  const statusColors: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DRAFT: "bg-amber-50 text-amber-800 border-amber-200",
    RETIRED: "bg-slate-100 text-slate-500 border-slate-200",
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusColors[rateCard.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
              {rateCard.status}
            </span>
            <span className="text-xs text-ink-muted">Version v{latestVersion?.version ?? rateCard.currentVersion}</span>
            {isDraft && latestVersion && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">Draft</span>
            )}
          </div>
          <h2 className="text-xl font-bold text-ink mt-1">{rateCard.name}</h2>
          <p className="text-sm text-ink-muted">Scope: {rateCard.client?.name ?? rateCard.importer?.name ?? "Brokerage Default"} | Currency: {rateCard.currency}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && <form action={activateCurrentRateCard}><button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm">Activate Rate Card</button></form>}
          {isActive && (
            <form action={createNewVersion}>
              <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm">Create New Version</button>
            </form>
          )}
          {!isRetired && (
            <form action={retireCard} onSubmit={(e) => { if (!confirm("Retire this rate card? It will no longer be used for new charges.")) e.preventDefault(); }}>
              <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">Retire</button>
            </form>
          )}
          <form action={duplicateCard}>
            <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">Duplicate</button>
          </form>
          <Link href={`/app/billing/rate-cards/${rateCardId}/simulate`} className="px-4 py-2 rounded-lg text-xs font-semibold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 transition-colors">Simulate</Link>
          <Link href="/app/billing/rate-cards" className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors">← Back</Link>
        </div>
      </div>

      {/* Rate rules: editable in DRAFT, mapping-only when ACTIVE */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-ink">
            {isDraft ? "Edit Rate Rules" : "Rate Card Line-Item to Platform API Capability Mapping"}
          </h3>
          <p className="text-xs text-ink-muted mt-1">
            {isDraft
              ? "Add, edit, or remove line-item rules while this version is in Draft status. Once activated, rules become immutable."
              : "Link commercial customer line items to stable Qubere platform billing event codes emitted by API endpoints, AI agents, and broker workflows."}
          </p>
        </div>
        {isDraft && latestVersion ? (
          <RateRuleEditor
            versionId={latestVersion.id}
            rateCardId={rateCardId}
            currency={rateCard.currency}
            rules={formattedRules}
          />
        ) : (
          <MappingClient rules={formattedRules} />
        )}
      </div>

      {/* Version history */}
      {rateCard.versions.length > 1 && (
        <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <h3 className="text-base font-bold text-ink">Version History</h3>
          <div className="space-y-2">
            {rateCard.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b border-[#E5E5EA] last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-ink">v{v.version}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColors[v.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>{v.status}</span>
                  {v.notes && <span className="text-xs text-ink-muted">{v.notes}</span>}
                </div>
                <div className="text-xs text-ink-muted">
                  Effective {new Date(v.effectiveDate).toLocaleDateString()}
                  {v.activatedAt && ` · Activated ${new Date(v.activatedAt).toLocaleDateString()}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
