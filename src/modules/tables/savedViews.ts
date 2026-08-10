/**
 * Saved views are a stored query string per table, nothing more.
 *
 * Pure so the parsing can be asserted without a browser; the component owns
 * localStorage. Stored data is user input from a previous session, so it is
 * validated on read rather than trusted.
 */

export const SAVED_VIEW_LIMIT = 20;
export const SAVED_VIEW_NAME_MAX = 60;

export interface SavedView {
  name: string;
  /** Query string without the leading `?`. Empty means the unfiltered table. */
  query: string;
}

export function savedViewStorageKey(tableId: string): string {
  return `qubere.savedViews.${tableId}`;
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" && typeof candidate.query === "string";
}

export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupted entry is discarded rather than crashing the table it decorates.
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isSavedView)
    .map((view) => ({
      name: view.name.trim().slice(0, SAVED_VIEW_NAME_MAX),
      // Re-serialising drops anything that is not a well-formed parameter pair.
      query: new URLSearchParams(view.query).toString(),
    }))
    .filter((view) => view.name.length > 0)
    .slice(0, SAVED_VIEW_LIMIT);
}

/** Saving under an existing name replaces it, so a view can be updated in place. */
export function upsertSavedView(
  views: readonly SavedView[],
  name: string,
  query: string
): SavedView[] {
  const trimmedName = name.trim().slice(0, SAVED_VIEW_NAME_MAX);
  if (!trimmedName) return [...views];

  const next: SavedView = { name: trimmedName, query: new URLSearchParams(query).toString() };
  const without = views.filter((view) => view.name !== trimmedName);

  return [next, ...without].slice(0, SAVED_VIEW_LIMIT);
}

export function removeSavedView(views: readonly SavedView[], name: string): SavedView[] {
  return views.filter((view) => view.name !== name);
}

export function savedViewHref(basePath: string, view: SavedView): string {
  return view.query ? `${basePath}?${view.query}` : basePath;
}

/** A view matches when it selects the same records, not when the URL is identical. */
export function isActiveView(view: SavedView, current: string): boolean {
  const a = new URLSearchParams(view.query);
  const b = new URLSearchParams(current);
  a.sort();
  b.sort();
  return a.toString() === b.toString();
}
