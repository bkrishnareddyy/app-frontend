"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { displayCurrency } from "@/lib/honest";
import { ShipmentFilingModal } from "./ShipmentFilingModal";

interface CreateFilingPromptProps {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    entryType: string | null;
    destinationCountry?: string | null;
  };
  lineItemCount: number;
  totalValue: number;
}

export function CreateFilingPrompt({ shipment, lineItemCount, totalValue }: CreateFilingPromptProps) {
  const [isModalOpen, setIsModalOpen] = useState(true);

  return (
    <div className="max-w-xl mx-auto py-12 space-y-6">
      <Link href="/app/filing" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
        <ArrowLeft className="w-3.5 h-3.5" />
        All Filings
      </Link>

      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-5">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-ink">Start a Customs Filing</h1>
            <p className="text-xs text-ink-muted">
              {shipment.shipmentNumber} &middot; {shipment.importerName}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-ink-muted">Line Items</p>
            <p className="font-bold text-ink">{lineItemCount}</p>
          </div>
          <div>
            <p className="text-ink-muted">Declared Value</p>
            <p className="font-bold text-ink">{displayCurrency(totalValue)}</p>
          </div>
        </div>
      </div>

      <ShipmentFilingModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          // Redirect back to filing dashboard
          setTimeout(() => {
            window.location.href = "/app/filing";
          }, 100);
        }}
        shipmentId={shipment.id}
        defaultCountry={shipment.destinationCountry}
      />
    </div>
  );
}
