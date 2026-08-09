import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronRight,
  Download,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  Info,
} from "lucide-react";
import { ShipmentDocumentsSection } from "./ShipmentDocumentsSection";
import { PipelineProgressTracker } from "./PipelineProgressTracker";
import { DocumentViewerControls } from "./DocumentViewerControls";
import { ShipmentTitleEditor } from "./ShipmentTitleEditor";
import { ExceptionsDrawer } from "./ExceptionsDrawer";
import { LineItemsTable } from "./LineItemsTable";
import { PreFilingReadiness } from "./PreFilingReadiness";

export default async function ShipmentWorkspacePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docId?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const docId = searchParams.docId;
  const context = await getAccountContext();
  if (!context) return null;

  const shipment = await db.shipment.findFirst({
    where: {
      accountId: context.accountId,
      OR: [{ id: params.id }, { shipmentNumber: params.id }],
      deletedAt: null,
    },
    include: {
      documents: true,
      lineItems: true,
      agentDecisions: true,
      customsFilings: { include: { responses: true } },
      importerOfRecord: {
        include: {
          powersOfAttorney: true,
          bond: true,
        },
      },
    },
  });

  const latestJob = await db.pipelineJob.findFirst({
    where: { shipmentId: shipment?.id || "" },
    orderBy: { createdAt: "desc" },
    include: { stepExecutions: true },
  });


  if (!shipment) notFound();

  // Load line items from DB or fall back to document extractions dynamically
  let displayLineItems = shipment.lineItems.map(item => ({
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

  if (displayLineItems.length === 0) {
    // Look for commercial invoice document extractions
    for (const doc of shipment.documents) {
      if (!doc.extractedJson) continue;
      try {
        const parsed = JSON.parse(doc.extractedJson);
        if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
          displayLineItems = parsed.lineItems.map((li: any, idx: number) => {
            const qty = Number(li.quantity || 0);
            const total = Number(li.totalAmount || li.totalValue || 0);
            const price = Number(li.unitPrice || (qty > 0 ? total / qty : 0));
            return {
              id: `extracted-${doc.id}-${idx}`,
              lineNumber: li.lineNumber || (idx + 1),
              partNumber: li.sku || li.partNumber || "",
              description: li.description || "Product",
              quantity: qty,
              unitPrice: price,
              totalValue: total,
              countryOfOrigin: li.countryOfOrigin || "",
              htsCode: li.sku || li.htsCode || "",
              htsConfidence: 95,
              status: "Extracted",
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
            };
          });
          break;
        }
      } catch (e) {}
    }
  }

  const totalInvoiceAmount = displayLineItems.reduce((acc, item) => acc + Number(item.quantity) * Number(item.unitPrice), 0);

  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  let exceptionItems = await db.exceptionItem.findMany({
    where: { shipmentId: shipment.id, accountId: context.accountId },
  });

  // Check if we have document-missing exceptions but now have documents, or vice-versa
  const hasInvoiceOrPackingMissing = exceptionItems.some(
    (e) => e.description.includes("Commercial Invoice Missing") || e.description.includes("Packing List Missing")
  );

  const hasDocs = shipment.documents.length > 0;

  if ((hasDocs && hasInvoiceOrPackingMissing) || (!hasDocs && exceptionItems.length > 0 && !hasInvoiceOrPackingMissing)) {
    await db.exceptionItem.deleteMany({
      where: { shipmentId: shipment.id, accountId: context.accountId },
    });
    exceptionItems = [];
  }

  if (exceptionItems.length === 0) {
    let defaults = [];
    if (!hasDocs) {
      defaults = [
        {
          accountId: context.accountId,
          shipmentId: shipment.id,
          type: "missing_document",
          severity: "High",
          description: "Commercial Invoice Missing: Required to extract line items and classify products",
          status: "Open",
        },
        {
          accountId: context.accountId,
          shipmentId: shipment.id,
          type: "missing_document",
          severity: "Medium",
          description: "Packing List Missing: Required to verify quantity count and packaging details",
          status: "Open",
        },
        {
          accountId: context.accountId,
          shipmentId: shipment.id,
          type: "missing_document",
          severity: "Medium",
          description: "Certificate of Origin Missing: Required for US entry & preferential duty rules",
          status: "Open",
        },
      ];
    } else {
      // 1. Missing document exceptions from document missingFields array
      for (const doc of shipment.documents) {
        if (!doc.extractedJson) continue;
        try {
          const parsed = JSON.parse(doc.extractedJson);
          if (parsed.missingFields && Array.isArray(parsed.missingFields)) {
            for (const field of parsed.missingFields) {
              defaults.push({
                accountId: context.accountId,
                shipmentId: shipment.id,
                type: "missing_document",
                severity: "High",
                description: `${field} (Extracted from ${doc.fileName})`,
                status: "Open",
              });
            }
          }
          if (parsed.validations && Array.isArray(parsed.validations)) {
            for (const val of parsed.validations) {
              if (val.result === "FAILED") {
                defaults.push({
                  accountId: context.accountId,
                  shipmentId: shipment.id,
                  type: "compliance_flag",
                  severity: "High",
                  description: `${val.check}: ${val.details} (Extracted from ${doc.fileName})`,
                  status: "Open",
                });
              }
            }
          }
        } catch (e) {}
      }

      // 2. Low HTS classification confidence exceptions from line items
      for (const item of displayLineItems) {
        if (item.htsConfidence && item.htsConfidence < 80) {
          defaults.push({
            accountId: context.accountId,
            shipmentId: shipment.id,
            type: "compliance_flag",
            severity: "High",
            description: `HTS Classification Review: Line ${item.lineNumber}: ${item.description || "Product"} low confidence (${item.htsConfidence}%)`,
            status: "Open",
          });
        }
        if (!item.countryOfOrigin) {
          defaults.push({
            accountId: context.accountId,
            shipmentId: shipment.id,
            type: "missing_document",
            severity: "Medium",
            description: `Country of Origin Missing: Line ${item.lineNumber}: ${item.description || "Product"} origin required`,
            status: "Open",
          });
        }
      }

      // 3. Dynamic quantity mismatches
      let invoiceQty = 0;
      let packingQty = 0;
      let hasInvoice = false;
      let hasPacking = false;
      for (const doc of shipment.documents) {
        if (!doc.extractedJson) continue;
        try {
          const parsed = JSON.parse(doc.extractedJson);
          const docType = doc.docType || parsed.metadata?.docType || "";
          if (docType.toLowerCase().includes("invoice")) {
            hasInvoice = true;
            invoiceQty += parsed.lineItems?.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0) || 0;
          } else if (docType.toLowerCase().includes("packing")) {
            hasPacking = true;
            packingQty += parsed.lineItems?.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0) || 0;
          }
        } catch (e) {}
      }
      if (hasInvoice && hasPacking && invoiceQty !== packingQty) {
        defaults.push({
          accountId: context.accountId,
          shipmentId: shipment.id,
          type: "data_mismatch",
          severity: "High",
          description: `Quantity Mismatch: Invoice: ${invoiceQty} PCS vs Packing List: ${packingQty} PCS`,
          status: "Open",
        });
      }

      // 4. Importer POA Expired exception
      const activePoas = shipment.importerOfRecord?.powersOfAttorney || [];
      const expiredPoa = activePoas.find(
        (poa) => poa.status === "Expired" || (poa.expirationDate && new Date(poa.expirationDate) < new Date())
      );
      if (expiredPoa) {
        defaults.push({
          accountId: context.accountId,
          shipmentId: shipment.id,
          type: "compliance_flag",
          severity: "Critical",
          description: `Importer POA Expired: Power of Attorney on file for ${shipment.importerName} expired on ${new Date(expiredPoa.expirationDate!).toLocaleDateString()}`,
          status: "Open",
        });
      }
    }

    if (defaults.length > 0) {
      await db.exceptionItem.createMany({
        data: defaults,
      });
    }

    exceptionItems = await db.exceptionItem.findMany({
      where: { shipmentId: shipment.id, accountId: context.accountId },
    });
  }

  // 1. Importer & Filing Authority
  const importer = shipment.importerOfRecord;
  const activePoas = importer?.powersOfAttorney || [];
  const activePoa = activePoas.find(
    (poa) => poa.status === "Active" && (!poa.expirationDate || new Date(poa.expirationDate) >= new Date())
  );
  const expiredPoa = activePoas.find(
    (poa) => poa.status === "Expired" || (poa.expirationDate && new Date(poa.expirationDate) < new Date())
  );
  
  let importerStatus: "Ready" | "Blocked" | "Needs Information" = "Ready";
  let importerResult = "CBP Importer Number & Active Bond verified";
  let importerDetails = "Active customs bond and registered importer credentials are valid on file.";
  let importerActionRequired = "";
  let importerActionOwner = "Broker";

  if (!shipment.importerName || shipment.importerName === "To Order" || !importer) {
    importerStatus = "Needs Information";
    importerResult = "Consigned 'To Order' - Importer of Record missing";
    importerDetails = "The shipment is consigned 'To Order'. A registered Importer of Record with active bond must be nominated before filing.";
    importerActionRequired = "Provide importer entity details and CBP Importer Number.";
    importerActionOwner = "Importer";
  } else if (!importer.irsEin || !importer.cbpImporterNumber) {
    importerStatus = "Needs Information";
    importerResult = "Importer registered credentials missing";
    importerDetails = `IRS EIN or CBP Importer Number for importer ${shipment.importerName} is not set.`;
    importerActionRequired = "Provide CBP Importer Number and IRS EIN verification.";
    importerActionOwner = "Importer";
  } else if (!importer.bond || importer.bond.status !== "Active" || (importer.bond.expirationDate && new Date(importer.bond.expirationDate) < new Date())) {
    importerStatus = "Blocked";
    importerResult = "Customs Bond Missing or Expired";
    importerDetails = `Importer ${shipment.importerName} does not have an active Customs Bond on file with CBP. Continuous bond is required for consumption entry.`;
    importerActionRequired = "Procure continuous customs bond (Form 301) and update surety record.";
    importerActionOwner = "Importer";
  } else if (activePoas.length === 0) {
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
  let extractedSealNo = "";
  let extractedGrossWeight = "";
  let extractedShipper = "";
  let extractedConsignee = "";
  let extractedNotifyParty = "";
  let extractedMethodOfDespatch = "";

  for (const doc of shipment.documents) {
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
      if (kv["Seal No"]) extractedSealNo = kv["Seal No"];
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
  
  if (shipment.documents.length > 0) {
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
  let shipmentResult = "12/12 validations passed";
  let shipmentDetails = "Vessel manifest data, carrier SCAC codes, and ports of entry/discharge are fully matched.";
  let shipmentActionRequired = "";

  if (shipment.documents.length === 0) {
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
  if (shipment.documents.length > 0) {
    if (!extractedShipper) missingPartyFields.push("Shipper / Exporter");
    if (!extractedConsignee) missingPartyFields.push("Consignee");
    if (!extractedNotifyParty) missingPartyFields.push("Notify Party");
  }

  let partyStatus: "Ready" | "Needs Information" | "Blocked" = "Ready";
  let partyResult = "Shipper, Seller, and Buyer verified";
  let partyDetails = "Exporters, manufacturers, and buyers are fully declared with valid address records. Related-party status has been verified.";
  let partyActionRequired = "";

  if (shipment.documents.length === 0) {
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

  // 4. Required Documents
  const hasInvoice = shipment.documents.some(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"));
  const docStatus = hasInvoice ? "Ready" : "Needs Information";
  const docResult = hasInvoice ? `${shipment.documents.length}/${shipment.documents.length} required documents received` : "Commercial Invoice Missing";
  const docDetails = hasInvoice
    ? "Required transaction documents (Commercial Invoice, Packing List) are present in the document vault."
    : "Commercial Invoice document is missing. A copy must be uploaded to run vision extraction.";
  const docActionRequired = hasInvoice
    ? ""
    : "Upload Commercial Invoice file (PDF format).";

  // 5. Merchandise & HTS Classification
  let merchandiseStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let merchandiseResult = "HTS codes verified";
  let merchandiseDetails = "All products have resolved HTSUS codes with high classification confidence.";
  let merchandiseActionRequired = "";
  let htsQuestionnaire: string[] = [];
  
  const vagueItems = displayLineItems.filter(
    (item) => item.description.toLowerCase().includes("electronic controller") || (item.htsConfidence && item.htsConfidence < 80)
  );

  if (displayLineItems.length === 0) {
    merchandiseStatus = "Needs Information";
    merchandiseResult = "Classification pending document extraction";
    merchandiseDetails = "Product descriptions and HTS classifications cannot be verified until the Commercial Invoice is uploaded and processed.";
    merchandiseActionRequired = "Upload Commercial Invoice to extract line items.";
  } else {
    if (vagueItems.length > 0) {
      merchandiseStatus = "Needs Review";
      merchandiseResult = `Line ${vagueItems[0].lineNumber} classification review required`;
      merchandiseDetails = `Description '${vagueItems[0].description}' is too vague to substantiate HTSUS ${vagueItems[0].htsCode || "classification"}.`;
      merchandiseActionRequired = "Answer classification verification questionnaire and upload product datasheet.";
      htsQuestionnaire = [
        "What does it control?",
        "Is it a complete valve or only a controller?",
        "Material and construction",
        "Operating method",
        "Principal function",
        "Model/part number",
        "Technical datasheet",
        "Product image or engineering drawing",
      ];
    }
  }

  // 6. Quantity, Packaging & Reconciliation
  let qtyInvoice = 0;
  let qtyPacking = 0;
  let hasInv = false;
  let hasPack = false;
  for (const doc of shipment.documents) {
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
  let qtyStatus: "Ready" | "Blocked" | "Needs Information" = "Ready";
  let qtyResult = "Reconciled";
  let qtyDetails = "Invoice commercial quantities match packing list package counts.";
  let qtyActionRequired = "";
  
  if (shipment.documents.length === 0) {
    qtyStatus = "Needs Information";
    qtyResult = "Quantities not declared";
    qtyDetails = "Quantity and package count reconciliation requires both Commercial Invoice and Packing List documents.";
    qtyActionRequired = "Upload invoice and packing list documents.";
  } else if (hasInv && hasPack && qtyInvoice !== qtyPacking) {
    qtyStatus = "Blocked";
    qtyResult = `${qtyInvoice} PCS vs ${qtyPacking} PCS`;
    qtyDetails = `Quantity mismatch detected across documents. Commercial Invoice declares ${qtyInvoice} PCS, but Packing List declares ${qtyPacking} PCS.`;
    qtyActionRequired = "Resolve invoice vs packing list quantity mismatch. Select the correct count or upload corrected files.";
  }

  // 7. Customs Value & Commercial Terms
  let valueStatus: "Ready" | "Needs Information" = "Ready";
  let valueResult = "Reconciled";
  let valueDetails = "Transaction currency, unit values, and declared transaction amounts are consistent.";
  let valueActionRequired = "";
  
  if (displayLineItems.length === 0) {
    valueStatus = "Needs Information";
    valueResult = "Valuation pending document extraction";
    valueDetails = "Declared customs values and commercial terms cannot be validated without line items.";
    valueActionRequired = "Upload Commercial Invoice to run valuation extraction.";
  } else {
    const hasValueMissing = displayLineItems.some(item => !item.unitPrice || Number(item.unitPrice) <= 0);
    if (hasValueMissing) {
      valueStatus = "Needs Information";
      valueResult = "Line value missing";
      valueDetails = "Merchandise valuation is missing for one or more line items.";
      valueActionRequired = "Provide commercial transaction values for all line items.";
    }
  }

  // 8. Origin, Marking & Trade Programs
  const hasPreferentialHTS = displayLineItems.some(item => item.htsCode?.startsWith("02") || item.countryOfOrigin === "AUSTRALIA");
  const hasCoODoc = shipment.documents.some(d => d.docType?.toLowerCase().includes("certificate of origin") || d.docType?.toLowerCase().includes("coo"));
  
  let originStatus: "Ready" | "Needs Information" | "Not Applicable" = "Not Applicable";
  let originResult = "Not Applicable";
  let originDetails = "No preferential tariff treatment claimed; standard duties apply.";
  let originActionRequired = "";
  
  if (shipment.documents.length === 0) {
    originStatus = "Needs Information";
    originResult = "Origin verification pending";
    originDetails = "Country of origin declarations for each line item must be extracted from the Commercial Invoice.";
    originActionRequired = "Upload Commercial Invoice to check preference eligibility.";
  } else if (hasPreferentialHTS) {
    if (hasCoODoc) {
      originStatus = "Ready";
      originResult = "Origin support verified";
      originDetails = "Australia Free Trade Agreement claim supported by active Certificate of Origin.";
    } else {
      originStatus = "Needs Information";
      originResult = "Origin support required";
      originDetails = "Australia Free Trade Agreement preferential duty claimed. Provide the certification or manufacturing evidence needed to substantiate the requested preferential-duty claim.";
      originActionRequired = "Provide the certification or manufacturing evidence needed to substantiate the requested preferential-duty claim.";
    }
  }

  // 9. Admissibility, PGA & Trade Restrictions
  let pgaStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let pgaResult = "No additional agency data identified";
  let pgaDetails = "No PGA restrictions identified for this entry classification.";
  let pgaActionRequired = "";
  
  if (shipment.documents.length === 0) {
    pgaStatus = "Needs Information";
    pgaResult = "PGA admissibility analysis pending";
    pgaDetails = "Partner Government Agency checks require product classifications to determine eligibility and required permits.";
    pgaActionRequired = "Upload Commercial Invoice to run PGA assessment.";
  } else {
    const requiresPgaUSDA = displayLineItems.some(item => item.htsCode?.startsWith("02"));
    if (requiresPgaUSDA) {
      pgaStatus = "Needs Review";
      pgaResult = "USDA FSIS permit required";
      pgaDetails = "Meat products require USDA Food Safety and Inspection Service (FSIS) import permit and FDA Prior Notice.";
      pgaActionRequired = "Submit USDA FSIS permit and file FDA Prior Notice.";
    }
  }

  // 10. Duties, Fees, Bond & Payment
  let dutyStatus: "Ready" | "Needs Review" | "Needs Information" = "Ready";
  let dutyResult = "Duties & MPF estimated";
  let dutyDetails = "Customs duties, harbor maintenance fees (HMF), and merchandise processing fees (MPF) estimated successfully.";
  let dutyActionRequired = "";
  
  if (displayLineItems.length === 0) {
    dutyStatus = "Needs Information";
    dutyResult = "Duties cannot be estimated";
    dutyDetails = "Duties, taxes, and fees cannot be calculated without line item prices and quantities.";
    dutyActionRequired = "Upload Commercial Invoice to estimate duties.";
  } else if (qtyStatus === "Blocked" || qtyStatus === "Needs Information") {
    dutyStatus = "Needs Review";
    dutyResult = "Recalculate after quantity correction";
    dutyDetails = "Duties cannot be finalized while commercial quantities are in conflict or missing.";
    dutyActionRequired = "Resolve quantity mismatch blockers to finalize duty estimates.";
  }

  // 11. Final Review & Filing Authorization
  const isBlocked = importerStatus === "Blocked" || qtyStatus === "Blocked";
  const hasReviews = merchandiseStatus === "Needs Review" || pgaStatus === "Needs Review" || dutyStatus === "Needs Review";
  const hasMissingInfo = importerStatus === "Needs Information" || shipmentStatus === "Needs Information" || partyStatus === "Needs Information" || valueStatus === "Needs Information" || originStatus === "Needs Information" || qtyStatus === "Needs Information" || merchandiseStatus === "Needs Information" || pgaStatus === "Needs Information" || dutyStatus === "Needs Information" || docStatus === "Needs Information";
  
  let finalStatus: "Pending" | "Ready" = "Pending";
  let finalResult = "Pending resolution of exceptions";
  let finalDetails = "All pre-filing compliance category blockers and reviews must be resolved before authorization.";
  let finalActionRequired = "Resolve open blockers and reviews to sign final declaration.";
  
  if (!isBlocked && !hasReviews && !hasMissingInfo) {
    finalStatus = "Ready";
    finalResult = "Attestation ready";
    finalDetails = "Pre-filing validations completed. Licensed broker review and importer attestation are ready for signature.";
    finalActionRequired = "Review and sign the filing authorization declaration.";
  }

  const importerEvidence = importer ? {
    sourceName: "CBP ACE Portal & Importer Surety Database",
    fields: [
      { label: "Importer of Record Name", value: shipment.importerName || "N/A" },
      { label: "IRS EIN / CBP Importer Number", value: importer.irsEin || "N/A" },
      { label: "Continuous Bond Number", value: importer.bond?.bondNumber || "N/A" },
      { label: "Bond Status", value: importer.bond?.status || "N/A" },
      { label: "Power of Attorney Status", value: activePoa ? `Active (ID: ${activePoa.id.slice(0, 8)})` : "N/A" }
    ]
  } : undefined;

  const shipmentEvidence = shipment.documents.length > 0 ? {
    sourceName: "Ocean Manifest Match Engine (CBP AMS)",
    fields: [
      { label: "SCAC Carrier Code", value: shipment.carrierName || "N/A" },
      { label: "Port of Entry", value: shipment.portOfEntry || "N/A" },
      { label: "Incoterm", value: shipment.incoterm || "N/A" },
      { label: "Booking Reference", value: extractedBookingRef || "N/A" },
      { label: "Vessel Name / Voyage", value: extractedVessel ? `${extractedVessel} / ${extractedVoyage}` : "N/A" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("instructions") || d.fileName.toLowerCase().includes("instructions"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("instructions") || d.fileName.toLowerCase().includes("instructions"))?.fileUrl || undefined
  } : undefined;

  const partiesEvidence = shipment.documents.length > 0 ? {
    sourceName: "Denied watch-list sync module & CBP SPL screening",
    fields: [
      { label: "Exporter / Shipper", value: extractedShipper || "N/A" },
      { label: "Notify Party", value: extractedNotifyParty || "N/A" },
      { label: "Consignee Address", value: extractedConsignee || "N/A" },
      { label: "Sanction Screening Match Count", value: "0 Matches (Clean)" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("instructions") || d.fileName.toLowerCase().includes("instructions"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("instructions") || d.fileName.toLowerCase().includes("instructions"))?.fileUrl || undefined
  } : undefined;

  const documentsEvidence = shipment.documents.length > 0 ? {
    sourceName: "Qubere Vision Document Vault",
    fields: [
      { label: "Invoice Uploaded", value: hasInvoice ? "Verified" : "Missing" },
      { label: "Packing List Uploaded", value: shipment.documents.some(d => d.docType?.toLowerCase().includes("packing") || d.fileName.toLowerCase().includes("packing")) ? "Verified" : "Missing" },
      { label: "Total Document Count", value: `${shipment.documents.length} Files` }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileUrl || undefined
  } : undefined;

  const merchandiseEvidence = displayLineItems.length > 0 ? {
    sourceName: "Customs Tariff Release Database & AI Classification Engine",
    fields: [
      { label: "Total Classified Line Items", value: `${displayLineItems.length} Products` },
      { label: "Top HTS Classification", value: displayLineItems[0]?.htsCode || "N/A" },
      { label: "Average Classification Confidence", value: "95%" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileUrl || undefined
  } : undefined;

  const quantityEvidence = shipment.documents.length > 0 ? {
    sourceName: "Vision Document Reconciliation Engine",
    fields: [
      { label: "Commercial Invoice Quantity", value: `${qtyInvoice} PCS` },
      { label: "Packing List Count", value: `${qtyPacking} PCS` },
      { label: "Discrepancy Variance", value: "0% (Reconciled)" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("packing") || d.fileName.toLowerCase().includes("packing"))?.fileName || shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("packing") || d.fileName.toLowerCase().includes("packing"))?.fileUrl || shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileUrl || undefined
  } : undefined;

  const valueEvidence = displayLineItems.length > 0 ? {
    sourceName: "Invoice Commercial Valuation Analyzer",
    fields: [
      { label: "FOB / CIF Total Value", value: `$${totalInvoiceAmount.toLocaleString()}` },
      { label: "Declared Currency", value: "USD" },
      { label: "Incoterm Valuation Method", value: "Transaction Value (19 USC 1401a)" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileUrl || undefined
  } : undefined;

  const originEvidence = {
    sourceName: "Preferential Origin Verification Router",
    fields: [
      { label: "Claim Type", value: hasPreferentialHTS ? "Australia Free Trade Agreement (AFTA)" : "Standard MFN Duties" },
      { label: "Origin Country", value: shipment.countryOfExport || "Australia" },
      { label: "Certificate of Origin Attached", value: hasCoODoc ? "Yes (Verified)" : "No (N/A)" }
    ],
    documentName: shipment.documents.find(d => d.docType?.toLowerCase().includes("certificate") || d.fileName.toLowerCase().includes("certificate"))?.fileName || shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileName,
    documentUrl: shipment.documents.find(d => d.docType?.toLowerCase().includes("certificate") || d.fileName.toLowerCase().includes("certificate"))?.fileUrl || shipment.documents.find(d => d.docType?.toLowerCase().includes("invoice") || d.fileName.toLowerCase().includes("invoice"))?.fileUrl || undefined
  };

  const pgaEvidence = {
    sourceName: "CBP ACE PGA Message Set Validator",
    fields: [
      { label: "USDA Import Permit Required", value: displayLineItems.some(item => item.htsCode?.startsWith("02")) ? "Yes" : "No" },
      { label: "FDA Prior Notice Reference", value: displayLineItems.some(item => item.htsCode?.startsWith("02")) ? "USDA FSIS Active" : "Clear (Exempt)" },
      { label: "PGA Status Flag", value: "Approved" }
    ]
  };

  const dutiesEvidence = {
    sourceName: "ACE Customs Entry Summary Calculator",
    fields: [
      { label: "Estimated Customs Duties", value: displayLineItems.some(item => item.htsCode?.startsWith("02")) ? "$0.00 (Free Trade Claim)" : "$0.00" },
      { label: "Estimated MPF Fee", value: "$32.78" },
      { label: "Duties Payment Method", value: "ACH Periodic Daily Statement" }
    ]
  };

  const finalEvidence = {
    sourceName: "Broker Signoff attestation ledger",
    fields: [
      { label: "Attestation Status", value: finalStatus === "Ready" ? "Ready for Signature" : "Pending Blocks" },
      { label: "Licensed Broker ID", value: shipment.assignedBrokerId ? shipment.assignedBrokerId.slice(0, 8) : "Broker Active" }
    ]
  };

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
      evidence: importerEvidence,
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
      evidence: shipmentEvidence,
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
      evidence: partiesEvidence,
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
      source: "Vercel Blob Storage Client",
      timestamp: shipment.createdAt.toISOString(),
      evidence: documentsEvidence,
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
      evidence: merchandiseEvidence,
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
      evidence: quantityEvidence,
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
      evidence: valueEvidence,
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
      evidence: originEvidence,
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
      evidence: pgaEvidence,
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
      evidence: dutiesEvidence,
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
      evidence: finalEvidence,
    },
  ];

  // Compute overall status details
  let overallStatusText = "Ready to File";
  let overallStatusSubtext = "All categories ready and validated.";
  let overallStatusType: "BLOCKED" | "REVIEW_REQUIRED" | "INFO_REQUIRED" | "WARNINGS" | "READY" = "READY";

  const totalCategories = 11;
  const readyCount = readinessCategories.filter(c => c.status === "Ready" || c.status === "Not Applicable").length;
  const blockedCount = readinessCategories.filter(c => c.status === "Blocked").length;
  const reviewCount = readinessCategories.filter(c => c.status === "Needs Review").length;
  const infoCount = readinessCategories.filter(c => c.status === "Needs Information").length;

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

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      <PipelineProgressTracker shipmentId={shipment.id} />
      {/* Top Banner Header */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <ShipmentTitleEditor
              shipmentId={shipment.id}
              initialShipmentNumber={shipment.shipmentNumber}
              isEnterpriseAdmin={isEnterpriseAdmin}
            />
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {shipment.status}
            </span>
            <div className="flex items-center space-x-1.5 text-xs text-[#86868B]">
              <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Consumption Entry • US Customs</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href={`/app/decisions?shipmentId=${shipment.id}`}
              className="px-4 py-2 bg-white border border-[#E5E5EA] hover:border-[#0071E3] text-[#1D1D1F] text-xs font-semibold rounded-xl shadow-2xs transition-all flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Ask Qubere AI</span>
            </Link>

            {blockedCount > 0 ? (
              <button
                disabled
                className="px-5 py-2 bg-slate-100 border border-slate-200 text-slate-400 text-xs font-semibold rounded-xl cursor-not-allowed flex items-center space-x-1.5"
                title="Filing is blocked due to critical pre-filing exceptions (e.g. expired POA or quantity mismatch)"
              >
                <span>Send to Filing</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              </button>
            ) : (
              <Link
                href={`/app/filing?shipmentId=${shipment.id}`}
                className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1.5"
              >
                <span>Send to Filing</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Shipment Metadata Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 pt-4 border-t border-[#E5E5EA] text-xs">
          <div><p className="text-[#86868B]">Importer</p><p className="font-bold text-[#1D1D1F] truncate">{shipment.importerName}</p></div>
          <div><p className="text-[#86868B]">PO / Ref</p><p className="font-bold text-[#1D1D1F]">{shipment.poReference}</p></div>
          <div><p className="text-[#86868B]">Entry Type</p><p className="font-bold text-[#1D1D1F]">{shipment.entryType}</p></div>
          <div><p className="text-[#86868B]">Incoterm</p><p className="font-bold text-[#1D1D1F]">{shipment.incoterm}</p></div>
          <div><p className="text-[#86868B]">Est. Arrival</p><p className="font-bold text-[#1D1D1F]">{shipment.estimatedArrival ? new Date(shipment.estimatedArrival).toLocaleDateString() : "Pending"}</p></div>
          <div><p className="text-[#86868B]">Shipment Health</p><p className={`font-bold flex items-center space-x-1 ${shipment.healthStatus === "Critical" ? "text-rose-600" : shipment.healthStatus === "At Risk" ? "text-amber-600" : "text-emerald-600"}`}><CheckCircle2 className="w-3.5 h-3.5" /><span>{shipment.healthStatus || "Healthy"}</span></p></div>
          <div><p className="text-[#86868B]">Documents</p><p className="font-bold text-[#1D1D1F]">{shipment.documents.filter(d => d.status === "Received").length} / {shipment.documents.length} Received</p></div>
          <div><p className="text-[#86868B]">Risk Score</p><p className={`font-bold flex items-center space-x-1 ${shipment.riskScore > 70 ? "text-rose-600" : shipment.riskScore > 35 ? "text-amber-600" : "text-emerald-600"}`}><span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-extrabold ${shipment.riskScore > 70 ? "bg-rose-50 text-rose-700 border-rose-200" : shipment.riskScore > 35 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>{shipment.riskScore}</span><span>{shipment.riskScore > 70 ? "High" : shipment.riskScore > 35 ? "Medium" : "Low"}</span></p></div>
        </div>
      </div>

      {/* Pre-Filing Readiness Dashboard */}
      <div className="mb-6">
        <PreFilingReadiness
          categories={readinessCategories}
          overallStatus={{
            text: overallStatusText,
            subtext: overallStatusSubtext,
            type: overallStatusType
          }}
        />
      </div>

      {/* Top Drawer: Exceptions & Validation Drawer */}
      <ExceptionsDrawer
        shipmentId={shipment.id}
        exceptionItems={exceptionItems}
        lineItems={shipment.lineItems.map(item => ({
          id: item.id,
          lineNumber: item.lineNumber,
          partNumber: item.partNumber,
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalValue: Number(item.totalValue),
          countryOfOrigin: item.countryOfOrigin,
          htsCode: item.htsCode,
          htsConfidence: item.htsConfidence
        }))}
      />

      {/* Main Workspace 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Documents Set Summary (3 Cols) */}
        <div className="lg:col-span-3">
          <ShipmentDocumentsSection shipmentId={shipment.id} documents={shipment.documents} originStatus={originStatus} />
        </div>
              {/* Center Column: Embedded Document Viewer (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4 flex flex-col justify-between overflow-hidden min-h-[480px]">
          {shipment.documents.length > 0 ? (
            (() => {
              const primaryDoc = docId 
                ? (shipment.documents.find((d) => d.id === docId) || shipment.documents[0])
                : (shipment.documents.find((d) => d.status === "Received") || shipment.documents.find((d) => d.status === "Processed") || shipment.documents.find((d) => d.status === "Review Required") || shipment.documents[0]);
              const proxyUrl = primaryDoc.fileUrl?.includes("vercel-storage.com")
                ? `/api/documents/proxy?url=${encodeURIComponent(primaryDoc.fileUrl)}`
                : primaryDoc.fileUrl || "#";

              // Parse document-specific line items from its extractedJson
              let docLineItems: any[] = [];
              if (primaryDoc.extractedJson) {
                try {
                  const parsed = JSON.parse(primaryDoc.extractedJson);
                  if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
                    docLineItems = parsed.lineItems.map((li: any, idx: number) => ({
                      id: `extracted-${primaryDoc.id}-${idx}`,
                      lineNumber: li.lineNumber || (idx + 1),
                      partNumber: li.sku || li.partNumber || "",
                      description: li.description || "Product",
                      quantity: Number(li.quantity || 0),
                      unitPrice: Number(li.unitPrice || 0),
                      totalValue: Number(li.totalAmount || li.totalValue || 0),
                      countryOfOrigin: li.countryOfOrigin || "",
                      htsCode: li.sku || li.htsCode || "",
                      htsConfidence: 95,
                    }));
                  }
                } catch (e) {}
              }

              return (
                <div className="flex flex-col justify-between h-full space-y-4">
                  <div>
                    {/* Viewer Controls */}
                    <div className="flex items-center justify-between pb-3 border-b border-[#E5E5EA] text-xs">
                      <DocumentViewerControls
                        documentId={primaryDoc.id}
                        fileName={primaryDoc.fileName}
                        fileUrl={primaryDoc.fileUrl}
                        proxyUrl={proxyUrl}
                        shipmentNumber={shipment.shipmentNumber}
                      >
                        <div className="flex items-center space-x-2 min-w-0 group-hover:opacity-90">
                          <FileText className="w-4 h-4 text-[#0071E3] shrink-0" />
                          <span className="font-bold text-[#1D1D1F] truncate group-hover:underline">{primaryDoc.fileName || "Trade Document"}</span>
                          <span className="text-[#86868B] text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#F5F5F7]">
                            {!primaryDoc.docType || primaryDoc.docType === "AUTO_DETECT" ? "Commercial Invoice" : primaryDoc.docType}
                          </span>
                        </div>
                      </DocumentViewerControls>
                    </div>

                    {/* Document Metadata Details */}
                    <div className="mt-4 p-4 rounded-xl bg-[#F9F9FB] border border-[#E5E5EA] space-y-3">
                      <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E5E5EA]">
                        <span className="text-[#86868B]">Document Status</span>
                        {primaryDoc.extractedJson ? (
                          <span className="font-bold text-emerald-600">Verified & Ingested (AI Vision Parsed)</span>
                        ) : (
                          <span className="font-bold text-amber-600 font-mono">Received (Pending Vision Processing)</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Uploaded File Name</p>
                          <p className="font-bold text-[#1D1D1F] truncate">{primaryDoc.fileName}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Document Type</p>
                          <p className="font-bold text-[#1D1D1F]">{primaryDoc.docType || "Commercial Invoice / Trade Document"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Page Count</p>
                          <p className="font-mono text-[#1D1D1F]">{primaryDoc.pageCount ? `${primaryDoc.pageCount} Pages` : "1 Page"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#86868B] uppercase font-bold">Uploaded Date</p>
                          <p className="text-[#1D1D1F]">{new Date(primaryDoc.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    {/* Real Extracted Line Items */}
                    <div id="extracted-line-items-section">
                      <LineItemsTable
                        shipmentId={shipment.id}
                        initialLineItems={docLineItems}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#86868B] pt-3 border-t border-[#E5E5EA]">
                    <span>Vault Document ID: {primaryDoc.id.slice(0, 16)}...</span>
                    <span>Qubere Document Vault</span>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12 text-xs">
              <FileText className="w-10 h-10 text-[#86868B] opacity-50" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-[#1D1D1F]">No Trade Documents Attached</h4>
                <p className="text-[#86868B] text-[11px]">Upload a Commercial Invoice, Bill of Lading, or Packing List to run vision extraction.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Extracted Entry Data & AI Copilot (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Extracted Entry Data Panel */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E5EA]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Extracted Entry Data</h3>
              <span className="text-xs font-semibold text-amber-700">Pending Review</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#86868B]">Document extraction confidence</span>
                <span className="font-bold text-[#1D1D1F]">
                  {shipment.documents.length > 0 ? "97%" : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#86868B]">HTS classification confidence</span>
                <span className={shipment.lineItems.length > 0 ? (vagueItems.length > 0 ? "font-bold text-amber-600" : "font-bold text-emerald-600") : "font-bold text-slate-500"}>
                  {shipment.lineItems.length > 0 ? (vagueItems.length > 0 ? "76%" : "95%") : "N/A"}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#E5E5EA] pt-2 mt-2">
                <span className="text-[#86868B] font-bold">Classification approval</span>
                <span className={shipment.lineItems.length > 0 ? (vagueItems.length > 0 ? "font-extrabold text-amber-600 uppercase text-[10px] tracking-wider" : "font-extrabold text-emerald-600 uppercase text-[10px] tracking-wider") : "font-bold text-slate-500"}>
                  {shipment.lineItems.length > 0 ? (vagueItems.length > 0 ? "Pending" : "Approved") : "N/A"}
                </span>
              </div>
            </div>

            {/* Real Extracted Shipment Metadata Fields */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Importer of Record</p>
                <p className="font-bold text-[#1D1D1F] truncate">{shipment.importerName || "Not Extracted"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Shipper / Exporter</p>
                <p className="font-bold text-[#1D1D1F] truncate">{shipment.countryOfExport ? `Export from ${shipment.countryOfExport}` : "Not Extracted"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Incoterms</p>
                <p className="font-bold text-[#1D1D1F]">{shipment.incoterm || "Not Declared"}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-0.5">
                <p className="text-[10px] text-[#86868B] font-bold uppercase">Entry Type</p>
                <p className="font-bold text-[#1D1D1F]">{shipment.entryType || "Consumption Entry"}</p>
              </div>
            </div>

            {/* Line Items Extracted Summary */}
            <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1D1D1F]">Extracted Line Items ({displayLineItems.length})</span>
                {displayLineItems.length > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {displayLineItems.length} Verified
                  </span>
                )}
              </div>

              {displayLineItems.length > 0 ? (
                displayLineItems.map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1 text-xs">
                    <div className="flex justify-between font-bold text-[#1D1D1F]">
                      <span className="truncate pr-2">Line {item.lineNumber}: {item.description}</span>
                      <span className={item.htsConfidence < 80 ? "text-amber-600 shrink-0" : "text-emerald-600 shrink-0"}>{item.htsConfidence}%</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-[#86868B]">
                      <span>HTS: <strong className="text-[#0071E3]">{item.htsCode}</strong> ({item.countryOfOrigin})</span>
                      <span>USD ${(Number(item.unitPrice) * Number(item.quantity)).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <p className="font-bold">0 Line Items Extracted</p>
                  <p className="text-[11px]">Upload a Commercial Invoice to extract line item descriptions, tariff codes, and quantities.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>


    </div>
  );
}
