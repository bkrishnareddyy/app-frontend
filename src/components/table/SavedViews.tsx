"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Check, Trash2 } from "lucide-react";
import {
  type SavedView,
  isActiveView,
  parseSavedViews,
  removeSavedView,
  savedViewHref,
  savedViewStorageKey,
  upsertSavedView,
} from "@/modules/tables/savedViews";

interface SavedViewsProps {
  /** Stable id for the table; views are stored per table. */
  tableId: string;
  label: string;
}

/** localStorage only notifies other tabs, so same-tab writes announce themselves. */
const LOCAL_WRITE_EVENT = "qubere:saved-views";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_WRITE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_WRITE_EVENT, onChange);
  };
}

/**
 * A saved view is this browser's shortcut to a query string. It is not shared
 * with the account, so it is labelled as local rather than presented as a
 * team-wide view nobody else can see.
 */
export function SavedViews({ tableId, label }: SavedViewsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();

  const [name, setName] = useState("");
  const [isNaming, setIsNaming] = useState(false);

  const storageKey = savedViewStorageKey(tableId);

  const stored = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(storageKey),
    () => null
  );
  const views = useMemo(() => parseSavedViews(stored), [stored]);

  function persist(next: SavedView[]) {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    persist(upsertSavedView(views, name, currentQuery));
    setName("");
    setIsNaming(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">
        Saved views
      </span>

      {views.length === 0 ? (
        <span className="text-xs text-[#86868B]">None saved on this device</span>
      ) : (
        views.map((view) => {
          const active = isActiveView(view, currentQuery);
          return (
            <span key={view.name} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => router.push(savedViewHref(pathname, view))}
                aria-current={active ? "true" : undefined}
                className={`inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-l-xl border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3] ${
                  active
                    ? "border-[#0071E3] bg-[#0071E3]/10 text-[#0071E3]"
                    : "border-[#E5E5EA] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7]"
                }`}
              >
                {active ? (
                  <Check className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <Bookmark className="w-3 h-3" aria-hidden="true" />
                )}
                <span>{view.name}</span>
              </button>
              <button
                type="button"
                onClick={() => persist(removeSavedView(views, view.name))}
                aria-label={`Delete saved view ${view.name}`}
                className="inline-flex items-center px-2 py-1 rounded-r-xl border border-l-0 border-[#E5E5EA] bg-white text-[#86868B] hover:text-red-600 hover:bg-[#F5F5F7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          );
        })
      )}

      {isNaming ? (
        <form onSubmit={handleSave} className="flex items-center gap-1.5">
          <label htmlFor={`saved-view-name-${tableId}`} className="sr-only">
            Name for this {label} view
          </label>
          <input
            id={`saved-view-name-${tableId}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="View name"
            autoFocus
            className="px-2.5 py-1 w-36 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3]"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded-xl bg-[#0071E3] text-white text-xs font-semibold hover:bg-[#0077ED] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setIsNaming(false)}
            className="px-2.5 py-1 rounded-xl border border-[#E5E5EA] bg-white text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsNaming(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-dashed border-[#C7C7CC] bg-white text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
        >
          <Bookmark className="w-3 h-3" aria-hidden="true" />
          <span>Save this view</span>
        </button>
      )}
    </div>
  );
}
