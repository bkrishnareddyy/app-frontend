import { db } from "@/lib/db";
import { computeEntityHash } from "@/modules/screening/entityHash";

export class BisCslIngestionService {
  static computeEntityHash = computeEntityHash;

  /**
   * Real, fully paginated fetcher for the official BIS Consolidated Screening List REST API.
   * Source: International Trade Administration (trade.gov)
   */
  static async fetchAndIngest(
    maxRecords: number = Number.MAX_SAFE_INTEGER,
    staged: boolean = true
  ): Promise<{ success: boolean; count: number; supersededCount: number; note: string }> {
    const pageSize = 100;
    let offset = 0;
    let totalFetched = 0;
    let supersededCount = 0;
    const activeHashes = new Set<string>();

    const apiKey = process.env.TRADE_GOV_API_KEY || "";
    const baseUrl = "https://api.trade.gov/v1/consolidated_screening_list/search";
    const now = new Date();
    const targetStatus = staged ? "DRAFT" : "PUBLISHED";

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

      const dbOperations = [];

      for (const item of results) {
        let sourceList = "ENTITY_LIST";
        if (item.source) {
          const s = String(item.source).toUpperCase();
          if (s.includes("DPL")) sourceList = "DPL";
          else if (s.includes("UNVERIFIED")) sourceList = "UNVERIFIED";
          else if (s.includes("MEU") || s.includes("MILITARY END USER")) sourceList = "MEU_LIST";
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
        activeHashes.add(entityHash);

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
              publicationStatus: targetStatus,
              publishedAt: targetStatus === "PUBLISHED" ? now : undefined,
              supersededAt: null,
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
              publicationStatus: targetStatus,
              publishedAt: targetStatus === "PUBLISHED" ? now : null,
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

    // Release Snapshot & Point-in-time Superseding:
    // Mark entities removed from official CSL list as SUPERSEDED
    if (activeHashes.size > 0) {
      const activeCslSources = ["ENTITY_LIST", "DPL", "UNVERIFIED", "MEU_LIST", "ISN", "SSI", "FSE", "PLC", "SDN", "NS_MBS"];
      const existingPublished = await db.screeningEntity.findMany({
        where: {
          publicationStatus: "PUBLISHED",
          sourceList: { in: activeCslSources },
        },
        select: { id: true, entityHash: true },
      });

      const toSupersede = existingPublished.filter((e) => !activeHashes.has(e.entityHash));
      if (toSupersede.length > 0) {
        supersededCount = toSupersede.length;
        await db.screeningEntity.updateMany({
          where: { id: { in: toSupersede.map((e) => e.id) } },
          data: {
            publicationStatus: "SUPERSEDED",
            supersededAt: now,
          },
        });
      }
    }

    return {
      success: true,
      count: totalFetched,
      supersededCount,
      note: `Fetched and processed ${totalFetched} authentic screening records (${targetStatus}) from trade.gov CSL REST API. Marked ${supersededCount} removed records as SUPERSEDED.`,
    };
  }

  /**
   * Promotes all DRAFT CSL screening entities to PUBLISHED.
   */
  static async publishStagedEntities() {
    return db.screeningEntity.updateMany({
      where: { publicationStatus: "DRAFT" },
      data: {
        publicationStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }
}
