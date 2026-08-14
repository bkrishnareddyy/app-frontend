import { CrossIngestionService } from "./crossIngestionService";

export class CbpCrossFetchService {
  /**
   * Real REST API fetcher for official CBP CROSS Rulings.
   * Source: rulings.cbp.gov API
   */
  static async fetchAndIngest(searchTerm: string = "solar"): Promise<{ success: boolean; count: number; note: string }> {
    const baseUrl = "https://rulings.cbp.gov/api/search";
    const url = `${baseUrl}?term=${encodeURIComponent(searchTerm)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Qubere-Compliance-Ingestion-Engine/1.0",
      },
    });

    if (!res.ok) {
      throw new Error(`CBP CROSS Rulings API returned HTTP ${res.status}: ${res.statusText}. Ingestion aborted.`);
    }

    const json = await res.json();
    const results: any[] = json.results || json.rulings || [];

    if (results.length === 0) {
      return {
        success: true,
        count: 0,
        note: `Queried CBP CROSS API for term '${searchTerm}': 0 rulings returned.`,
      };
    }

    let ingestedCount = 0;

    for (const item of results) {
      const rulingNumber = item.rulingNumber || item.ruling_number || item.id;
      if (!rulingNumber) continue;

      const rulingType = String(rulingNumber).toUpperCase().startsWith("HQ") ? "HQ" : "NY";
      const htsCodes = Array.isArray(item.htsCollection)
        ? item.htsCollection.map((h: any) => (typeof h === "string" ? h : h.htsNumber))
        : Array.isArray(item.htsCodes)
        ? item.htsCodes
        : [];

      const textBody = item.rulingText || item.text || item.summary || item.title || "";

      await CrossIngestionService.ingestRuling({
        rulingNumber,
        issuedAt: item.issuedDate ? new Date(item.issuedDate) : new Date(),
        title: item.title || `CBP Ruling ${rulingNumber}`,
        office: rulingType,
        rulingType,
        sourceUrl: `https://rulings.cbp.gov/ruling/${encodeURIComponent(rulingNumber)}`,
        htsCodes,
        fragments: [
          {
            fragmentType: "TEXT",
            text: textBody.slice(0, 4000), // store authentic body text
          },
        ],
      });

      ingestedCount++;
    }

    return {
      success: true,
      count: ingestedCount,
      note: `Fetched and ingested ${ingestedCount} authentic rulings from CBP CROSS API for term '${searchTerm}'.`,
    };
  }
}
