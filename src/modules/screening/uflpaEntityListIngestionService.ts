import { db } from "@/lib/db";
import * as cheerio from "cheerio";
import { computeEntityHash } from "@/modules/screening/entityHash";

const UFLPA_PAGE_URL = "https://www.dhs.gov/uflpa-entity-list";

// The DHS page blocks non-browser User-Agents with HTTP 403; a browser-like
// UA is required to fetch the page at all (confirmed via manual curl testing).
const FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const AGENCY = "DHS Forced Labor Enforcement Task Force (FLETF)";

// The page renders the list as four separate static HTML <table> elements,
// one per UFLPA Section 2(d)(2)(B) statutory clause. The citation column
// isn't in the table itself -- each table is preceded by a heading naming
// its clause, so the citation is attached per-table, not parsed per-row.
const SECTION_CITATIONS = [
  "UFLPA Section 2(d)(2)(B)(i)",
  "UFLPA Section 2(d)(2)(B)(ii)",
  "UFLPA Section 2(d)(2)(B)(iv)",
  "UFLPA Section 2(d)(2)(B)(v)",
];

export interface UflpaEntry {
  name: string;
  alternateNames: string[];
  citation: string;
  effectiveDate: Date | null;
}

export interface UflpaIngestResult {
  parsedCount: number;
  supersededCount: number;
}

function parseEffectiveDate(value: string): Date | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, monthName, day, year] = m;
  const parsedUtcMs = Date.parse(`${monthName} ${day}, ${year} UTC`);
  return Number.isNaN(parsedUtcMs) ? null : new Date(parsedUtcMs);
}

/**
 * Splits "Entity Name (also known as X; and Y) (and two aliases: Z)" into a
 * primary name plus a flat list of aliases. DHS mixes several alias-list
 * phrasings within the same cell, sometimes more than one per entry, so all
 * parenthetical groups are extracted and their semicolon/"and"-joined
 * contents flattened into one alias list.
 */
// Matches every parenthetical alias-list style DHS uses in this column:
// "(also known as X; and Y)", "(formerly known as X)", "(and two aliases: X; and Y)",
// "(including three aliases: X; Y; and Z)".
const ALIAS_PARENTHETICAL = /\((?:also known as|formerly known as|(?:and|including) \w+ alias(?:es)?:)([^)]*)\)/gi;

export function parseEntityNameCell(raw: string): { name: string; alternateNames: string[] } {
  const text = raw.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const aliasGroups = [...text.matchAll(ALIAS_PARENTHETICAL)];
  const name = text.replace(ALIAS_PARENTHETICAL, "").trim();

  const alternateNames: string[] = [];
  for (const group of aliasGroups) {
    for (const part of group[1].split(/;| and /i)) {
      const alias = part.trim();
      if (alias) alternateNames.push(alias);
    }
  }

  return { name, alternateNames };
}

/**
 * Parses the four UFLPA Entity List tables out of the DHS page's HTML.
 * Decoupled from `fetch` so this can be unit-tested against a saved HTML
 * fixture without a network call.
 */
export function parseUflpaEntityListHtml(html: string): UflpaEntry[] {
  const $ = cheerio.load(html);
  const entries: UflpaEntry[] = [];
  const tables = $("table").toArray();

  tables.forEach((table, index) => {
    const citation = SECTION_CITATIONS[index] ?? SECTION_CITATIONS[SECTION_CITATIONS.length - 1];
    $(table)
      .find("tbody tr")
      .each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const nameCellText = $(cells[0]).text();
        const dateCellText = $(cells[1]).text();
        const { name, alternateNames } = parseEntityNameCell(nameCellText);
        if (!name) return;
        entries.push({
          name,
          alternateNames,
          citation,
          effectiveDate: parseEffectiveDate(dateCellText),
        });
      });
  });

  return entries;
}

export class UflpaEntityListIngestionService {
  private static async fetchHtml(): Promise<string> {
    const res = await fetch(UFLPA_PAGE_URL, { headers: { "User-Agent": FETCH_USER_AGENT } });
    if (!res.ok) {
      throw new Error(`DHS UFLPA Entity List page returned HTTP ${res.status}. Ingestion aborted.`);
    }
    return res.text();
  }

  static async fetchAndIngest(): Promise<UflpaIngestResult> {
    const html = await this.fetchHtml();
    const entries = parseUflpaEntityListHtml(html);

    // Circuit breaker: the live list has run to 150+ entries across its
    // four sections since 2022 and only grows -- a near-empty parse means
    // the page structure changed, not that DHS delisted almost everyone.
    if (entries.length < 20) {
      throw new Error(
        `DHS UFLPA Entity List parse returned only ${entries.length} entries. Refusing to treat this as a complete, ` +
          "successful ingest -- the page's HTML structure most likely changed. No data was written."
      );
    }

    const now = new Date();
    for (const entry of entries) {
      const entityHash = computeEntityHash("UFLPA_ENTITY_LIST", entry.name);
      const data = {
        entityType: "ENTITY",
        name: entry.name,
        alternateNames: entry.alternateNames,
        citation: entry.citation,
        agency: AGENCY,
        effectiveDate: entry.effectiveDate,
      };
      await db.screeningEntity.upsert({
        where: { entityHash },
        update: {
          ...data,
          publicationStatus: "PUBLISHED",
          publishedAt: now,
          supersededAt: null,
        },
        create: {
          entityHash,
          sourceList: "UFLPA_ENTITY_LIST",
          ...data,
          programCodes: [],
          publicationStatus: "PUBLISHED",
          publishedAt: now,
        },
      });
    }

    // Same point-in-time supersession convention as OFAC SDN: any
    // previously-PUBLISHED row for this sourceList not touched by this run
    // (older publishedAt) has been removed from the DHS list.
    const supersedeResult = await db.screeningEntity.updateMany({
      where: { sourceList: "UFLPA_ENTITY_LIST", publicationStatus: "PUBLISHED", publishedAt: { lt: now } },
      data: { publicationStatus: "SUPERSEDED", supersededAt: new Date() },
    });

    return { parsedCount: entries.length, supersededCount: supersedeResult.count };
  }
}
