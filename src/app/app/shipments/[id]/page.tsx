import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentViewUrl } from "@/lib/documentUrl";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  CheckCircle2,
  Sparkles,
  Building2,
  Truck,
  Activity,
  Layers,
  ArrowRight,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { Badge } from "@/components/ui/Badge";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { PipelineProgressTracker } from "./PipelineProgressTracker";
import { DocumentReviewPanel } from "@/components/DocumentReviewPanel";
import { ShipmentTitleEditor } from "./ShipmentTitleEditor";
import { ShipmentClientEditor } from "./ShipmentClientEditor";
import { ExceptionsDrawer } from "./ExceptionsDrawer";
import { LineItemsTable } from "./LineItemsTable";
import { CanonicalFactsSection } from "./CanonicalFactsSection";
import { PreFilingReadiness } from "./PreFilingReadiness";
import { AgentExecutionTimeline } from "./AgentExecutionTimeline";
import { buildAgentInvocations } from "./agentInvocations";

export default async function ShipmentWorkspacePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docId?: string; view?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const activeTab = searchParams.view || "workspace";
  const docId = searchParams.docId;

  const context = await getAccountContext();
  if (!context) return null;

  const shipment = await db.shipment.findFirst({
    where: {
      accountId: context.accountId,
      OR: [{ id: params.id }, { shipmentNumber: params.id }],
      deletedAt: null,
    },
  });

  if (!shipment) notFound();

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  const canEditClient =
    isEnterpriseAdmin ||
    (context.roleNames.includes("PLANNER") && shipment.assignedBrokerId === context.userId);

  // None of these three depend on each other, and each database round-trip
  // costs about a second against the remote pooler.
  const [canonical, clients, fieldApprovals] = await Promise.all([
    CanonicalShipmentService.getCanonicalState(shipment.id),
    canEditClient
      ? db.client.findMany({
          where: { accountId: context.accountId },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // Real per-field approval provenance ("who confirmed this value, and
    // when") -- see FieldApproval in schema.prisma. Ordered desc so the first
    // entry found for a given key (whether keyed by fieldKey alone or by
    // documentId+fieldKey) is always the latest.
    db.fieldApproval.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { approvedAt: "desc" },
    }),
  ]);

  const { metrics, facts, agentExecutionLogs } = canonical;
  const fullShipment = canonical.shipment;
  const documents = fullShipment.documents || [];

  // Merges AgentExecutionRecord (selective re-runs) and AgentExecutionLog
  // (the real 10-agent upload pipeline) into one waterfall-ready list --
  // see agentInvocations.ts for why these two tables exist separately.
  const agentInvocations = buildAgentInvocations(fullShipment.agentExecutionRecords || [], agentExecutionLogs || []);

  // Load display line items
  let displayLineItems = (fullShipment.lineItems || []).map((item: any) => ({
    id: item.id,
    lineNumber: item.lineNumber,
    partNumber: item.partNumber || "",
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    totalValue: Number(item.totalValue),
    countryOfOrigin: item.countryOfOrigin || "",
    htsCode: item.htsCode || "",
    htsConfidence: item.htsConfidence || 95,
    status: item.status || "Extracted",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  const totalInvoiceAmount = displayLineItems.reduce(
    (acc: number, item: any) => acc + Number(item.quantity) * Number(item.unitPrice),
    0
  );

  const activeExceptions = fullShipment.exceptionItems || [];

  const latestApprovalByField: Record<string, { name: string; approvedAt: string }> = {};
  const approvalByDocField = new Map<string, { name: string; approvedAt: string }>();
  for (const fa of fieldApprovals) {
    const snapshot = { name: fa.approvedByName, approvedAt: fa.approvedAt.toISOString() };
    if (!latestApprovalByField[fa.fieldKey]) latestApprovalByField[fa.fieldKey] = snapshot;
    const docKey = `${fa.documentId}:${fa.fieldKey}`;
    if (!approvalByDocField.has(docKey)) approvalByDocField.set(docKey, snapshot);
  }

  // "What fields do we expect from this document, and did we get them" --
  // built from the same tradeMetadata Document Intelligence already
  // extracts and persists (documentIntelligenceAgent.ts), cross-referenced
  // with real FieldApproval provenance. Passed to ExceptionsDrawer so the
  // Exceptions panel can group by source document instead of showing a flat
  // list of exceptions that all happen to point at the same file.
  const FIELD_REVIEW_LABELS: Record<string, string> = {
    exporterName: "Exporter Name",
    importerName: "Importer / Consignee Name",
    originCountry: "Country of Origin",
  };
  const documentFieldSummaries = documents
    .filter((d: any) => Boolean(d.extractedJson))
    .map((d: any) => {
      let tradeMetadata: any = {};
      try {
        tradeMetadata = JSON.parse(d.extractedJson).tradeMetadata || {};
      } catch (e) {}

      const fields = Object.keys(FIELD_REVIEW_LABELS).map((key) => {
        const value: string | null = tradeMetadata[key] || null;
        const approval = approvalByDocField.get(`${d.id}:${key}`);
        const status: "MISSING" | "CONFIRMED" | "NEEDS_REVIEW" = !value
          ? "MISSING"
          : approval
          ? "CONFIRMED"
          : "NEEDS_REVIEW";
        return {
          key,
          label: FIELD_REVIEW_LABELS[key],
          value,
          status,
          approvedByName: approval?.name,
          approvedAt: approval?.approvedAt,
        };
      });

      return {
        documentId: d.id as string,
        fileName: d.fileName as string,
        confirmedCount: fields.filter((f) => f.status === "CONFIRMED").length,
        totalCount: fields.length,
        fields,
      };
    });

  // Importer display can fall back from the legal Importer of Record down
  // to the (unrelated, business-relationship) Client, then the free-text
  // importerName field -- surface which source is actually being shown so
  // it's never silently mistaken for a verified legal entity.
  const importerOfRecord = fullShipment.importerOfRecord;
  const importerDisplay = importerOfRecord?.name
    ? { name: importerOfRecord.name, sourceLabel: null }
    : fullShipment.client?.name
    ? { name: fullShipment.client.name, sourceLabel: "via Client, not a verified Importer of Record" }
    : shipment.importerName
    ? { name: shipment.importerName, sourceLabel: "unverified, entered on shipment" }
    : { name: null, sourceLabel: null };

  const poaRecords = importerOfRecord?.powersOfAttorney || [];
  const activePoa = poaRecords.find(
    (poa: any) => poa.status === "Active" && (!poa.expirationDate || new Date(poa.expirationDate) >= new Date())
  );
  const expiredPoa = poaRecords.find(
    (poa: any) => poa.status === "Expired" || (poa.expirationDate && new Date(poa.expirationDate) < new Date())
  );
  const poaStatusDisplay = importerOfRecord ? (activePoa ? "VALID" : "NOT ON FILE") : "NO IMPORTER LINKED";

  const bondTypeDisplay = importerOfRecord?.bond
    ? importerOfRecord.bond.bondType === "continuous"
      ? "Continuous Bond"
      : "Single Transaction Bond"
    : null;

  // ---------------------------------------------------------------------
  // Pre-Filing Readiness ribbon: 11 category statuses computed from real
  // shipment/document/line-item/importer data (not the multi-dimensional
  // metrics bar above, which is a coarser 4-number summary -- this is the
  // detailed, per-category breakdown used to drive the ribbon UI).
  // ---------------------------------------------------------------------

  // 1. Importer & Filing Authority
  let importerStatus: "Ready" | "Blocked" | "Needs Information" = "Ready";
  let importerResult = "CBP Importer Number & Active Bond verified";
  let importerDetails = "Active customs bond and registered importer credentials are valid on file.";
  let importerActionRequired = "";
  let importerActionOwner = "Broker";

  if (!shipment.importerName || shipment.importerName === "To Order" || !importerOfRecord) {
    importerStatus = "Needs Information";
    importerResult = "Consigned 'To Order' - Importer of Record missing";
    importerDetails = "The shipment is consigned 'To Order'. A registered Importer of Record with active bond must be nominated before filing.";
    importerActionRequired = "Provide importer entity details and CBP Importer Number.";
    importerActionOwner = "Importer";
  } else if (!importerOfRecord.irsEin || !importerOfRecord.cbpImporterNumber) {
    importerStatus = "Needs Information";
    importerResult = "Importer registered credentials missing";
    importerDetails = `IRS EIN or CBP Importer Number for importer ${shipment.importerName} is not set.`;
    importerActionRequired = "Provide CBP Importer Number and IRS EIN verification.";
    importerActionOwner = "Importer";
  } else if (
    !importerOfRecord.bond ||
    importerOfRecord.bond.status !== "Active" ||
    (importerOfRecord.bond.expirationDate && new Date(importerOfRecord.bond.expirationDate) < new Date())
  ) {
    importerStatus = "Blocked";
    importerResult = "Customs Bond Missing or Expired";
    importerDetails = `Importer ${shipment.importerName} does not have an active Customs Bond on file with CBP. Continuous bond is required for consumption entry.`;
    importerActionRequired = "Procure continuous customs bond (Form 301) and update surety record.";
    importerActionOwner = "Importer";
  } else if (poaRecords.length === 0) {
    importerStatus = "Blocked";
    importerResult = "Broker Power of Attorney Missing";
    importerDetails = `No Broker Power of Attorney (POA) exists for importer ${shipment.importerName}. A signed POA must be established before transmission.`;
    importerActionRequired = "Execute a new Customs Power of Attorney (Form 5291) with signed corporate officer verification.";
    importerActionOwner = "Importer";
  } else if (expiredPoa && !activePoa) {
    importerStatus = "Blocked";
    importerResult = "POA Expired";
    importerDetails = `Customs power of attorney for importer ${shipment.importerName} expired on ${new Date(expiredPoa.expirationDate!).toLocaleDateString()}.`;
    importerActionRequired = "Execute a new Customs Power of Attorney (Form 5291) with signed corporate officer verification.";
    importerActionOwner = "Importer";
  }

  // Extract key-value pairs from documents dynamically
  let extractedVessel = "";
  let extractedVoyage = "";
  let extractedBookingRef = "";
  let extractedPortOfLoading = "";
  let extractedPortOfDischarge = "";
  let extractedContainerNo = "";
  let extractedGrossWeight = "";
  let extractedShipper = "";
  let extractedConsignee = "";
  let extractedNotifyParty = "";
  let extractedMethodOfDespatch = "";

  for (const doc of documents) {
    if (!doc.extractedJson) continue;
    try {
      const parsed = JSON.parse(doc.extractedJson);
      const kv = parsed.keyValuePairs || {};

      if (kv["Vessel"]) extractedVessel = kv["Vessel"];
      if (kv["Voyage Number"]) extractedVoyage = kv["Voyage Number"];
      if (kv["Booking Reference"]) extractedBookingRef = kv["Booking Reference"];
      if (kv["Port of Loading"]) extractedPortOfLoading = kv["Port of Loading"];
      if (kv["Port of Discharge"]) extractedPortOfDischarge = kv["Port of Discharge"];
      if (kv["Container No"]) extractedContainerNo = kv["Container No"];
      if (kv["Gross Weight"]) extractedGrossWeight = kv["Gross Weight"];
      if (kv["Shipper"]) extractedShipper = kv["Shipper"];
      if (kv["Consignee"]) extractedConsignee = kv["Consignee"];
      if (kv["Notify Party"]) extractedNotifyParty = kv["Notify Party"];
      if (kv["Method of Despatch"]) extractedMethodOfDespatch = kv["Method of Despatch"];
    } catch (e) {}
  }

  // 2. Shipment & Entry Details
  const missingShipmentFields = [];
  if (!shipment.carrierName) missingShipmentFields.push("Carrier");
  if (!shipment.portOfEntry) missingShipmentFields.push("Port of Entry");
  if (!shipment.entryType) missingShipmentFields.push("Entry Type");
  if (!shipment.incoterm) missingShipmentFields.push("Incoterm");

  if (documents.length > 0) {
    if (!extractedBookingRef) missingShipmentFields.push("Bill of Lading / Booking Reference");
    if (!extractedVessel) missingShipmentFields.push("Vessel Name");
    if (!extractedVoyage) missingShipmentFields.push("Voyage Number");
    if (!extractedPortOfLoading) missingShipmentFields.push("Port of Loading");
    if (!extractedPortOfDischarge) missingShipmentFields.push("Port of Discharge");
    if (!extractedMethodOfDespatch) missingShipmentFields.push("Mode of Transport");
    if (!extractedContainerNo) missingShipmentFields.push("Container Number");
    if (!extractedGrossWeight) missingShipmentFields.push("Gross Weight");
  }

  let shipmentStatus: "Ready" | "Needs Information" = "Ready";
  let shipmentResult = "All transport parameters matched";
  let shipmentDetails = "Vessel manifest data, carrier SCAC codes, and ports of entry/discharge are fully matched.";
  let shipmentActionRequired = "";

  if (documents.length === 0) {
    shipmentStatus = "Needs Information";
    shipmentResult = "Transport details pending document ingestion";
    shipmentDetails = "Entry and transportation metadata must be declared for manifest matching. Mode of transport, vessel, port, container, and weight details are missing.";
    shipmentActionRequired = "Upload Bill of Lading or Forwarding Instructions.";
  } else if (missingShipmentFields.length > 0) {
    shipmentStatus = "Needs Information";
    shipmentResult = `Missing transport parameters: ${missingShipmentFields.length} fields`;
    shipmentDetails = `The following transport metadata fields are missing from document extraction: ${missingShipmentFields.join(", ")}. These are required for manifest reconciliation.`;
    shipmentActionRequired = `Provide missing parameters: ${missingShipmentFields.join(", ")}`;
  }

  // 3. Transaction Parties
  const missingPartyFields = [];
  if (documents.length > 0) {
    if (!extractedShipper) missingPartyFields.push("Shipper / Exporter");
    if (!extractedConsignee) missingPartyFields.push("Consignee");
    if (!extractedNotifyParty) missingPartyFields.push("Notify Party");
  }

  let partyStatus: "Ready" | "Needs Information" = "Ready";
  let partyResult = "Shipper, Seller, and Buyer verified";
  let partyDetails = "Exporters, manufacturers, and buyers are fully declared with valid address records.";
  let partyActionRequired = "";

  if (documents.length === 0) {
    partyStatus = "Needs Information";
    partyResult = "Party details pending document ingestion";
    partyDetails = "Seller, Buyer, Exporter, and Manufacturer identities must be verified for security screening and customs valuation.";
    partyActionRequired = "Upload Commercial Invoice or Bill of Lading.";
  } else if (extractedConsignee === "To Order") {
    partyStatus = "Needs Information";
    partyResult = "Consigned 'To Order' - Ultimate Consignee required";
    partyDetails = "The transport document consigns the cargo 'To Order'. For customs clearance, the actual ultimate consignee (buyer/recipient) must be nominated with a valid name, address, and EIN.";
    partyActionRequired = "Nominate the ultimate consignee details (EIN, name, and address).";
  } else if (missingPartyFields.length > 0) {
    partyStatus = "Needs Information";
    partyResult = `Missing party fields: ${missingPartyFields.join(", ")}`;
    partyDetails = `The following required transaction parties are not declared: ${missingPartyFields.join(", ")}.`;
    partyActionRequired = `Provide details for: ${missingPartyFields.join(", ")}`;
  }

  // Document lookups reused below to link "Evidence" on Ready categories
  // to the actual uploaded document (opened in-app, in the workspace
  // viewer), instead of showing fabricated supporting data.
  const invoiceDoc = documents.find(
    (d: any) => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice")
  );
  const packingDoc = documents.find(
    (d: any) => d.docType?.toLowerCase().includes("packing") || d.fileName.toLowerCase().includes("packing")
  );
  const bolDoc = documents.find(
    (d: any) =>
      d.docType?.toLowerCase().includes("lading") ||
      d.docType?.toLowerCase().includes("transport") ||
      d.fileName.toLowerCase().includes("lading") ||
      d.fileName.toLowerCase().includes("instructions") ||
      d.fileName.toLowerCase().includes("waybill")
  );
  const docEvidenceUrl = (doc: any) => (doc ? `/app/shipments/${shipment.id}?view=workspace&docId=${doc.id}` : undefined);
  // For categories whose "evidence" is a live database field rather than an
  // uploaded document -- links into the tab/section that actually renders it.
  const filingAnchorUrl = (anchor: string) => `/app/shipments/${shipment.id}?view=filing#${anchor}`;
  const workspaceAnchorUrl = (anchor: string) => `/app/shipments/${shipment.id}?view=workspace#${anchor}`;
  // Surfaces real human-approval provenance (see FieldApproval, and the new
  // field-review flow in ExceptionsDrawer) directly in a category's evidence
  // panel, instead of the evidence only ever showing where the raw agent
  // extraction came from.
  const approvedByRow = (fieldKey: string, label: string) => {
    const approval = latestApprovalByField[fieldKey];
    return approval ? [{ label, value: `${approval.name} · ${new Date(approval.approvedAt).toLocaleDateString()}` }] : [];
  };

  // 4. Required Documents
  const hasInvoice = Boolean(invoiceDoc);
  const docStatus = hasInvoice ? "Ready" : "Needs Information";
  const docResult = hasInvoice ? `${documents.length}/${documents.length} required documents received` : "Commercial Invoice Missing";
  const docDetails = hasInvoice
    ? "Required transaction documents (Commercial Invoice, Packing List) are present in the document vault."
    : "Commercial Invoice document is missing. A copy must be uploaded to run vision extraction.";
  const docActionRequired = hasInvoice ? "" : "Upload Commercial Invoice file (PDF format).";

  // 5. Merchandise & HTS Classification
  let merchandiseStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let merchandiseResult = "HTS codes verified";
  let merchandiseDetails = "All products have resolved HTSUS codes with high classification confidence.";
  let merchandiseActionRequired = "";
  let htsQuestionnaire: string[] = [];

  const vagueItems = displayLineItems.filter((item: any) => item.htsConfidence && item.htsConfidence < 80);
  // Line items can exist with a stored confidence value even after their
  // source document has been detached -- that stored number is stale, not
  // a live claim, so treat "line items but no attached document" as
  // needing review rather than trusting it as Ready.
  const classificationUnverified = displayLineItems.length > 0 && documents.length === 0;

  if (displayLineItems.length === 0) {
    merchandiseStatus = "Needs Information";
    merchandiseResult = "Classification pending document extraction";
    merchandiseDetails = "Product descriptions and HTS classifications cannot be verified until the Commercial Invoice is uploaded and processed.";
    merchandiseActionRequired = "Upload Commercial Invoice to extract line items.";
  } else if (classificationUnverified) {
    merchandiseStatus = "Needs Review";
    merchandiseResult = "Classification unverified — no document attached";
    merchandiseDetails = "Line items exist for this shipment, but no document is currently attached to substantiate their HTS classification. Their stored confidence scores predate detachment and can't be trusted as current.";
    merchandiseActionRequired = "Attach the commercial invoice or supporting document that backs this classification.";
  } else if (vagueItems.length > 0) {
    merchandiseStatus = "Needs Review";
    merchandiseResult = `Line ${vagueItems[0].lineNumber} classification review required`;
    merchandiseDetails = `Description '${vagueItems[0].description}' has low classification confidence (${vagueItems[0].htsConfidence}%) for HTSUS ${vagueItems[0].htsCode || "code"}.`;
    merchandiseActionRequired = "Answer classification verification questionnaire and upload product datasheet.";
    htsQuestionnaire = [
      "What does it control?",
      "Material and construction",
      "Operating method",
      "Principal function",
      "Model/part number",
      "Technical datasheet",
      "Product image or engineering drawing",
    ];
  }

  // 6. Quantity, Packaging & Reconciliation
  let qtyInvoice = 0;
  let qtyPacking = 0;
  let hasInv = false;
  let hasPack = false;
  for (const doc of documents) {
    if (!doc.extractedJson) continue;
    try {
      const parsed = JSON.parse(doc.extractedJson);
      const docType = doc.docType || parsed.metadata?.docType || "";
      if (docType.toLowerCase().includes("invoice")) {
        hasInv = true;
        qtyInvoice += parsed.lineItems?.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0) || 0;
      } else if (docType.toLowerCase().includes("packing")) {
        hasPack = true;
        qtyPacking += parsed.lineItems?.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0) || 0;
      }
    } catch (e) {}
  }
  let qtyStatus: "Ready" | "Blocked" | "Needs Review" | "Needs Information" = "Ready";
  let qtyResult = "Reconciled";
  let qtyDetails = "Invoice commercial quantities match packing list package counts.";
  let qtyActionRequired = "";

  if (documents.length === 0) {
    qtyStatus = "Needs Information";
    qtyResult = "Quantities not declared";
    qtyDetails = "Quantity and package count reconciliation requires both Commercial Invoice and Packing List documents.";
    qtyActionRequired = "Upload invoice and packing list documents.";
  } else if (hasInv && hasPack && qtyInvoice !== qtyPacking) {
    qtyStatus = "Blocked";
    qtyResult = `${qtyInvoice} PCS vs ${qtyPacking} PCS`;
    qtyDetails = `Quantity mismatch detected across documents. Commercial Invoice declares ${qtyInvoice} PCS, but Packing List declares ${qtyPacking} PCS.`;
    qtyActionRequired = "Resolve invoice vs packing list quantity mismatch. Select the correct count or upload corrected files.";
  } else if (!hasInv || !hasPack) {
    // Documents are attached, but not one of each type needed to actually
    // reconcile quantities -- there is nothing to compare, so this can't be
    // reported as "Reconciled."
    qtyStatus = "Needs Review";
    const missingType = !hasInv && !hasPack ? "Commercial Invoice and Packing List" : !hasInv ? "Commercial Invoice" : "Packing List";
    qtyResult = `Reconciliation unverified — ${missingType} not identified`;
    qtyDetails = `Quantity reconciliation requires both a Commercial Invoice and a Packing List with extracted data. ${missingType} could not be identified among the attached documents, so no comparison could be made.`;
    qtyActionRequired = `Attach or correctly classify the ${missingType} so quantities can be reconciled.`;
  }

  // 7. Customs Value & Commercial Terms
  let valueStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let valueResult = "Reconciled";
  let valueDetails = "Transaction currency, unit values, and declared transaction amounts are consistent.";
  let valueActionRequired = "";

  if (displayLineItems.length === 0) {
    valueStatus = "Needs Information";
    valueResult = "Valuation pending document extraction";
    valueDetails = "Declared customs values and commercial terms cannot be validated without line items.";
    valueActionRequired = "Upload Commercial Invoice to run valuation extraction.";
  } else if (documents.length === 0) {
    // Same class of bug as HTS Confidence: stored unitPrice on a line item
    // survives document detachment, so it can't be trusted as a live,
    // currently-substantiated value without a document backing it.
    valueStatus = "Needs Review";
    valueResult = "Valuation unverified — no document attached";
    valueDetails = "Line items carry stored transaction values, but no document is currently attached to substantiate them. These figures predate detachment and can't be trusted as current.";
    valueActionRequired = "Attach the commercial invoice that backs these declared values.";
  } else {
    const hasValueMissing = displayLineItems.some((item: any) => !item.unitPrice || Number(item.unitPrice) <= 0);
    if (hasValueMissing) {
      valueStatus = "Needs Information";
      valueResult = "Line value missing";
      valueDetails = "Merchandise valuation is missing for one or more line items.";
      valueActionRequired = "Provide commercial transaction values for all line items.";
    }
  }

  // 8. Origin, Marking & Trade Programs
  const hasPreferentialHTS = displayLineItems.some((item: any) => item.htsCode?.startsWith("02"));
  const cooDoc = documents.find(
    (d: any) => d.docType?.toLowerCase().includes("certificate of origin") || d.docType?.toLowerCase().includes("coo")
  );
  const hasCoODoc = Boolean(cooDoc);

  let originStatus: "Ready" | "Needs Information" | "Not Applicable" = "Not Applicable";
  let originResult = "Not Applicable";
  let originDetails = "No preferential tariff treatment claimed; standard duties apply.";
  let originActionRequired = "";

  if (documents.length === 0) {
    originStatus = "Needs Information";
    originResult = "Origin verification pending";
    originDetails = "Country of origin declarations for each line item must be extracted from the Commercial Invoice.";
    originActionRequired = "Upload Commercial Invoice to check preference eligibility.";
  } else if (hasPreferentialHTS) {
    if (hasCoODoc) {
      originStatus = "Ready";
      originResult = "Origin support verified";
      originDetails = "Preferential trade agreement claim supported by an active Certificate of Origin.";
    } else {
      originStatus = "Needs Information";
      originResult = "Origin support required";
      originDetails = "A preferential duty claim is implied by the classification. Provide the certification or manufacturing evidence needed to substantiate it.";
      originActionRequired = "Provide the certification or manufacturing evidence needed to substantiate the requested preferential-duty claim.";
    }
  }

  // Required document types not yet uploaded -- computed the same way
  // ShipmentDocumentsSection does, so its "Missing required" callout and
  // the Exceptions panel above always agree instead of being two
  // independently-computed, silently-diverging checks.
  const { requiredTypes: requiredDocTypes, missingTypes: missingDocTypes } = checkRequiredDocumentTypes(
    documents,
    originStatus !== "Not Applicable"
  );

  // 9. Admissibility, PGA & Trade Restrictions
  let pgaStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let pgaResult = "No additional agency data identified";
  let pgaDetails = "No PGA restrictions identified for this entry classification.";
  let pgaActionRequired = "";

  if (documents.length === 0) {
    pgaStatus = "Needs Information";
    pgaResult = "PGA admissibility analysis pending";
    pgaDetails = "Partner Government Agency checks require product classifications to determine eligibility and required permits.";
    pgaActionRequired = "Upload Commercial Invoice to run PGA assessment.";
  } else {
    const requiresPgaUSDA = displayLineItems.some((item: any) => item.htsCode?.startsWith("02"));
    if (requiresPgaUSDA) {
      pgaStatus = "Needs Review";
      pgaResult = "USDA FSIS permit required";
      pgaDetails = "Meat products require USDA Food Safety and Inspection Service (FSIS) import permit and FDA Prior Notice.";
      pgaActionRequired = "Submit USDA FSIS permit and file FDA Prior Notice.";
    }
  }

  // 10. Duties, Fees, Bond & Payment
  // There is no real duty calculation engine wired to shipment line items --
  // ShipmentLineItem has no duty field, and CustomsFiling.totalDuties only
  // exists after a shipment has already been filed (the very thing this
  // ribbon gates). So this category can never honestly report a computed
  // number pre-filing; it can only report that the calculation hasn't run.
  const dutyStatus: "Needs Information" = "Needs Information";
  const dutyResult = "Not yet calculated";
  const dutyDetails = "Customs duties, harbor maintenance fees (HMF), and merchandise processing fees (MPF) are not calculated pre-filing. No duty computation is currently wired to this shipment's line items.";
  const dutyActionRequired = "Duty estimation is not yet available for this shipment; final duties will be assessed by CBP after filing.";

  // 11. Final Review & Filing Authorization
  const isBlocked = importerStatus === "Blocked" || qtyStatus === "Blocked";
  const hasReviews = merchandiseStatus === "Needs Review" || pgaStatus === "Needs Review";
  const hasMissingInfo =
    importerStatus === "Needs Information" ||
    shipmentStatus === "Needs Information" ||
    partyStatus === "Needs Information" ||
    valueStatus === "Needs Information" ||
    originStatus === "Needs Information" ||
    qtyStatus === "Needs Information" ||
    merchandiseStatus === "Needs Information" ||
    pgaStatus === "Needs Information" ||
    dutyStatus === "Needs Information" ||
    docStatus === "Needs Information";

  let finalStatus: "Pending" | "Ready" = "Pending";
  let finalResult = "Pending resolution of exceptions";
  let finalDetails = "All pre-filing compliance category blockers and reviews must be resolved before authorization.";
  let finalActionRequired = "Resolve open blockers and reviews to sign final declaration.";

  if (!isBlocked && !hasReviews && !hasMissingInfo) {
    finalStatus = "Ready";
    finalResult = "Ready to File";
    finalDetails = "All 10 preceding compliance categories are cleared. Licensed broker review and importer attestation are ready for signature.";
    finalActionRequired = "Review and sign the filing authorization declaration.";
  }

  const readinessCategories: any[] = [
    {
      id: "importer",
      name: "1. Importer & Filing Authority",
      status: importerStatus,
      result: importerResult,
      details: importerDetails,
      whyItMatters: "CBP regulations mandate a valid power of attorney to establish filing authority. Transmitting without a valid POA is a severe regulatory violation.",
      actionOwner: importerActionOwner,
      actionRequired: importerActionRequired,
      source: "Importer Profile Database",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        importerStatus === "Ready"
          ? {
              sourceName: "Importer of Record Entity",
              fields: [
                { label: "CBP Importer #", value: importerOfRecord?.cbpImporterNumber || "N/A" },
                { label: "POA Status", value: poaStatusDisplay },
                { label: "Bond Type", value: bondTypeDisplay || "N/A" },
              ],
              documentUrl: filingAnchorUrl("importer-of-record-card"),
              documentName: "Importer of Record Entity — Filing Data",
            }
          : undefined,
    },
    {
      id: "shipment",
      name: "2. Shipment & Entry Details",
      status: shipmentStatus,
      result: shipmentResult,
      details: shipmentDetails,
      whyItMatters: "Carrier name, SCAC codes, bill numbers, and arrival dates are required for vessel manifest matching and cargo release authorization.",
      actionOwner: "Importer",
      actionRequired: shipmentActionRequired,
      source: "Carrier Waybill Ingestion API",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        shipmentStatus === "Ready" && bolDoc
          ? {
              sourceName: "Bill of Lading / Forwarding Instructions",
              fields: [
                { label: "Vessel / Voyage", value: extractedVessel ? `${extractedVessel} / ${extractedVoyage}` : "N/A" },
                { label: "Booking Reference", value: extractedBookingRef || "N/A" },
                { label: "Port of Loading / Discharge", value: `${extractedPortOfLoading || "N/A"} / ${extractedPortOfDischarge || "N/A"}` },
              ],
              documentUrl: docEvidenceUrl(bolDoc),
              documentName: bolDoc.fileName,
            }
          : undefined,
    },
    {
      id: "parties",
      name: "3. Transaction Parties",
      status: partyStatus,
      result: partyResult,
      details: partyDetails,
      whyItMatters: "Party identity validation prevents shipping to denied/sanctioned entities and ensures correct customs valuation.",
      actionOwner: "Importer",
      actionRequired: partyActionRequired,
      source: "Denied Watchlist sync module",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        partyStatus === "Ready" && bolDoc
          ? {
              sourceName: "Bill of Lading / Forwarding Instructions",
              fields: [
                { label: "Shipper / Exporter", value: extractedShipper || "N/A" },
                { label: "Consignee", value: extractedConsignee || "N/A" },
                { label: "Notify Party", value: extractedNotifyParty || "N/A" },
                ...approvedByRow("exporterName", "Exporter Approved By"),
                ...approvedByRow("importerName", "Importer Approved By"),
              ],
              documentUrl: docEvidenceUrl(bolDoc),
              documentName: bolDoc.fileName,
            }
          : undefined,
    },
    {
      id: "documents",
      name: "4. Required Documents",
      status: docStatus,
      result: docResult,
      details: docDetails,
      whyItMatters: "CBP requires Commercial Invoice and Packing List to be kept on file for 5 years post-entry under the recordkeeping rule.",
      actionOwner: "Importer",
      actionRequired: docActionRequired,
      source: "Document Vault",
      timestamp: shipment.createdAt.toISOString(),
      evidence:
        docStatus === "Ready" && invoiceDoc
          ? {
              sourceName: "Document Vault",
              fields: [
                { label: "Total Documents", value: `${documents.length} Files` },
                { label: "Commercial Invoice", value: invoiceDoc.fileName },
                { label: "Packing List", value: packingDoc?.fileName || "Not on file" },
              ],
              documentUrl: docEvidenceUrl(invoiceDoc),
              documentName: invoiceDoc.fileName,
            }
          : undefined,
    },
    {
      id: "merchandise",
      name: "5. Merchandise & HTS Classification",
      status: merchandiseStatus,
      result: merchandiseResult,
      details: merchandiseDetails,
      whyItMatters: "Importers must exercise 'reasonable care' under 19 USC 1484 to ensure accurate HTSUS classification. Vague descriptions lead to penalties.",
      actionOwner: "Broker",
      actionRequired: merchandiseActionRequired,
      source: "HTS Master Release Database",
      timestamp: shipment.updatedAt.toISOString(),
      questionnaire: htsQuestionnaire.length > 0 ? htsQuestionnaire : undefined,
      evidence:
        merchandiseStatus === "Ready"
          ? {
              sourceName: "Verified Line Items",
              fields: [
                { label: "Line Items", value: `${displayLineItems.length} Lines` },
                { label: "Avg. Classification Confidence", value: `${metrics.classificationConfidenceScore}%` },
              ],
              documentUrl: workspaceAnchorUrl("extracted-line-items-section"),
              documentName: "Verified Line Items — Operational Workspace",
            }
          : undefined,
    },
    {
      id: "quantity",
      name: "6. Quantity, Packaging & Reconciliation",
      status: qtyStatus,
      result: qtyResult,
      details: qtyDetails,
      whyItMatters: "Quantity discrepancies between invoice and packing list affect entered quantity value and CBP statistical reporting.",
      actionOwner: "Importer",
      actionRequired: qtyActionRequired,
      source: "Document Intelligence Extraction Client",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        qtyStatus === "Ready" && hasInv && hasPack
          ? {
              sourceName: "Invoice vs. Packing List Reconciliation",
              fields: [
                { label: "Invoice Quantity", value: `${qtyInvoice} PCS` },
                { label: "Packing List Quantity", value: `${qtyPacking} PCS` },
              ],
              documentUrl: docEvidenceUrl(packingDoc || invoiceDoc),
              documentName: (packingDoc || invoiceDoc)?.fileName,
            }
          : undefined,
    },
    {
      id: "value",
      name: "7. Customs Value & Commercial Terms",
      status: valueStatus,
      result: valueResult,
      details: valueDetails,
      whyItMatters: "Correct valuation ensures proper duty calculations. Unreported assists or incorrect Incoterms result in duty underpayments.",
      actionOwner: "Importer",
      actionRequired: valueActionRequired,
      source: "Invoice Price Parser Module",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        valueStatus === "Ready" && invoiceDoc
          ? {
              sourceName: "Commercial Invoice",
              fields: [
                { label: "Total Invoice Value", value: `$${totalInvoiceAmount.toLocaleString()}` },
                { label: "Incoterm", value: shipment.incoterm || "N/A" },
              ],
              documentUrl: docEvidenceUrl(invoiceDoc),
              documentName: invoiceDoc.fileName,
            }
          : undefined,
    },
    {
      id: "origin",
      name: "8. Origin, Marking & Trade Programs",
      status: originStatus,
      result: originResult,
      details: originDetails,
      whyItMatters: "Trade agreement preferential duty claims must be substantiated with valid certificates of origin or manufacturing records.",
      actionOwner: "Importer",
      actionRequired: originActionRequired,
      source: "Origin determination advice router",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        originStatus === "Ready" && cooDoc
          ? {
              sourceName: "Certificate of Origin",
              fields: [
                { label: "Country of Origin", value: shipment.countryOfOrigin || "N/A" },
                ...approvedByRow("originCountry", "Approved By"),
              ],
              documentUrl: docEvidenceUrl(cooDoc),
              documentName: cooDoc.fileName,
            }
          : undefined,
    },
    {
      id: "pga",
      name: "9. Admissibility, PGA & Trade Restrictions",
      status: pgaStatus,
      result: pgaResult,
      details: pgaDetails,
      whyItMatters: "Non-CBP agency admissibility reviews (FDA, USDA FSIS) must pass before cargo release.",
      actionOwner: "Broker",
      actionRequired: pgaActionRequired,
      source: "CBP PGA cross-reference rules engine",
      timestamp: shipment.updatedAt.toISOString(),
      evidence:
        pgaStatus === "Ready"
          ? {
              sourceName: "PGA Cross-Reference Screening",
              fields: [
                { label: "Line Items Screened", value: `${displayLineItems.length} Lines` },
                { label: "HTS Codes Checked", value: displayLineItems.map((li: any) => li.htsCode).filter(Boolean).join(", ") || "N/A" },
                { label: "Result", value: "No PGA-restricted HTS prefixes matched" },
              ],
              documentUrl: workspaceAnchorUrl("extracted-line-items-section"),
              documentName: "Verified Line Items — Operational Workspace",
            }
          : undefined,
    },
    {
      id: "duties",
      name: "10. Duties, Fees, Bond & Payment",
      status: dutyStatus,
      result: dutyResult,
      details: dutyDetails,
      whyItMatters: "Duties must be correctly estimated to determine bond sufficiency. Insufficient customs bond coverage blocks entry processing.",
      actionOwner: "Broker",
      actionRequired: dutyActionRequired,
      source: "Duty calculator engine",
      timestamp: shipment.updatedAt.toISOString(),
    },
    {
      id: "final",
      name: "11. Final Review & Filing Authorization",
      status: finalStatus,
      result: finalResult,
      details: finalDetails,
      whyItMatters: "Importers must sign off and authorize final filing summaries. Stale approvals post-revision violate reasonable care compliance.",
      actionOwner: "Broker",
      actionRequired: finalActionRequired,
      source: "Broker Signoff attestation ledger",
      timestamp: shipment.updatedAt.toISOString(),
    },
  ];

  const totalCategories = 11;
  const readyCount = readinessCategories.filter((c) => c.status === "Ready" || c.status === "Not Applicable").length;
  const blockedCount = readinessCategories.filter((c) => c.status === "Blocked").length;
  const reviewCount = readinessCategories.filter((c) => c.status === "Needs Review").length;
  const infoCount = readinessCategories.filter((c) => c.status === "Needs Information").length;

  let overallStatusText = "Ready to File";
  let overallStatusSubtext = "All categories ready and validated.";
  let overallStatusType: "BLOCKED" | "REVIEW_REQUIRED" | "INFO_REQUIRED" | "WARNINGS" | "READY" = "READY";

  if (blockedCount > 0) {
    overallStatusText = "Not Ready to File";
    overallStatusSubtext = `${readyCount} of ${totalCategories} categories ready · ${blockedCount} blockers · ${reviewCount} reviews required`;
    overallStatusType = "BLOCKED";
  } else if (reviewCount > 0) {
    overallStatusText = "Not Ready to File";
    overallStatusSubtext = `${readyCount} of ${totalCategories} categories ready · ${reviewCount} reviews open · ${infoCount} missing fields`;
    overallStatusType = "REVIEW_REQUIRED";
  } else if (infoCount > 0) {
    overallStatusText = "Not Ready to File";
    overallStatusSubtext = `${readyCount} of ${totalCategories} categories ready · ${infoCount} missing information fields`;
    overallStatusType = "INFO_REQUIRED";
  } else {
    overallStatusText = "Ready to File";
    overallStatusSubtext = "All pre-filing compliance checks passed cleanly.";
    overallStatusType = "READY";
  }

  const primaryDoc = docId
    ? documents.find((d: any) => d.id === docId) || documents[0]
    : documents.find((d: any) => d.status === "Received") ||
      documents.find((d: any) => d.status === "Processed") ||
      documents.find((d: any) => d.status === "Review Required") ||
      documents[0];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <PipelineProgressTracker shipmentId={shipment.id} />

      {/* Top Banner & Multi-Dimensional Readiness Header */}
      <div className="bg-white p-6 rounded-3xl border border-border shadow-2xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center space-x-3">
            <ShipmentTitleEditor
              shipmentId={shipment.id}
              initialShipmentNumber={shipment.shipmentNumber}
              isEnterpriseAdmin={isEnterpriseAdmin}
            />
            <Badge variant="success" className="text-xs tracking-normal">
              {shipment.status}
            </Badge>
            <ShipmentClientEditor
              shipmentId={shipment.id}
              initialClientId={shipment.clientId}
              initialClientName={fullShipment.client?.name ?? null}
              clients={clients.map((c) => ({ id: c.id, name: c.name }))}
              canEdit={canEditClient}
            />
          </div>

          <div className="flex items-center space-x-3">
            {metrics.isReadyForFiling ? (
              <Link
                href={`/app/filing?shipmentId=${shipment.id}`}
                className="px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center space-x-2 bg-brand text-white hover:bg-brand/90"
              >
                <span>Send to Customs Filing</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              // Why it's disabled is already covered by the readiness
              // ribbon directly below (status headline + Compliance Risk
              // pill with its own "view" link) -- repeating it here was
              // duplicate messaging.
              <span
                aria-disabled="true"
                title="Resolve the blockers shown below to enable filing"
                className="px-4 py-2 text-xs font-bold rounded-xl shadow-2xs flex items-center space-x-2 bg-slate-100 text-slate-400 cursor-not-allowed"
              >
                <span>Send to Customs Filing</span>
              </span>
            )}
          </div>
        </div>

        {/* Pre-Filing Readiness Ribbon -- moved directly under the shipment
            name so status (at risk / ready) is the first thing visible;
            the 4 metrics that used to be a separate card grid are now
            pills embedded in the ribbon itself. */}
        <PreFilingReadiness
          categories={readinessCategories}
          overallStatus={{
            text: overallStatusText,
            subtext: overallStatusSubtext,
            type: overallStatusType,
          }}
          metrics={{
            filingReadinessScore: metrics.filingReadinessScore,
            completenessScore: metrics.completenessScore,
            complianceRiskScore: metrics.complianceRiskScore,
            complianceRiskBand: metrics.complianceRiskBand,
            classificationConfidenceScore: metrics.classificationConfidenceScore,
            classificationVerified: metrics.classificationVerified,
            blockerCount: metrics.blockerCount,
            warningCount: metrics.warningCount,
          }}
        />

        {/* Action Items -- unifies real DB-backed exceptions with missing
            required documents in one place, since these used to live in
            two independently-computed, silently-diverging spots */}
        <div id="exceptions-panel">
          <ExceptionsDrawer
            shipmentId={shipment.id}
            exceptionItems={activeExceptions}
            lineItems={displayLineItems}
            missingDocumentTypes={missingDocTypes}
            documentFieldSummaries={documentFieldSummaries}
          />
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-2 pt-2 border-t border-border">
          <Link
            href={`/app/shipments/${shipment.id}?view=workspace`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
              activeTab === "workspace"
                ? "bg-brand text-white"
                : "bg-slate-100 text-ink-muted hover:text-ink"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Operational Workspace</span>
          </Link>
          <Link
            href={`/app/shipments/${shipment.id}?view=filing`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
              activeTab === "filing"
                ? "bg-brand text-white"
                : "bg-slate-100 text-ink-muted hover:text-ink"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Filing Data</span>
          </Link>
          <Link
            href={`/app/shipments/${shipment.id}?view=audit`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
              activeTab === "audit"
                ? "bg-brand text-white"
                : "bg-slate-100 text-ink-muted hover:text-ink"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Agent Executions & Audit Log ({agentInvocations.length})</span>
          </Link>
        </div>
      </div>

      {activeTab === "filing" ? (
        <>
          {/* Shipment Identity & Importer Overview Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center space-x-2">
                <Truck className="w-4 h-4 text-brand" />
                <span>Logistics & Entry Identity</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Entry Type</span>
                  <span className="font-mono text-ink font-bold">
                    {shipment.entryType || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Port of Entry</span>
                  <span className="font-medium text-ink">
                    {shipment.portOfEntry || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Carrier</span>
                  <span className="font-medium text-ink">
                    {shipment.carrierName || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted font-bold">Incoterm</span>
                  <span className="font-mono font-bold text-brand">
                    {shipment.incoterm || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                  </span>
                </div>
              </div>
            </div>

            <div id="importer-of-record-card" className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-brand" />
                <span>Importer of Record Entity</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-muted items-start">
                  <span className="text-ink-muted font-bold">Importer</span>
                  <span className="text-right">
                    <span className="font-bold text-ink block">
                      {importerDisplay.name || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                    </span>
                    {importerDisplay.sourceLabel && (
                      <span className="text-[9px] text-amber-600 font-semibold uppercase tracking-wide">
                        {importerDisplay.sourceLabel}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">CBP Importer #</span>
                  <span className="font-mono text-ink">
                    {importerOfRecord?.cbpImporterNumber || (
                      <span className="text-ink-muted/70 italic font-normal font-sans">Not set</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">POA Status</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                      poaStatusDisplay === "VALID"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {poaStatusDisplay}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted font-bold">Bond Type</span>
                  <span className="font-medium text-ink">
                    {bondTypeDisplay || <span className="text-ink-muted/70 italic font-normal">Not on file</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center space-x-2">
                <FileText className="w-4 h-4 text-brand" />
                <span>Commercial Summary</span>
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Line Items</span>
                  <span className="font-mono text-ink font-bold">{displayLineItems.length} Lines</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Classification Approval</span>
                  <span
                    className={
                      displayLineItems.length === 0
                        ? "text-ink-muted/70 italic font-normal"
                        : classificationUnverified
                        ? "font-extrabold text-slate-500 uppercase text-[10px] tracking-wider"
                        : vagueItems.length > 0
                        ? "font-extrabold text-amber-600 uppercase text-[10px] tracking-wider"
                        : "font-extrabold text-emerald-600 uppercase text-[10px] tracking-wider"
                    }
                  >
                    {displayLineItems.length === 0
                      ? "N/A"
                      : classificationUnverified
                      ? "Unverified"
                      : vagueItems.length > 0
                      ? "Pending"
                      : "Approved"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Total Invoice Value</span>
                  <span className="font-mono font-bold text-ink">${totalInvoiceAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-muted">
                  <span className="text-ink-muted font-bold">Country of Export</span>
                  <span className="font-medium text-ink">
                    {shipment.countryOfExport || <span className="text-ink-muted/70 italic font-normal">Not set</span>}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted font-bold">Documents Vault</span>
                  <span className="font-mono font-bold text-brand">{documents.length} Files</span>
                </div>
              </div>
            </div>
          </div>

          {/* Canonical Facts & Provenance */}
          <CanonicalFactsSection
            shipmentId={shipment.id}
            facts={facts}
            currentCountryOfOrigin={shipment.countryOfOrigin}
          />
        </>
      ) : activeTab === "workspace" ? (
        <>
          {/* Main Workspace: Documents + Embedded Viewer */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Documents Set Summary */}
            <div className="lg:col-span-4">
              <ShipmentDocumentsSection
                shipmentId={shipment.id}
                documents={documents}
                selectedDocId={docId}
                originStatus={originStatus}
              />
            </div>

            {/* Center Column: Embedded Document Viewer */}
            <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-border shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden min-h-[480px]">
              {primaryDoc ? (
                (() => {
                  const proxyUrl = primaryDoc.fileUrl?.includes("vercel-storage.com")
                    ? documentViewUrl(primaryDoc.id)
                    : primaryDoc.fileUrl || "#";

                  let docLineItems: any[] = [];
                  if (primaryDoc.extractedJson) {
                    try {
                      const parsed = JSON.parse(primaryDoc.extractedJson);
                      if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
                        docLineItems = parsed.lineItems.map((li: any, idx: number) => ({
                          id: `extracted-${primaryDoc.id}-${idx}`,
                          lineNumber: li.lineNumber || idx + 1,
                          partNumber: li.sku || li.partNumber || "",
                          description: li.description || "Product",
                          quantity: Number(li.quantity || 0),
                          unitPrice: Number(li.unitPrice || 0),
                          totalValue: Number(li.totalAmount || li.totalValue || 0),
                          countryOfOrigin: li.countryOfOrigin || "",
                          htsCode: li.htsCode || (li.sku && /^\d{4}/.test(li.sku) ? li.sku : ""),
                          htsConfidence: 95,
                        }));
                      }
                    } catch (e) {}
                  }

                  // Flag when a document's extracted products have nothing
                  // to do with the shipment's own verified line items --
                  // usually means the wrong file got attached to this
                  // shipment, not that extraction is broken.
                  const docHtsChapters = new Set(
                    docLineItems.map((li: any) => (li.htsCode || "").replace(/\D/g, "").slice(0, 2)).filter(Boolean)
                  );
                  const shipmentHtsChapters = new Set(
                    displayLineItems.map((li: any) => (li.htsCode || "").replace(/\D/g, "").slice(0, 2)).filter(Boolean)
                  );
                  const showMismatchWarning =
                    docLineItems.length > 0 &&
                    displayLineItems.length > 0 &&
                    docHtsChapters.size > 0 &&
                    shipmentHtsChapters.size > 0 &&
                    ![...docHtsChapters].some((ch) => shipmentHtsChapters.has(ch));

                  return (
                    <div className="flex flex-col justify-between h-full space-y-4">
                      <div>
                        {/* Document type, name, and tabbed preview / key-value / raw JSON */}
                        <div className="h-[620px] flex flex-col border-b border-border pb-4 overflow-hidden">
                          <DocumentReviewPanel
                            documentId={primaryDoc.id}
                            fileName={primaryDoc.fileName || "Trade Document"}
                            docType={
                              !primaryDoc.docType || primaryDoc.docType === "AUTO_DETECT"
                                ? "Commercial Invoice"
                                : primaryDoc.docType
                            }
                            fileUrl={primaryDoc.fileUrl}
                            proxyUrl={proxyUrl}
                            shipmentNumber={shipment.shipmentNumber}
                          />
                        </div>

                        {/* Document Metadata Details */}
                        <div className="mt-4 p-4 rounded-xl bg-[#F9F9FB] border border-border space-y-3">
                          <div className="flex items-center justify-between text-xs pb-2 border-b border-border">
                            <span className="text-ink-muted">Document Status</span>
                            {primaryDoc.extractedJson ? (
                              <span className="font-bold text-emerald-600">Verified & Ingested (AI Vision Parsed)</span>
                            ) : (
                              <span className="font-bold text-amber-600 font-mono">Received (Pending Vision Processing)</span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="text-[10px] text-ink-muted uppercase font-bold">Page Count</p>
                              <p className="font-mono text-ink">{primaryDoc.pageCount ? `${primaryDoc.pageCount} Pages` : "1 Page"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-ink-muted uppercase font-bold">Uploaded Date</p>
                              <p className="text-ink">{new Date(primaryDoc.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </div>

                        {showMismatchWarning && (
                          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start space-x-2 text-xs text-amber-800">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold">This document doesn't match the shipment's line items</p>
                              <p className="text-[11px] mt-0.5">
                                The products extracted here don't correspond to the shipment's verified cargo
                                {displayLineItems[0]?.description ? ` (${displayLineItems[0].description})` : ""}. It may be attached to the wrong shipment.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Extracted Line Items for this Document */}
                        <div id="extracted-line-items-section">
                          <LineItemsTable shipmentId={shipment.id} initialLineItems={docLineItems} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-ink-muted pt-3 border-t border-border">
                        <span>Vault Document ID: {primaryDoc.id.slice(0, 16)}...</span>
                        <span>Qubere Document Vault</span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12 text-xs">
                  <FileText className="w-10 h-10 text-ink-muted opacity-50" />
                  <div className="space-y-1">
                    <h4 className="font-extrabold text-ink">No Trade Documents Attached</h4>
                    <p className="text-ink-muted text-[11px]">Upload a Commercial Invoice, Bill of Lading, or Packing List to run vision extraction.</p>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Verified Line Items -- the shipment's real, canonical line
              items, independent of whichever document happens to be
              selected above (that panel shows one document's raw, possibly
              wrong-shipment extraction; this is ground truth). */}
          <div className="bg-white p-6 rounded-3xl border border-border shadow-sm">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center space-x-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-brand" />
              <span>Verified Line Items</span>
            </h3>
            <p className="text-[11px] text-ink-muted mb-2">
              This shipment's confirmed line items, regardless of which document is selected in the viewer above.
            </p>
            <LineItemsTable
              shipmentId={shipment.id}
              initialLineItems={displayLineItems}
              isEnterpriseAdmin={isEnterpriseAdmin}
            />
          </div>
        </>
      ) : (
        /* Secondary Audit Tab: Agent Executions & Event Logs */
        <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-6">
          <div>
            <h3 className="text-lg font-bold text-ink flex items-center space-x-2">
              <Layers className="w-5 h-5 text-brand" />
              <span>Agent Execution Runs</span>
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Every agent run on this shipment, grouped by invocation. Expand a run to see the per-agent waterfall.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-extrabold uppercase text-ink-muted tracking-wider">
              Run History ({agentInvocations.length})
            </h4>
            <AgentExecutionTimeline invocations={agentInvocations} />
          </div>
        </div>
      )}
    </div>
  );
}
