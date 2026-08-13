"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, Label, Select } from "@/components/ui/Input";
import { displayCurrency } from "@/lib/honest";

interface EntryTypeOption {
  code: string;
  label: string;
}

interface CreateFilingPromptProps {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    entryType: string | null;
  };
  entryTypeOptions: EntryTypeOption[];
  lineItemCount: number;
  totalValue: number;
}

function errorFromResponse(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error?: { message?: string } | string }).error;
    if (typeof err === "string") return err;
    if (err && typeof err.message === "string") return err.message;
  }
  return fallback;
}

export function CreateFilingPrompt({ shipment, entryTypeOptions, lineItemCount, totalValue }: CreateFilingPromptProps) {
  const router = useRouter();
  const defaultEntryType = entryTypeOptions.find((o) => o.code === shipment.entryType)?.code ?? entryTypeOptions[0]?.code ?? "";
  const [entryType, setEntryType] = useState(defaultEntryType);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/filing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: shipment.id, entryType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Could not create the filing."));
      router.push(`/app/filing/${data.filing.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-12 space-y-6">
      <Link href="/app/filing" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
        <ArrowLeft className="w-3.5 h-3.5" />
        All Filings
      </Link>

      <Card className="space-y-5">
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

        <FormField>
          <Label htmlFor="entry-type">Entry Type</Label>
          <Select id="entry-type" value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            {entryTypeOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} — {o.label}
              </option>
            ))}
          </Select>
        </FormField>

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        <Button onClick={handleCreate} loading={submitting} disabled={!entryType} className="w-full justify-center">
          Create Filing
        </Button>
      </Card>
    </div>
  );
}
