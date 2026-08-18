import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { MappingClient } from "./MappingClient";

export const revalidate = 0;

export default async function RateCardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const rateCard = await db.rateCard.findUnique({
    where: { id },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        include: {
          rules: {
            include: {
              capabilityMappings: {
                include: { eventDefinition: true },
              },
            },
          },
        },
      },
    },
  });

  if (!rateCard) {
    notFound();
  }

  const activeVersion = rateCard.versions[0];
  const formattedRules = (activeVersion?.rules ?? []).map((r) => ({
    id: r.id,
    lineItemName: r.lineItemName,
    pricingModel: r.pricingModel,
    rate: Number(r.rate),
    mappedEvents: r.capabilityMappings.map((m) => m.eventDefinition.eventCode),
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                rateCard.status === "ACTIVE"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {rateCard.status}
            </span>
            <span className="text-xs text-ink-muted">Version v{rateCard.currentVersion}</span>
          </div>
          <h2 className="text-xl font-bold text-ink mt-1">{rateCard.name}</h2>
          <p className="text-sm text-ink-muted">
            Scope: {rateCard.client?.name ?? rateCard.importer?.name ?? "Brokerage Default"} | Currency: {rateCard.currency}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/app/billing/rate-cards"
            className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
          >
            ← Back to Rate Cards
          </Link>
        </div>
      </div>

      {/* Interactive Platform API & Capability Mapping */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-ink">Rate Card Line-Item to Platform API Capability Mapping</h3>
          <p className="text-xs text-ink-muted mt-1">
            Link commercial customer line items to stable Qubere platform billing event codes emitted by API endpoints, AI agents, and broker workflows.
          </p>
        </div>

        <MappingClient rules={formattedRules} />
      </div>
    </div>
  );
}
