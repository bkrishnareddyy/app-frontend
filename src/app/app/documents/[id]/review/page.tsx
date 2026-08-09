import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { documentViewUrl } from "@/lib/documentUrl";
import { buildReviewFields } from "@/modules/documents/extractionReview";
import { DocumentReviewWorkspace } from "./DocumentReviewWorkspace";

export default async function DocumentReviewPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const context = await getAccountContext();
  if (!context) return null;

  const document = await db.shipmentDocument.findFirst({
    where: { id, accountId: context.accountId },
    include: {
      extractionFields: true,
      shipment: { select: { id: true, shipmentNumber: true } },
    },
  });

  if (!document) notFound();

  const fields = buildReviewFields(document.extractionFields);

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-12">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={
            document.shipment
              ? `/app/shipments/${document.shipment.id}#documents`
              : "/app/documents"
          }
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#0071E3] hover:underline"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          <span>
            {document.shipment
              ? `Back to ${document.shipment.shipmentNumber}`
              : "Back to documents"}
          </span>
        </Link>
      </div>

      <DocumentReviewWorkspace
        documentId={document.id}
        fileName={document.fileName}
        docType={document.docType}
        pageCount={document.pageCount}
        proxyUrl={document.fileUrl ? documentViewUrl(document.id) : null}
        shipmentNumber={document.shipment?.shipmentNumber ?? null}
        initialFields={fields}
      />
    </div>
  );
}
