import { db } from "@/lib/db";
import crypto from "crypto";

export class BisCslIngestionService {
  /**
   * Generates a deterministic SHA-256 entity hash for deduplication.
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
   * Real, fully paginated fetcher for the official BIS Consolidated Screening List REST API.
   * Source: International Trade Administration (trade.gov)
   */
  static async fetchAndIngest(maxRecords: number = 1000): Promise<{ success: boolean; count: number; note: string }> {
    const pageSize = 100;
    let offset = 0;
    let totalFetched = 0;
    let createdCount = 0;
    let updatedCount = 0;

    const apiKey = process.env.TRADE_GOV_API_KEY || "";
    const baseUrl = "https://api.trade.gov/v1/consolidated_screening_list/search";

    while (totalFetched < maxRecords) {
      const url = new URL(baseUrl);
      url.searchParams.set("size", String(pageSize));
      url.searchParams.set("offset", String(offset));
      if (apiKey) url.searchParams.set("api_key", apiKey);

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Trade.gov API returned HTTP ${res.status}: ${res.statusText}. Ingestion aborted.`);
      }

      const json = await res.json();
      const results: any[] = json.results || [];
      const totalAvailable = json.total || results.length;

      if (results.length === 0) break;

      const now = new Date();
      const dbOperations = [];

      for (const item of results) {
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
          else if (s.includes("NS-MBS") || s.includes("NS_MBS")) sourceList = "NS_MBS";
        }

        let entityType = "ENTITY";
        if (item.type) {
          const t = String(item.type).toUpperCase();
          if (t.includes("INDIVIDUAL")) entityType = "INDIVIDUAL";
          else if (t.includes("VESSEL")) entityType = "VESSEL";
          else if (t.includes("AIRCRAFT")) entityType = "AIRCRAFT";
        }

        const addresses = Array.isArray(item.addresses) && item.addresses[0] ? item.addresses[0] : {};
        const entityName = item.name || item.title || "Unknown Entity";
        const country = item.country || addresses.country || null;
        const entityHash = this.computeEntityHash(sourceList, entityName, country || undefined);

        dbOperations.push(
          db.screeningEntity.upsert({
            where: { entityHash },
            update: {
              entityType,
              alternateNames: Array.isArray(item.alt_names) ? item.alt_names : [],
              address: addresses.address || null,
              city: addresses.city || null,
              country,
              nationalityCountry: item.citizenship || null,
              programCodes: Array.isArray(item.programs) ? item.programs : [],
              remarks: item.remarks || item.federal_register_notice || null,
              publicationStatus: "PUBLISHED",
              publishedAt: now,
              sourcePublishedAt: item.start_date ? new Date(item.start_date) : undefined,
            },
            create: {
              entityHash,
              sourceList,
              entityType,
              name: entityName,
              alternateNames: Array.isArray(item.alt_names) ? item.alt_names : [],
              address: addresses.address || null,
              city: addresses.city || null,
              country,
              nationalityCountry: item.citizenship || null,
              programCodes: Array.isArray(item.programs) ? item.programs : [],
              remarks: item.remarks || item.federal_register_notice || null,
              publicationStatus: "PUBLISHED",
              publishedAt: now,
              sourcePublishedAt: item.start_date ? new Date(item.start_date) : now,
            },
          })
        );
      }

      await Promise.all(dbOperations);
      totalFetched += results.length;
      offset += pageSize;

      if (offset >= totalAvailable) break;
    }

    return {
      success: true,
      count: totalFetched,
      note: `Fetched and processed ${totalFetched} authentic screening records from trade.gov CSL REST API.`,
    };
  }
}
