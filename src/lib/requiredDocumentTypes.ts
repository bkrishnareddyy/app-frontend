// The set of document types a shipment needs before it can file, and which
// of them are still missing. Certificate of Origin is only required when a
// preferential tariff treatment is being claimed (or origin hasn't been
// verified yet) -- callers pass that in as `includeCertificateOfOrigin`
// rather than this module re-deriving it, since the HTS-based check lives
// alongside each caller's own origin-status logic.
//
// This was previously computed independently in two places (the shipment
// detail page's missing-doc callout and ShipmentDocumentsSection's "X/N
// required document types on file" line) with matching but separately
// maintained logic. Centralizing it here keeps every surface -- including
// the Command Center "My Work" view -- in agreement.

export interface RequiredDocRow {
  docType: string | null;
  fileName: string | null;
  status: string;
  fileUrl?: string | null;
}

export interface DocumentTypeCheckResult {
  requiredTypes: string[];
  missingTypes: string[];
  receivedCount: number;
  totalRequired: number;
}

const isDocReceived = (d: RequiredDocRow) =>
  d.status !== "Missing" &&
  Boolean(
    d.fileUrl ||
      d.status === "Received" ||
      d.status === "Processed" ||
      d.status === "Review Required" ||
      d.status === "Completed"
  );

export function checkRequiredDocumentTypes(
  documents: RequiredDocRow[],
  includeCertificateOfOrigin: boolean
): DocumentTypeCheckResult {
  const requiredTypes = ["Commercial Invoice", "Packing List", "Bill of Lading"];
  if (includeCertificateOfOrigin) requiredTypes.push("Certificate of Origin");

  const missingTypes = requiredTypes.filter((req) => {
    return !documents.some((d) => {
      if (!isDocReceived(d)) return false;
      const type = (d.docType || "").toLowerCase();
      const name = (d.fileName || "").toLowerCase();
      if (req === "Commercial Invoice") return type.includes("invoice") || name.includes("invoice");
      if (req === "Packing List") return type.includes("packing") || name.includes("packing");
      if (req === "Bill of Lading")
        return (
          type.includes("lading") ||
          type.includes("transport") ||
          name.includes("lading") ||
          name.includes("instructions") ||
          name.includes("waybill")
        );
      if (req === "Certificate of Origin")
        return type.includes("origin") || type.includes("coo") || name.includes("origin") || name.includes("coo");
      return false;
    });
  });

  return {
    requiredTypes,
    missingTypes,
    receivedCount: requiredTypes.length - missingTypes.length,
    totalRequired: requiredTypes.length,
  };
}
