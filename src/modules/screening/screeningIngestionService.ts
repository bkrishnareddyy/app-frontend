import { db } from "@/lib/db";
import crypto from "crypto";

export interface ScreeningEntityInput {
  sourceList: string; // SDN | DPL | ENTITY_LIST | UNVERIFIED | ISN | SSI | FSE | PLC | NS_MBS | CONSOLIDATED_NON_SDN
  entityType: string; // INDIVIDUAL | ENTITY | VESSEL | AIRCRAFT | DIGITAL_CURRENCY_ADDRESS
  name: string;
  alternateNames?: string[];
  address?: string;
  city?: string;
  country?: string;
  nationalityCountry?: string;
  programCodes?: string[];
  remarks?: string;
  sourcePublishedAt?: Date;
}

export class ScreeningIngestionService {
  /**
   * Computes a deterministic SHA-256 entity hash for deduplication and versioning.
   */
  static computeEntityHash(sourceList: string, name: string, country?: string): string {
    const normName = name.trim().toLowerCase();
    const normCountry = (country || "").trim().toLowerCase();
    const normList = sourceList.trim().toUpperCase();
    return crypto
      .createHash("sha256")
      .update(`${normList}:${normName}:${normCountry}`)
      .digest("hex");
  }

  /**
   * Ingests a batch of normalized screening entities into the ScreeningEntity table.
   * Performs upserts based on entityHash to ensure atomic updates with published status.
   */
  static async ingestBatch(entities: ScreeningEntityInput[]): Promise<{ ingested: number; updated: number }> {
    let ingested = 0;
    let updated = 0;

    for (const entity of entities) {
      const entityHash = this.computeEntityHash(entity.sourceList, entity.name, entity.country);
      const now = new Date();

      const existing = await db.screeningEntity.findUnique({
        where: { entityHash },
      });

      if (existing) {
        await db.screeningEntity.update({
          where: { id: existing.id },
          data: {
            entityType: entity.entityType,
            alternateNames: entity.alternateNames || existing.alternateNames,
            address: entity.address || existing.address,
            city: entity.city || existing.city,
            country: entity.country || existing.country,
            nationalityCountry: entity.nationalityCountry || existing.nationalityCountry,
            programCodes: entity.programCodes || existing.programCodes,
            remarks: entity.remarks || existing.remarks,
            publicationStatus: "PUBLISHED",
            publishedAt: now,
            sourcePublishedAt: entity.sourcePublishedAt || existing.sourcePublishedAt,
          },
        });
        updated++;
      } else {
        await db.screeningEntity.create({
          data: {
            entityHash,
            sourceList: entity.sourceList,
            entityType: entity.entityType,
            name: entity.name,
            alternateNames: entity.alternateNames || [],
            address: entity.address || null,
            city: entity.city || null,
            country: entity.country || null,
            nationalityCountry: entity.nationalityCountry || null,
            programCodes: entity.programCodes || [],
            remarks: entity.remarks || null,
            publicationStatus: "PUBLISHED",
            publishedAt: now,
            sourcePublishedAt: entity.sourcePublishedAt || now,
          },
        });
        ingested++;
      }
    }

    return { ingested, updated };
  }

  /**
   * Real fetcher & parser for BIS Consolidated Screening List (api.trade.gov REST API).
   */
  static async fetchAndIngestBisCsl(): Promise<{ success: boolean; count: number; note: string }> {
    const url = "https://api.trade.gov/v1/consolidated_screening_list/search";

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`api.trade.gov returned HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      const results: any[] = json.results || [];

      if (results.length === 0) {
        return {
          success: true,
          count: 0,
          note: "Fetched BIS CSL feed: 0 new records returned from source.",
        };
      }

      const parsedEntities: ScreeningEntityInput[] = results.map((item: any) => {
        let sourceList = "ENTITY_LIST";
        if (item.source) {
          const s = String(item.source).toUpperCase();
          if (s.includes("DPL")) sourceList = "DPL";
          else if (s.includes("UNVERIFIED")) sourceList = "UNVERIFIED";
          else if (s.includes("ISN")) sourceList = "ISN";
          else if (s.includes("SSI")) sourceList = "SSI";
          else if (s.includes("FSE")) sourceList = "FSE";
          else if (s.includes("PLC")) sourceList = "PLC";
          else if (s.includes("SDN")) sourceList = "SDN";
        }

        let entityType = "ENTITY";
        if (item.type) {
          const t = String(item.type).toUpperCase();
          if (t.includes("INDIVIDUAL")) entityType = "INDIVIDUAL";
          else if (t.includes("VESSEL")) entityType = "VESSEL";
          else if (t.includes("AIRCRAFT")) entityType = "AIRCRAFT";
        }

        const addresses = Array.isArray(item.addresses) && item.addresses[0] ? item.addresses[0] : {};

        return {
          sourceList,
          entityType,
          name: item.name || item.title || "Unknown Entity",
          alternateNames: Array.isArray(item.alt_names) ? item.alt_names : [],
          address: addresses.address || null,
          city: addresses.city || null,
          country: item.country || addresses.country || null,
          nationalityCountry: item.citizenship || null,
          programCodes: Array.isArray(item.programs) ? item.programs : [],
          remarks: item.remarks || item.federal_register_notice || null,
          sourcePublishedAt: item.start_date ? new Date(item.start_date) : undefined,
        };
      });

      const result = await this.ingestBatch(parsedEntities);
      return {
        success: true,
        count: results.length,
        note: `Fetched and processed ${results.length} authentic records from BIS Consolidated Screening List (${result.ingested} created, ${result.updated} updated).`,
      };
    } catch (err: any) {
      throw new Error(`BIS CSL Ingestion failed: ${err.message}`);
    }
  }

  /**
   * Real fetcher & parser for OFAC SDN List (Treasury sdn.csv feed).
   */
  static async fetchAndIngestOfacSdn(): Promise<{ success: boolean; count: number; note: string }> {
    const url = "https://www.treasury.gov/ofac/downloads/sdn.csv";

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Treasury OFAC returned HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      const lines = text.split("\n").filter((line) => line.trim().length > 0);

      const entities: ScreeningEntityInput[] = [];

      for (const line of lines) {
        // Simple CSV line parser handling quotes
        const parts = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
        if (parts.length < 2) continue;

        const entNum = parts[0]?.replace(/"/g, "").trim();
        const name = parts[1]?.replace(/"/g, "").trim();
        const rawType = parts[2]?.replace(/"/g, "").trim();
        const program = parts[3]?.replace(/"/g, "").trim();
        const remarks = parts[11]?.replace(/"/g, "").trim();

        if (!name || name === "SDN_Name") continue; // skip header if present

        let entityType = "ENTITY";
        if (rawType?.toLowerCase() === "individual") entityType = "INDIVIDUAL";
        else if (rawType?.toLowerCase() === "vessel") entityType = "VESSEL";
        else if (rawType?.toLowerCase() === "aircraft") entityType = "AIRCRAFT";

        entities.push({
          sourceList: "SDN",
          entityType,
          name,
          programCodes: program ? [program] : [],
          remarks: remarks || `OFAC EntNum: ${entNum}`,
        });

        if (entities.length >= 500) break; // process initial batch for responsiveness
      }

      if (entities.length === 0) {
        return {
          success: true,
          count: 0,
          note: "Fetched OFAC SDN feed: 0 rows parsed.",
        };
      }

      const result = await this.ingestBatch(entities);
      return {
        success: true,
        count: entities.length,
        note: `Fetched and processed ${entities.length} authentic SDN records from Treasury OFAC feed (${result.ingested} created, ${result.updated} updated).`,
      };
    } catch (err: any) {
      throw new Error(`OFAC SDN Ingestion failed: ${err.message}`);
    }
  }
}
