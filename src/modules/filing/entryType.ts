/**
 * Entry type, in one vocabulary.
 *
 * Block 2 of the Form 7501 is a two-digit CBP entry type code. This column has
 * been written in at least three spellings — "01", "Consumption Entry" and
 * "01 - CONSUMPTION ENTRY" — by the create form, the filing API and the agents
 * respectively. Any filter, grouping or count over the column is wrong while
 * that is true, in the same way exception status was before it was canonicalised.
 *
 * The code is what is stored. The label is for display only.
 */

export interface EntryTypeDefinition {
  code: string;
  label: string;
  /** Spellings seen in stored data or in a person's typing. */
  aliases: readonly string[];
}

export const ENTRY_TYPES: readonly EntryTypeDefinition[] = [
  { code: "01", label: "Consumption", aliases: ["consumption entry", "consumption free and dutiable", "formal entry"] },
  { code: "02", label: "Consumption — Quota/Visa", aliases: ["quota visa"] },
  { code: "03", label: "Consumption — Antidumping/Countervailing Duty", aliases: ["antidumping", "countervailing", "ad cvd", "adcvd"] },
  { code: "06", label: "Consumption — Foreign Trade Zone", aliases: ["ftz", "foreign trade zone", "foreign trade zone entry"] },
  { code: "07", label: "Consumption — Quota/Visa and Antidumping/Countervailing Duty", aliases: [] },
  { code: "11", label: "Informal", aliases: ["informal entry"] },
  { code: "12", label: "Informal — Quota/Visa", aliases: [] },
  { code: "21", label: "Warehouse", aliases: ["warehouse entry"] },
  { code: "22", label: "Re-Warehouse", aliases: ["rewarehouse"] },
  { code: "23", label: "Temporary Importation under Bond", aliases: ["tib", "tib entry", "temporary importation bond"] },
  { code: "31", label: "Warehouse Withdrawal — Consumption", aliases: [] },
  { code: "32", label: "Warehouse Withdrawal — Quota", aliases: [] },
  { code: "34", label: "Warehouse Withdrawal — Antidumping/Countervailing Duty", aliases: [] },
  { code: "51", label: "Defense Contract Administration Service Region", aliases: ["dcasr"] },
  { code: "52", label: "Government — Dutiable", aliases: ["government entry"] },
  { code: "61", label: "Immediate Transportation", aliases: ["in bond entry", "inbond", "immediate transit", "it"] },
  { code: "62", label: "Transportation and Exportation", aliases: ["t and e", "te"] },
  { code: "63", label: "Immediate Exportation", aliases: ["ie"] },
];

export const ENTRY_TYPE_CODES: readonly string[] = ENTRY_TYPES.map((e) => e.code);

function collapse(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "T.I.B." and "TIB" are the same word typed two ways. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const BY_CODE = new Map(ENTRY_TYPES.map((e) => [e.code, e]));

const BY_TEXT = new Map<string, EntryTypeDefinition>();
const BY_SQUASH = new Map<string, EntryTypeDefinition>();
for (const definition of ENTRY_TYPES) {
  const spellings = [
    definition.label,
    `${definition.label} entry`,
    ...definition.aliases,
  ];
  for (const spelling of spellings) {
    BY_TEXT.set(collapse(spelling), definition);
    const squashed = squash(spelling);
    // First writer wins, so a short alias cannot steal another type's spelling.
    if (!BY_SQUASH.has(squashed)) BY_SQUASH.set(squashed, definition);
  }
}

/** Returns the two-digit code, or null when the value names no known entry type. */
export function normalizeEntryType(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;

  // "01", "1", "01 - CONSUMPTION ENTRY" and "Type 01" all lead with the code.
  const leadingDigits = value.match(/(?:^|\b)(\d{1,2})(?:\b|$)/);
  if (leadingDigits) {
    const padded = leadingDigits[1].padStart(2, "0");
    if (BY_CODE.has(padded)) return padded;
  }

  const collapsed = collapse(value);
  return BY_TEXT.get(collapsed)?.code ?? BY_SQUASH.get(squash(value))?.code ?? null;
}

export function isKnownEntryType(raw: string | null | undefined): boolean {
  return normalizeEntryType(raw) !== null;
}

/**
 * For writers that have nowhere honest to put an unknown. A filing row without
 * an entry type is a Form 7501 with Block 2 blank, so the write must not happen
 * rather than default to a consumption entry.
 */
export function requireEntryTypeCode(raw: string | null | undefined): string {
  const code = normalizeEntryType(raw);
  if (!code) {
    throw new Error(
      `An entry summary needs a CBP entry type. ${
        raw && raw.trim() ? `"${raw.trim()}" names none.` : "None was supplied."
      } Use one of: ${ENTRY_TYPE_CODES.join(", ")}.`
    );
  }
  return code;
}

export function entryTypeDefinition(raw: string | null | undefined): EntryTypeDefinition | null {
  const code = normalizeEntryType(raw);
  return code ? (BY_CODE.get(code) ?? null) : null;
}

/**
 * What a person reads. An unrecognised stored value is shown verbatim rather
 * than mapped to a guess, because the record really does hold that string.
 */
export function entryTypeLabel(
  raw: string | null | undefined,
  missingText = "Not provided"
): string {
  if (typeof raw !== "string" || raw.trim() === "") return missingText;
  const definition = entryTypeDefinition(raw);
  return definition ? `${definition.code} — ${definition.label}` : raw.trim();
}

/**
 * Every spelling a stored row might hold for one code, for filtering a column
 * that was written before it was canonicalised.
 */
export function entryTypeVariants(code: string): string[] {
  const definition = BY_CODE.get(code);
  if (!definition) return [code];
  return [
    definition.code,
    definition.label,
    `${definition.label} Entry`,
    `${definition.code} - ${definition.label.toUpperCase()}`,
  ];
}
