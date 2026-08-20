import { db } from "@/lib/db";
import { SaxesParser, SaxesTagPlain } from "saxes";
import { parse as parseCsv } from "csv-parse";
import { Readable } from "stream";
import { computeEntityHash } from "@/modules/screening/entityHash";

export type OfacSourceList = "SDN" | "CONSOLIDATED_NON_SDN";

const OFAC_LIST_SOURCES: Record<OfacSourceList, { xmlUrl: string; csvUrl: string }> = {
  SDN: {
    xmlUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml",
    csvUrl: "https://www.treasury.gov/ofac/downloads/sdn.csv",
  },
  CONSOLIDATED_NON_SDN: {
    xmlUrl: "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml",
    csvUrl: "https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv",
  },
};

// Chunk size for upserts, chosen against DATABASE_URL's pgbouncer
// connection_limit=10 -- a Promise.all batch this size must stay below the
// pool size or concurrent upserts queue past pool_timeout and throw P2024
// (previously set to 150, which blew past the pool and hung/failed every run).
const UPSERT_BATCH_SIZE = 8;

// OFAC's SDN/Consolidated XML feed carries no per-entry Federal Register
// citation or effective/expiration date -- only the agency issuing the list
// is known, so citation/effectiveDate/expirationDate stay null rather than
// being guessed.
const OFAC_AGENCY = "OFAC (US Department of the Treasury)";

interface ParsedAka {
  lastName?: string;
  firstName?: string;
}

interface ParsedAddress {
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  country?: string;
}

interface ParsedEntry {
  uid?: string;
  firstName?: string;
  lastName?: string;
  sdnType?: string;
  programs: string[];
  akas: ParsedAka[];
  addresses: ParsedAddress[];
  dateOfBirth?: string;
  placeOfBirth?: string;
  remarksText?: string;
}

export interface OfacListIngestResult {
  sourceList: OfacSourceList;
  parsedCount: number;
  reportedTotal: number;
  csvRowCount: number | null;
  publishDate: Date | null;
  supersededCount: number;
}

function mapEntityType(sdnType?: string): string {
  const t = (sdnType || "").toUpperCase();
  if (t.includes("INDIVIDUAL")) return "INDIVIDUAL";
  if (t.includes("VESSEL")) return "VESSEL";
  if (t.includes("AIRCRAFT")) return "AIRCRAFT";
  return "ENTITY";
}

function parseOfacDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
}

function formatPersonName(lastName?: string, firstName?: string): string {
  if (firstName && lastName) return `${lastName}, ${firstName}`;
  return lastName || firstName || "";
}

export interface ParsedOfacFeed {
  entries: ParsedEntry[];
  reportedTotal: number | null;
  publishDate: Date | null;
}

/**
 * Streams an sdnList XML body (never buffers the raw file, which runs
 * ~29MB for SDN) into an in-memory array of parsed entries. The parsed
 * objects themselves are small -- collecting all ~19,700 of them before
 * writing lets the caller's completeness check run as an all-or-nothing
 * gate before anything touches the database.
 *
 * Decoupled from `fetch` (takes a raw ReadableStream<Uint8Array>) so the
 * SAX parsing logic can be unit-tested against a real, trimmed XML fixture
 * without a network call.
 */
export async function parseOfacXmlStream(body: ReadableStream<Uint8Array>): Promise<ParsedOfacFeed> {
  const entries: ParsedEntry[] = [];
  let reportedTotal: number | null = null;
  let publishDate: Date | null = null;

  const parser = new SaxesParser();
  const stack: string[] = [];
  let textBuf = "";
  let currentEntry: ParsedEntry | null = null;
  let currentAka: ParsedAka | null = null;
  let currentAddress: ParsedAddress | null = null;
  let parseError: Error | null = null;

  parser.on("error", (e) => {
    parseError = e;
  });

  parser.on("text", (t) => {
    textBuf += t;
  });

  parser.on("opentag", (node: SaxesTagPlain) => {
    stack.push(node.name);
    textBuf = "";
    if (node.name === "sdnEntry") currentEntry = { programs: [], akas: [], addresses: [] };
    else if (node.name === "aka") currentAka = {};
    else if (node.name === "address") currentAddress = {};
  });

  parser.on("closetag", (node: SaxesTagPlain) => {
    const tag = node.name;
    const parentTag = stack[stack.length - 2];
    const value = textBuf.trim();

    if (tag === "Record_Count" && parentTag === "publshInformation") {
      const n = parseInt(value, 10);
      reportedTotal = Number.isFinite(n) ? n : null;
    } else if (tag === "Publish_Date" && parentTag === "publshInformation") {
      publishDate = parseOfacDate(value);
    } else if (currentAka && parentTag === "aka") {
      if (tag === "lastName") currentAka.lastName = value;
      else if (tag === "firstName") currentAka.firstName = value;
    } else if (tag === "aka" && currentEntry) {
      currentEntry.akas.push(currentAka!);
      currentAka = null;
    } else if (currentAddress && parentTag === "address") {
      if (tag === "address1") currentAddress.address1 = value;
      else if (tag === "address2") currentAddress.address2 = value;
      else if (tag === "address3") currentAddress.address3 = value;
      else if (tag === "city") currentAddress.city = value;
      else if (tag === "stateOrProvince") currentAddress.stateOrProvince = value;
      else if (tag === "postalCode") currentAddress.postalCode = value;
      else if (tag === "country") currentAddress.country = value;
    } else if (tag === "address" && currentEntry) {
      currentEntry.addresses.push(currentAddress!);
      currentAddress = null;
    } else if (tag === "program" && parentTag === "programList" && currentEntry) {
      currentEntry.programs.push(value);
    } else if (tag === "dateOfBirth" && parentTag === "dateOfBirthItem" && currentEntry) {
      currentEntry.dateOfBirth = value;
    } else if (tag === "placeOfBirth" && parentTag === "placeOfBirthItem" && currentEntry) {
      currentEntry.placeOfBirth = value;
    } else if (tag === "remarks" && parentTag === "sdnEntry" && currentEntry) {
      currentEntry.remarksText = value;
    } else if (currentEntry && parentTag === "sdnEntry") {
      if (tag === "uid") currentEntry.uid = value;
      else if (tag === "firstName") currentEntry.firstName = value;
      else if (tag === "lastName") currentEntry.lastName = value;
      else if (tag === "sdnType") currentEntry.sdnType = value;
    } else if (tag === "sdnEntry" && currentEntry) {
      entries.push(currentEntry);
      currentEntry = null;
    }

    stack.pop();
    textBuf = "";
  });

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.write(decoder.decode(value, { stream: true }));
      if (parseError) throw parseError;
    }
    parser.write(decoder.decode());
    parser.close();
    if (parseError) throw parseError;
  } finally {
    reader.releaseLock();
  }

  return { entries, reportedTotal, publishDate };
}

export class OfacSdnIngestionService {
  private static async parseOfacXml(url: string): Promise<ParsedOfacFeed> {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`OFAC source returned HTTP ${res.status} for ${url}. Ingestion aborted.`);
    }
    return parseOfacXmlStream(res.body);
  }

  /**
   * Secondary, best-effort completeness signal: count data rows in the
   * source's relational CSV export via a real RFC4180 parser (a naive
   * newline split overcounts -- OFAC's address fields contain embedded
   * newlines inside quoted values). Never blocks a successful ingest; the
   * hard circuit breaker is the XML's own Record_Count check.
   */
  private static async countCsvRows(url: string): Promise<number | null> {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;

    const nodeStream = Readable.fromWeb(res.body as any);
    const parser = parseCsv({ relax_column_count: true, skip_empty_lines: true });
    let count = 0;

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(parser);
      parser.on("data", () => {
        count++;
      });
      parser.on("end", () => resolve());
      parser.on("error", reject);
      nodeStream.on("error", reject);
    });

    return count;
  }

  private static mapEntry(sourceList: OfacSourceList, entry: ParsedEntry) {
    const entityType = mapEntityType(entry.sdnType);
    const name = formatPersonName(entry.lastName, entry.firstName) || "Unknown Entity";
    const alternateNames = entry.akas
      .map((a) => formatPersonName(a.lastName, a.firstName))
      .filter((n) => n.length > 0);

    const primary = entry.addresses[0];
    const address = primary
      ? [primary.address1, primary.address2, primary.address3, primary.stateOrProvince, primary.postalCode]
          .filter(Boolean)
          .join(", ") || null
      : null;
    const city = primary?.city || null;
    const country = primary?.country || null;

    const remarksParts: string[] = [];
    if (entry.remarksText) remarksParts.push(entry.remarksText);
    if (entry.dateOfBirth) remarksParts.push(`DOB: ${entry.dateOfBirth}`);
    if (entry.placeOfBirth) remarksParts.push(`POB: ${entry.placeOfBirth}`);
    for (const extra of entry.addresses.slice(1)) {
      const line = [extra.address1, extra.city, extra.country].filter(Boolean).join(", ");
      if (line) remarksParts.push(`Additional address: ${line}`);
    }

    return {
      entityHash: computeEntityHash(sourceList, name, country || undefined),
      entityType,
      name,
      alternateNames,
      address,
      city,
      country,
      programCodes: entry.programs,
      remarks: remarksParts.length ? remarksParts.join(" | ") : null,
      agency: OFAC_AGENCY,
    };
  }

  static async fetchAndIngestList(sourceList: OfacSourceList): Promise<OfacListIngestResult> {
    const { xmlUrl, csvUrl } = OFAC_LIST_SOURCES[sourceList];
    const { entries, reportedTotal, publishDate } = await this.parseOfacXml(xmlUrl);

    // Circuit breaker: a partial or unverifiable feed must never look like
    // a successful sync. Nothing is written if this fails.
    if (reportedTotal === null) {
      throw new Error(
        `OFAC ${sourceList} feed did not report a Record_Count. Refusing to treat an unverifiable feed as complete.`
      );
    }
    if (entries.length !== reportedTotal) {
      throw new Error(
        `OFAC ${sourceList} completeness check failed: parsed ${entries.length} entries but Treasury reported ${reportedTotal}. Ingestion aborted -- no data was written.`
      );
    }
    if (entries.length === 0) {
      throw new Error(`OFAC ${sourceList} feed returned 0 entries. Refusing to supersede existing published data.`);
    }

    const now = new Date();
    for (let i = 0; i < entries.length; i += UPSERT_BATCH_SIZE) {
      const batch = entries.slice(i, i + UPSERT_BATCH_SIZE);
      await Promise.all(
        batch.map((entry) => {
          const data = this.mapEntry(sourceList, entry);
          return db.screeningEntity.upsert({
            where: { entityHash: data.entityHash },
            update: {
              entityType: data.entityType,
              name: data.name,
              alternateNames: data.alternateNames,
              address: data.address,
              city: data.city,
              country: data.country,
              programCodes: data.programCodes,
              remarks: data.remarks,
              agency: data.agency,
              publicationStatus: "PUBLISHED",
              publishedAt: now,
              supersededAt: null,
              sourcePublishedAt: publishDate ?? undefined,
            },
            create: {
              entityHash: data.entityHash,
              sourceList,
              entityType: data.entityType,
              name: data.name,
              alternateNames: data.alternateNames,
              address: data.address,
              city: data.city,
              country: data.country,
              programCodes: data.programCodes,
              remarks: data.remarks,
              agency: data.agency,
              publicationStatus: "PUBLISHED",
              publishedAt: now,
              sourcePublishedAt: publishDate ?? now,
            },
          });
        })
      );
    }

    // Every row touched this run shares the same `publishedAt: now`. Any
    // previously-PUBLISHED row for this sourceList with an older
    // publishedAt wasn't in today's feed -- OFAC delisted it. This avoids
    // passing a ~19,700-item entityHash list into a NOT IN filter.
    const supersedeResult = await db.screeningEntity.updateMany({
      where: { sourceList, publicationStatus: "PUBLISHED", publishedAt: { lt: now } },
      data: { publicationStatus: "SUPERSEDED", supersededAt: new Date() },
    });

    let csvRowCount: number | null = null;
    try {
      csvRowCount = await this.countCsvRows(csvUrl);
    } catch {
      csvRowCount = null;
    }

    return {
      sourceList,
      parsedCount: entries.length,
      reportedTotal,
      csvRowCount,
      publishDate,
      supersededCount: supersedeResult.count,
    };
  }

  static async fetchAndIngest(): Promise<{ sdn: OfacListIngestResult; consolidated: OfacListIngestResult }> {
    const sdn = await this.fetchAndIngestList("SDN");
    const consolidated = await this.fetchAndIngestList("CONSOLIDATED_NON_SDN");
    return { sdn, consolidated };
  }
}
