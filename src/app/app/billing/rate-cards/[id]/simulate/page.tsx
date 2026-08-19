import React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { SimulateClient } from "./SimulateClient";

export const revalidate = 0;

export default async function RateCardSimulatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const canView = await hasPermission("billing.ratecard.manage") || await hasPermission("billing.ratecard.view");
  if (!canView) redirect("/app/billing/rate-cards");

  const { id } = await params;

  const rateCard = await db.rateCard.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true, effectiveDate: true },
      },
    },
  });
  if (!rateCard) notFound();

  // Prefer the latest DRAFT version for "what if we activate this?" scenarios;
  // fall back to the current ACTIVE version for "what would a different price do?" cases.
  const proposedVersion =
    rateCard.versions.find((v) => v.status === "DRAFT") ??
    rateCard.versions.find((v) => v.status === "ACTIVE") ??
    rateCard.versions[0];

  if (!proposedVersion) notFound();

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink">Rate Card Simulation — {rateCard.name}</h2>
          <p className="text-sm text-ink-muted">
            Simulating v{proposedVersion.version} ({proposedVersion.status}) against historical usage events.
            No charges are created or modified.
          </p>
        </div>
        <Link href={`/app/billing/rate-cards/${id}`} className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors">
          ← Back to Rate Card
        </Link>
      </div>

      {rateCard.versions.length > 1 && (
        <div className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-xs text-ink-muted">
          Simulating the{" "}
          <span className="font-semibold text-ink">
            {proposedVersion.status === "DRAFT" ? "latest DRAFT version" : "currently ACTIVE version"}
          </span>
          {" "}(v{proposedVersion.version}). To simulate a specific version,
          activate it as DRAFT first or contact your administrator.
        </div>
      )}

      <SimulateClient
        rateCardVersionId={proposedVersion.id}
        rateCardName={rateCard.name}
      />
    </div>
  );
}
