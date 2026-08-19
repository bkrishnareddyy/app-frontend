import { db } from "../db";
import { Decimal } from "../tariff/decimal";
import { assembleReasonableCarePackage, ReasonableCarePackage } from "./reasonableCarePackage";
import Anthropic from "@anthropic-ai/sdk";

export interface ControlEvidence {
  id: string;
  name: string;
  category: string;
  version: string;
  description: string | null;
  createdAt: string;
}

export interface SampleEntry {
  entryNumber: string;
  customsValue: number;
  dutiesPaid: number;
  reasonableCareRecord: ReasonableCarePackage;
}

export interface FocusedAssessmentFile {
  auditId: string;
  importer: {
    name: string;
    cbpNumber: string;
    address: string;
  };
  periodCovered: {
    from: string;
    to: string;
  };
  entryPopulation: {
    total: number;
    byEntryType: Record<string, number>;
    byHtsChapter: Record<string, number>;
    totalDutyPaid: number;
  };
  controlsInventory: ControlEvidence[];
  sampleEntries: SampleEntry[];
  exceptionsSummary: {
    totalCount: number;
    resolvedCount: number;
    byCategory: Record<string, number>;
  };
  remediationNarrative: string;
}

/**
 * Assembler for CBP Focused Assessment Defense File (Task D-2).
 * Standalone filings participate in filing-level population totals but shipment-derived
 * HTS/sample evidence is only available when a shipment relation exists.
 */
export async function assembleFocusedAssessmentFile(
  accountId: string,
  params: {
    importerOfRecordId?: string;
    periodFrom: string;
    periodTo: string;
    entryIds?: string[];
  }
): Promise<FocusedAssessmentFile> {
  const fromDate = new Date(params.periodFrom);
  const toDate = new Date(params.periodTo);

  const filings = await db.customsFiling.findMany({
    where: {
      accountId,
      createdAt: { gte: fromDate, lte: toDate },
      ...(params.importerOfRecordId ? { importerOfRecordId: params.importerOfRecordId } : {}),
    },
    include: {
      importerOfRecord: true,
      shipment: {
        include: {
          lineItems: true,
          importerOfRecord: true,
        },
      },
    },
  });

  let totalDutyPaid = new Decimal(0);
  const byEntryType: Record<string, number> = {};
  const byHtsChapter: Record<string, number> = {};

  for (const f of filings) {
    totalDutyPaid = totalDutyPaid.plus(new Decimal(f.totalDuties || 0));
    if (f.entryType) {
      byEntryType[f.entryType] = (byEntryType[f.entryType] || 0) + 1;
    }

    for (const item of f.shipment?.lineItems ?? []) {
      const chapter = item.htsCode.slice(0, 2);
      byHtsChapter[chapter] = (byHtsChapter[chapter] || 0) + 1;
    }
  }

  const dbControls = await db.controlEvidence.findMany({
    where: { accountId },
  });
  const controlsInventory: ControlEvidence[] = dbControls.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    version: c.version,
    description: c.description,
    createdAt: c.createdAt.toISOString(),
  }));

  const sampleEntries: SampleEntry[] = [];
  const targetFilings = params.entryIds
    ? filings.filter((f) => params.entryIds!.includes(f.id))
    : filings.slice(0, 5);

  for (const f of targetFilings) {
    if (!f.shipmentId) continue;
    const pkg = await assembleReasonableCarePackage(accountId, f.shipmentId);
    if (pkg) {
      sampleEntries.push({
        entryNumber: f.entryNumber ?? f.localReferenceNumber ?? f.id,
        customsValue: Number(f.totalValue || 0),
        dutiesPaid: Number(f.totalDuties || 0),
        reasonableCareRecord: pkg,
      });
    }
  }

  const exceptionItems = await db.exceptionItem.findMany({
    where: {
      accountId,
      createdAt: { gte: fromDate, lte: toDate },
    },
  });

  const totalExceptions = exceptionItems.length;
  const resolvedCount = exceptionItems.filter((e) => e.status === "Resolved" || e.status === "RESOLVED").length;
  const byCategory: Record<string, number> = {};
  for (const e of exceptionItems) {
    const cat = e.category || "GENERAL";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  let importerName = "Unspecified Importer";
  let cbpNumber = "";
  let addressStr = "";

  if (params.importerOfRecordId) {
    const importer = await db.importerOfRecord.findFirst({
      where: { id: params.importerOfRecordId, accountId },
    });
    if (importer) {
      importerName = importer.name;
      cbpNumber = importer.cbpImporterNumber;
      addressStr = formatAddress(importer.address);
    }
  } else if (filings.length > 0) {
    const f = filings[0];
    const importer = f.importerOfRecord ?? f.shipment?.importerOfRecord;
    if (importer) {
      importerName = importer.name;
      cbpNumber = importer.cbpImporterNumber;
      addressStr = formatAddress(importer.address);
    } else if (f.shipment) {
      importerName = f.shipment.importerName;
    }
  }

  let remediationNarrative = "";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const prompt = `
Generate a professional customs compliance focused assessment cover narrative for an importer.
Data Summary:
- Importer Name: ${importerName}
- CBP Importer Number: ${cbpNumber || "N/A"}
- Audit Period: From ${params.periodFrom} to ${params.periodTo}
- Total entries audited: ${filings.length}
- Total exceptions detected: ${totalExceptions}
- Resolved exceptions: ${resolvedCount}
- Exception resolution rate: ${totalExceptions > 0 ? Math.round((resolvedCount / totalExceptions) * 100) : 100}%
- Active controls: ${controlsInventory.map(c => `${c.name} (${c.category})`).join(", ") || "None"}

Please provide a structured, professional narrative summarizing:
1. The importer's overall compliance posture.
2. Key exception patterns identified (if any).
3. Specific remediation actions taken or planned to ensure reasonable care is maintained.

Do not include any placeholders. Ensure the tone is objective, formal, and suitable for a CBP Focused Assessment defense document. Keep it concise (around 150-250 words).
`;
      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        remediationNarrative = textBlock.text.trim();
      }
    } catch (err) {
      console.error("Failed to generate remediation narrative via Claude:", err);
    }
  }

  if (!remediationNarrative) {
    remediationNarrative = `
Qubere importer compliance controls successfully audited ${filings.length} entries.
A total of ${totalExceptions} exceptions were detected, with a resolved rate of ${totalExceptions > 0 ? Math.round((resolvedCount / totalExceptions) * 100) : 100}%.
Internal procedures including training manuals and vendor certification programs are active and version-controlled.
    `.trim();
  }

  return {
    auditId: `FA-AUDIT-${Date.now().toString().slice(-6)}`,
    importer: {
      name: importerName,
      cbpNumber: cbpNumber || "",
      address: addressStr || "",
    },
    periodCovered: {
      from: params.periodFrom,
      to: params.periodTo,
    },
    entryPopulation: {
      total: filings.length,
      byEntryType,
      byHtsChapter,
      totalDutyPaid: totalDutyPaid.toNumber(),
    },
    controlsInventory,
    sampleEntries,
    exceptionsSummary: {
      totalCount: totalExceptions,
      resolvedCount,
      byCategory,
    },
    remediationNarrative,
  };
}

function formatAddress(addressVal: any): string {
  if (!addressVal) return "";
  if (typeof addressVal === "string") return addressVal;
  const parts: string[] = [];
  if (addressVal.street) parts.push(String(addressVal.street));
  if (addressVal.city) parts.push(String(addressVal.city));
  if (addressVal.state) parts.push(String(addressVal.state));
  if (addressVal.zip) parts.push(String(addressVal.zip));
  if (addressVal.country) parts.push(String(addressVal.country));
  return parts.join(", ");
}
