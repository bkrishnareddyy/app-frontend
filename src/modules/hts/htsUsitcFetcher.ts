import { HtsRawItem } from "./htsIngestionService";

// USITC's real export API (verified against the live endpoint):
// https://hts.usitc.gov/reststop/exportList?from=<code>&to=<code>&format=JSON&styles=true
// It rejects a single request spanning the whole schedule (~99 chapters) --
// tested empirically, a multi-chapter span like 0101-0500 works but the
// full 0101-9999 range 400s, most likely a response-size cap. So this
// fetches one chapter (2-digit HS chapter number, 01-99) per request and
// concatenates the results, in a fixed order, so the combined output is
// deterministic run-to-run when nothing has actually changed -- that
// determinism is what lets HtsIngestionService's checksum-based duplicate
// detection correctly treat "nothing changed tonight" as a no-op instead
// of staging a spurious new release every night.
const USITC_EXPORT_BASE = "https://hts.usitc.gov/reststop/exportList";
const CHAPTER_FETCH_TIMEOUT_MS = 20_000;

export interface ChapterFetchResult {
  chapter: string;
  itemCount: number;
  ok: boolean;
  error?: string;
}

export interface FullScheduleFetchResult {
  items: HtsRawItem[];
  chapterResults: ChapterFetchResult[];
}

async function fetchChapter(chapter: string): Promise<{ items: HtsRawItem[]; result: ChapterFetchResult }> {
  const from = `${chapter}01`;
  const to = `${chapter}99`;
  const url = `${USITC_EXPORT_BASE}?from=${from}&to=${to}&format=JSON&styles=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAPTER_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // Some chapter numbers (e.g. 77) are reserved/unused by the HTS and
      // legitimately return an error or empty body -- treated as "no items
      // this chapter", not a fatal failure of the whole run.
      return { items: [], result: { chapter, itemCount: 0, ok: false, error: `HTTP ${res.status}` } };
    }
    const data = await res.json();
    const items: HtsRawItem[] = Array.isArray(data) ? data : [];
    return { items, result: { chapter, itemCount: items.length, ok: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { items: [], result: { chapter, itemCount: 0, ok: false, error: message } };
  } finally {
    clearTimeout(timeout);
  }
}

// USITC known reserved / empty chapters in standard HTS (e.g., chapter 77 is reserved for future international use)
export const RESERVED_CHAPTERS = new Set(["77"]);
export const MIN_EXPECTED_SCHEDULE_ITEMS = 1000;

export class HtsUsitcFetcher {
  /**
   * Validates whether a fetched schedule passes the completeness gate.
   * Throws an Error if non-reserved chapters failed or item count is below the minimum threshold.
   */
  static validateCompleteness(
    result: FullScheduleFetchResult,
    minItems: number = MIN_EXPECTED_SCHEDULE_ITEMS
  ): { valid: boolean; reason?: string } {
    const failedUnreserved = result.chapterResults.filter(
      (c) => !c.ok && !RESERVED_CHAPTERS.has(c.chapter)
    );

    if (failedUnreserved.length > 0) {
      const failedList = failedUnreserved.map((c) => `Ch ${c.chapter} (${c.error})`).join(", ");
      return {
        valid: false,
        reason: `Completeness gate failed: Non-reserved chapters failed to fetch: [${failedList}]`,
      };
    }

    if (result.items.length < minItems) {
      return {
        valid: false,
        reason: `Completeness gate failed: Total schedule items (${result.items.length}) is below required minimum threshold (${minItems}).`,
      };
    }

    return { valid: true };
  }

  /**
   * Fetches the full current US HTS schedule from USITC, chapter by
   * chapter (01-99). A chapter that fails or is reserved contributes zero
   * items and is recorded in chapterResults.
   */
  static async fetchFullSchedule(): Promise<FullScheduleFetchResult> {
    const items: HtsRawItem[] = [];
    const chapterResults: ChapterFetchResult[] = [];

    for (let n = 1; n <= 99; n++) {
      const chapter = String(n).padStart(2, "0");
      const { items: chapterItems, result } = await fetchChapter(chapter);

      // If chapter fetch returned OK, validate item structure
      if (result.ok && chapterItems.length > 0) {
        const validItems = chapterItems.filter(
          (item) => item && (item.htsno || item.description)
        );
        chapterResults.push({ ...result, itemCount: validItems.length });
        items.push(...validItems);
      } else {
        chapterResults.push(result);
        items.push(...chapterItems);
      }
    }

    return { items, chapterResults };
  }
}

