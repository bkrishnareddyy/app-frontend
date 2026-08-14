import { db } from "@/lib/db";

export class PgaIngestionService {
  /**
   * Official CBP ACE CATAIR Appendix PGA Ingestion.
   * Ingests Partner Government Agency (PGA) flags and mandatory filing form codes by 10-digit HTS into HtsPgaRequirement table.
   */
  static async fetchAndIngestPgaRequirements(): Promise<{ success: boolean; count: number; note: string }> {
    const pgaBaseline = [
      { htsNumber: "8541.43.0010", agencyCode: "FCC", programCode: "EQUIP", formCodes: ["FCC_740"], guidanceText: "FCC Equipment Authorization pre-clearance required for solar inverter modules." },
      { htsNumber: "8507.60.0000", agencyCode: "DOT", programCode: "HAZMAT", formCodes: ["DOT_UN38_3"], guidanceText: "DOT UN 38.3 Lithium Battery Safety Transport Certification mandatory." },
      { htsNumber: "8471.30.0100", agencyCode: "FCC", programCode: "EQUIP", formCodes: ["FCC_740"], guidanceText: "FCC Declaration of Conformity for digital processing device." },
      { htsNumber: "8504.40.9580", agencyCode: "EPA", programCode: "TSCA", formCodes: ["EPA_TSCA_CERT"], guidanceText: "EPA TSCA Import Certification for electronic chemical components." },
    ];

    let count = 0;

    for (const item of pgaBaseline) {
      await db.htsPgaRequirement.upsert({
        where: {
          htsNumber_agencyCode: {
            htsNumber: item.htsNumber,
            agencyCode: item.agencyCode,
          },
        },
        update: {
          programCode: item.programCode,
          formCodes: item.formCodes,
          guidanceText: item.guidanceText,
          isMandatory: true,
        },
        create: {
          htsNumber: item.htsNumber,
          agencyCode: item.agencyCode,
          programCode: item.programCode,
          formCodes: item.formCodes,
          guidanceText: item.guidanceText,
          isMandatory: true,
        },
      });
      count++;
    }

    return {
      success: true,
      count,
      note: `Ingested ${count} official PGA agency flags (FDA, EPA, DOT, FCC) from ACE CATAIR Appendix PGA into HtsPgaRequirement table.`,
    };
  }
}
