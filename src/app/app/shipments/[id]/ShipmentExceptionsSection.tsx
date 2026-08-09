import Link from "next/link";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { displayDate, displayText } from "@/lib/honest";
import { exceptionStatusLabel } from "@/modules/exceptions/exceptionState";

interface ExceptionRow {
  id: string;
  severity: string;
  type: string;
  description: string;
  status: string;
  createdAt: Date;
}

interface ReconciliationRow {
  id: string;
  severity: string;
  field: string;
  expectedValue: string;
  actualValue: string;
  sourceDocuments: string[];
  createdAt: Date;
}

interface ShipmentExceptionsSectionProps {
  shipmentId: string;
  exceptions: ExceptionRow[];
  reconciliationIssues: ReconciliationRow[];
}

/**
 * Only stored records appear here. The workspace used to render a fixed set of
 * exception cards regardless of what the shipment actually had.
 */
export function ShipmentExceptionsSection({
  shipmentId,
  exceptions,
  reconciliationIssues,
}: ShipmentExceptionsSectionProps) {
  return (
    <section
      id="exceptions"
      aria-labelledby="exceptions-heading"
      className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 scroll-mt-6"
    >
      <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 text-sm">
        <div className="flex items-center space-x-4">
          <h2 id="exceptions-heading" className="font-bold text-[#1D1D1F]">
            4. Exceptions ({exceptions.length} open)
          </h2>
          <span className="text-[#6E6E73]">
            Reconciliation issues ({reconciliationIssues.length})
          </span>
        </div>
        <Link
          href={`/app/exceptions?shipmentId=${shipmentId}`}
          className="text-sm font-semibold text-[#0071E3] hover:underline"
        >
          View all exceptions
        </Link>
      </div>

      {exceptions.length === 0 && reconciliationIssues.length === 0 ? (
        <p className="text-sm text-[#6E6E73] py-2">
          No open exceptions or reconciliation issues are recorded for this shipment.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {exceptions.map((ex) => (
            <div
              key={ex.id}
              className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2"
            >
              <div className="flex items-center space-x-2 text-sm font-bold text-[#1D1D1F]">
                {ex.severity === "Critical" || ex.severity === "High" ? (
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {ex.severity} · {ex.type.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-sm text-[#6E6E73]">{displayText(ex.description)}</p>
              <p className="text-sm text-[#6E6E73]">
                {exceptionStatusLabel(ex.status)} · opened {displayDate(ex.createdAt)}
              </p>
              <Link
                href={`/app/exceptions?exceptionId=${encodeURIComponent(ex.id)}`}
                className="inline-block text-sm font-semibold text-[#0071E3] hover:underline pt-1"
              >
                Open exception
              </Link>
            </div>
          ))}

          {reconciliationIssues.map((issue) => (
            <div
              key={issue.id}
              className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2"
            >
              <div className="flex items-center space-x-2 text-sm font-bold text-[#1D1D1F]">
                {issue.severity === "Critical" ? (
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" aria-hidden="true" />
                ) : (
                  <Info className="w-4 h-4 text-blue-500 shrink-0" aria-hidden="true" />
                )}
                <span>{issue.field} mismatch</span>
              </div>
              <p className="text-sm text-[#6E6E73]">
                Expected {displayText(issue.expectedValue)} · found{" "}
                {displayText(issue.actualValue)}
              </p>
              <p className="text-sm text-[#6E6E73]">
                {issue.sourceDocuments.length > 0
                  ? issue.sourceDocuments.join(" vs ")
                  : "Source documents not recorded"}
              </p>
              <p className="text-sm text-[#6E6E73]">Detected {displayDate(issue.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
