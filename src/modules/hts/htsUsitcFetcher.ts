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
  } catch (err: any) {
    return { items: [], result: { chapter, itemCount: 0, ok: false, error: err?.message || String(err) } };
  } finally {
    clearTimeout(timeout);
  }
}

export class HtsUsitcFetcher {
  /**
   * Fetches the full current US HTS schedule from USITC, chapter by
   * chapter (01-99). A chapter that fails or is reserved contributes zero
   * items and is recorded in chapterResults rather than aborting the run.
   */
  static async fetchFullSchedule(): Promise<FullScheduleFetchResult> {
    const items: HtsRawItem[] = [];
    const chapterResults: ChapterFetchResult[] = [];

    for (let n = 1; n <= 99; n++) {
      const chapter = String(n).padStart(2, "0");
      const { items: chapterItems, result } = await fetchChapter(chapter);
      chapterResults.push(result);
      items.push(...chapterItems);
    }

    return { items, chapterResults };
  }
}
