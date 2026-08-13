import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { ENTRY_TYPES, normalizeEntryType } from "@/modules/filing/entryType";
import { TERMINAL_STATUSES } from "@/modules/filings/filingStateMachine";
import { FilingDashboardClient, type FilingRow } from "./FilingDashboardClient";
import { CreateFilingPrompt } from "./CreateFilingPrompt";

export default async function CustomsFilingDashboardPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const context = await getAccountContext();
  if (!context) return null;

  const shipmentId = typeof searchParams.shipmentId === "string" ? searchParams.shipmentId : null;

  if (shipmentId) {
    // Only redirect to a still-live filing. A Cancelled/Closed one must not
    // permanently block this shipment from ever starting a fresh filing --
    // that was a real dead end (findFirst with no status filter always found
    // the terminal one first).
    const existingFiling = await db.customsFiling.findFirst({
      where: { shipmentId, accountId: context.accountId, filingStatus: { notIn: [...TERMINAL_STATUSES] } },
      orderBy: { createdAt: "desc" },
    });
    if (existingFiling) redirect(`/app/filing/${existingFiling.id}`);

    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, accountId: context.accountId, deletedAt: null },
      include: { lineItems: true },
    });
    if (!shipment) notFound();

    if (!shipment.destinationCountry) {
      return (
        <div className="max-w-xl mx-auto py-16 text-center space-y-3">
          <AlertCircle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-ink">Destination country not set</h1>
          <p className="text-sm text-ink-muted">
            {shipment.shipmentNumber} has no destination country on file. Every filing rule (procedure, message
            format, authority) is resolved from it, so it has to be set before a filing can start.
          </p>
          <Link href={`/app/shipments/${shipment.id}`} className="inline-block text-sm font-semibold text-brand">
            Set destination country on the shipment
          </Link>
        </div>
      );
    }

    // Only offer entry types this destination actually has a procedure
    // mapping for -- showing all 18 CBP codes regardless of destination is
    // exactly the "one country's vocabulary presented as universal" mistake
    // this page used to make.
    const procedureRows = await db.filingProcedureMapping.findMany({
      where: { country: { in: [shipment.destinationCountry, "*"] } },
      select: { entryType: true },
    });
    const mappedEntryTypes = new Set(procedureRows.map((r) => r.entryType));
    const entryTypeOptions = ENTRY_TYPES.filter((e) => mappedEntryTypes.has(e.code)).map((e) => ({
      code: e.code,
      label: e.label,
    }));

    if (entryTypeOptions.length === 0) {
      return (
        <div className="max-w-xl mx-auto py-16 text-center space-y-3">
          <AlertCircle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-ink">No filing procedure configured for this destination</h1>
          <p className="text-sm text-ink-muted">
            "{shipment.destinationCountry}" has no entry-type-to-procedure mapping yet. Add a
            FilingProcedureMapping row for it before filing to this destination.
          </p>
          <Link href="/app/filing" className="inline-block text-sm font-semibold text-brand">
            Back to Customs Filing
          </Link>
        </div>
      );
    }

    const totalValue = shipment.lineItems.reduce((acc, li) => acc + Number(li.totalValue), 0);

    return (
      <CreateFilingPrompt
        shipment={{
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          importerName: shipment.importerName,
          entryType: normalizeEntryType(shipment.entryType),
        }}
        entryTypeOptions={entryTypeOptions}
        lineItemCount={shipment.lineItems.length}
        totalValue={totalValue}
      />
    );
  }

  const filings = await db.customsFiling.findMany({
    where: { accountId: context.accountId },
    include: {
      shipment: {
        select: { shipmentNumber: true, importerName: true, destinationCountry: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: FilingRow[] = filings.map((f) => ({
    id: f.id,
    entryNumber: f.entryNumber,
    importer: f.shipment?.importerName ?? null,
    country: f.shipment?.destinationCountry ?? null,
    filingType: f.filingType,
    filingStatus: f.filingStatus,
    totalValue: f.totalValue === null ? null : Number(f.totalValue),
    filedDate: f.submittedAt ? f.submittedAt.toISOString() : null,
    lastUpdated: f.updatedAt.toISOString(),
  }));

  return <FilingDashboardClient initialFilings={rows} />;
}
