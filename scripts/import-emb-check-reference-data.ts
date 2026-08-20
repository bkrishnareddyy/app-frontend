/**
 * One-time importer for the EMB-Check reference-data SQL dumps (countries,
 * country groups, country-by-country embargo map, commerce control list).
 *
 * These files are Oracle `Insert into TABLE (...) values (...)` dumps that
 * live outside this repo (see EMB_CHECK_SQL_DIR below) and were previously
 * loaded into the database by hand, with no committed script -- which is
 * why the tables went silently empty with no way to reproduce the load.
 * This script makes that load repeatable and reviewable.
 *
 * Run with: npx tsx scripts/import-emb-check-reference-data.ts
 * Override source directory with: EMB_CHECK_SQL_DIR=<path> npx tsx ...
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { db } from "../src/lib/db";

const SQL_DIR = process.env.EMB_CHECK_SQL_DIR || String.raw`C:\C-Drive\AI-Cust\EMB-Check\sql`;

type SqlValue = string | number | Date | null;
type SqlRow = Record<string, SqlValue>;

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Oracle DD-MON-RR: RR rounds 00-49 -> 20xx, 50-99 -> 19xx. */
function parseOracleRRDate(raw: string): Date {
  const m = /^(\d{2})-([A-Z]{3})-(\d{2})$/.exec(raw.toUpperCase());
  if (!m) throw new Error(`Unrecognized Oracle date literal: ${raw}`);
  const [, dd, mon, yy] = m;
  const month = MONTHS[mon];
  if (month === undefined) throw new Error(`Unrecognized month abbreviation: ${mon}`);
  const year = Number(yy) <= 49 ? 2000 + Number(yy) : 1900 + Number(yy);
  return new Date(Date.UTC(year, month, Number(dd)));
}

class Scanner {
  constructor(public text: string, public pos = 0) {}
  get length() {
    return this.text.length;
  }
  peek(offset = 0) {
    return this.text[this.pos + offset];
  }
  skipWhitespace() {
    while (this.pos < this.length && /\s/.test(this.text[this.pos])) this.pos++;
  }
  startsWith(token: string) {
    return this.text.startsWith(token, this.pos);
  }
  indexOf(token: string, from = this.pos) {
    return this.text.indexOf(token, from);
  }
}

/** Parses a single Oracle-quoted string starting at the opening quote, '' == escaped '. */
function parseQuotedString(s: Scanner): string {
  if (s.peek() !== "'") throw new Error(`Expected opening quote at position ${s.pos}`);
  s.pos++;
  let out = "";
  while (s.pos < s.length) {
    if (s.peek() === "'" && s.peek(1) === "'") {
      out += "'";
      s.pos += 2;
      continue;
    }
    if (s.peek() === "'") {
      s.pos++;
      return out;
    }
    out += s.peek();
    s.pos++;
  }
  throw new Error("Unterminated quoted string");
}

function parseValue(s: Scanner): SqlValue {
  s.skipWhitespace();
  if (/^null/i.test(s.text.slice(s.pos, s.pos + 4)) && !/[a-zA-Z0-9_]/.test(s.peek(4) ?? "")) {
    s.pos += 4;
    return null;
  }
  if (/^to_date/i.test(s.text.slice(s.pos, s.pos + 7))) {
    s.pos += 7;
    s.skipWhitespace();
    if (s.peek() !== "(") throw new Error(`Expected '(' after to_date at position ${s.pos}`);
    s.pos++;
    s.skipWhitespace();
    const dateLiteral = parseQuotedString(s);
    s.skipWhitespace();
    if (s.peek() === ",") {
      s.pos++;
      s.skipWhitespace();
      parseQuotedString(s); // format mask, unused
      s.skipWhitespace();
    }
    if (s.peek() !== ")") throw new Error(`Expected ')' to close to_date at position ${s.pos}`);
    s.pos++;
    return parseOracleRRDate(dateLiteral);
  }
  if (s.peek() === "'") {
    return parseQuotedString(s);
  }
  const start = s.pos;
  while (s.pos < s.length && s.peek() !== "," && s.peek() !== ")") s.pos++;
  const raw = s.text.slice(start, s.pos).trim();
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

/** Parses every `Insert into TABLE (cols) values (...)` statement in an Oracle SQL dump. */
function parseInserts(sqlText: string): { table: string; rows: SqlRow[] } {
  const s = new Scanner(sqlText);
  let table: string | null = null;
  const rows: SqlRow[] = [];

  while (true) {
    const nextIdx = s.indexOf("Insert into ", s.pos);
    if (nextIdx === -1) break;
    s.pos = nextIdx + "Insert into ".length;

    const tableEnd = s.indexOf("(", s.pos);
    const stmtTable = s.text.slice(s.pos, tableEnd).trim();
    table = table ?? stmtTable;
    if (stmtTable !== table) {
      throw new Error(`Mixed tables in one file: ${table} vs ${stmtTable}`);
    }
    s.pos = tableEnd + 1;

    const colsEnd = s.indexOf(")", s.pos);
    const columns = s.text
      .slice(s.pos, colsEnd)
      .split(",")
      .map((c) => c.trim());
    s.pos = colsEnd + 1;

    s.skipWhitespace();
    if (!/^values/i.test(s.text.slice(s.pos, s.pos + 6))) {
      throw new Error(`Expected VALUES keyword at position ${s.pos}`);
    }
    s.pos += 6;
    s.skipWhitespace();
    if (s.peek() !== "(") throw new Error(`Expected '(' to open values tuple at position ${s.pos}`);
    s.pos++;

    const row: SqlRow = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = parseValue(s);
      s.skipWhitespace();
      if (i < columns.length - 1) {
        if (s.peek() !== ",") throw new Error(`Expected ',' between values at position ${s.pos}`);
        s.pos++;
      }
    }
    s.skipWhitespace();
    if (s.peek() !== ")") throw new Error(`Expected ')' to close values tuple at position ${s.pos}`);
    s.pos++;
    rows.push(row);
  }

  if (!table) throw new Error("No Insert statements found");
  return { table, rows };
}

function loadFile(fileName: string): SqlRow[] {
  const path = join(SQL_DIR, fileName);
  if (!existsSync(path)) throw new Error(`Missing source file: ${path}`);
  const { rows } = parseInserts(readFileSync(path, "utf-8"));
  return rows;
}

async function batchCreate<T extends object>(label: string, rows: T[], create: (chunk: T[]) => Promise<{ count: number }>) {
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = await create(chunk);
    inserted += result.count;
  }
  console.log(`${label}: parsed ${rows.length}, inserted ${inserted} (skipped ${rows.length - inserted} already present)`);
}

async function main() {
  console.log(`Reading EMB-Check reference data from: ${SQL_DIR}\n`);

  await batchCreate(
    "countries",
    loadFile("countries.sql").map((r) => ({
      cySeq: r.CY_SEQ as number,
      cyId: r.CY_ID as string,
      cyName: r.CY_NAME as string | null,
      cyShortName: r.CY_SHRT_NAME as string | null,
      cyIndEmbargoed: r.CY_IND_EMBARGOED as string | null,
      cyIndBoycotted: r.CY_IND_BOYCOTTED as string | null,
      cyIndEms: r.CY_IND_EMS as string | null,
      cyIndGlds: r.CY_IND_GLDS as string | null,
      cyIndLds: r.CY_IND_LDS as string | null,
      cyIndDps: r.CY_IND_DPS as string | null,
    })),
    (chunk) => db.country.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "country_groups",
    loadFile("country_groups.sql").map((r) => ({
      cygSeq: r.CYG_SEQ as number,
      cygId: r.CYG_ID as string,
      cygShortName: r.CYG_SHRT_NAME as string,
      cygDesc: r.CYG_DESC as string | null,
      cygIndHts: r.CYG_IND_HTS as string | null,
    })),
    (chunk) => db.countryGroup.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "country_group_maps",
    loadFile("country_group_maps.sql").map((r) => ({
      cygrmSeq: r.CYGRM_SEQ as number,
      countryId: r.COUNTRY_ID as string,
      groupId: r.GROUP_ID as string,
      cygrmEffectiveDt: r.CYGRM_EFFECTIVE_DT as Date | null,
      cygrmExpirationDt: r.CYGRM_EXPIRATION_DT as Date | null,
    })),
    (chunk) => db.countryGroupMap.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "compliance_country_groups",
    loadFile("compliance_country_groups.sql").map((r) => ({
      ccgSeq: r.CCG_SEQ as number,
      ccgId: r.CCG_ID as string | null,
      ccgDesc: r.CCG_DESC as string | null,
    })),
    (chunk) => db.complianceCountryGroup.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "cy_ccg_maps",
    loadFile("cy_ccg_maps.sql").map((r) => ({
      cygmSeq: r.CYGM_SEQ as number,
      countryId: r.COUNTRY_ID as string,
      complianceGroupId: r.COMPLIANCE_GROUP_ID as string,
    })),
    (chunk) => db.cyCcgMap.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "country_by_country_maps",
    loadFile("country_by_country_maps.sql").map((r) => ({
      cycySeq: r.CYCY_SEQ as number,
      complianceCountry: r.COMPLIANCE_COUNTRY as string,
      complianceCountryName: r.COMPLIANCE_COUNTRY_NAME as string | null,
      embargoedCountry: r.EMBARGOED_COUNTRY as string,
      embargoedCountryName: r.EMBARGOED_COUNTRY_NAME as string | null,
      cycyIndEmbargoed: r.CYCY_IND_EMBARGOED as string | null,
      cycyIndNationalSanction: r.CYCY_IND_NATIONAL_SANCTION as string | null,
      cycyIndEuSanction: r.CYCY_IND_EU_SANCTION as string | null,
      cycyIndUnSanction: r.CYCY_IND_UN_SANCTION as string | null,
    })),
    (chunk) => db.countryByCountryMap.createMany({ data: chunk, skipDuplicates: true })
  );

  await batchCreate(
    "commerce_control_list",
    loadFile("commerce_control_list.sql").map((r) => ({
      cclSeq: r.CCL_SEQ as number,
      cclId: r.CCL_ID as string,
      cclDesc: r.CCL_DESC as string,
      cclCountry: r.CCL_COUNTRY as string | null,
      cclIndUn: r.CCL_IND_UN as string | null,
      cclIndOfacCtl: r.CCL_IND_OFAC_CTL as string | null,
      cclLicensable: r.CCL_LICENSABLE as string | null,
    })),
    (chunk) => db.commerceControlList.createMany({ data: chunk, skipDuplicates: true })
  );

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
