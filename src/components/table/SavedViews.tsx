"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
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
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Saved views
      </span>

      {views.length === 0 ? (
        <span className="text-xs text-ink-muted">None saved on this device</span>
      ) : (
        views.map((view) => {
          const active = isActiveView(view, currentQuery);
          return (
            <span key={view.name} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => router.push(savedViewHref(pathname, view))}
                aria-current={active ? "true" : undefined}
                className={`inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-l-xl border text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-white text-ink hover:bg-surface-muted"
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
                className="inline-flex items-center px-2 py-1 rounded-r-xl border border-l-0 border-border bg-white text-ink-muted hover:text-red-600 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          );
        })
      )}

      {isNaming ? (
        <form onSubmit={handleSave} className="flex items-center gap-1.5">
          <Label htmlFor={`saved-view-name-${tableId}`} className="sr-only">
            Name for this {label} view
          </Label>
          <Input
            id={`saved-view-name-${tableId}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="View name"
            autoFocus
            className="w-36 px-2.5 py-1 bg-white focus:ring-0"
          />
          <Button
            type="submit"
            size="sm"
            className="px-2.5 py-1 rounded-xl shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsNaming(false)}
            className="px-2.5 py-1 rounded-xl shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsNaming(true)}
          className="gap-1 px-2.5 py-1 rounded-xl border-dashed border-[#C7C7CC] shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Bookmark className="w-3 h-3" aria-hidden="true" />
          <span>Save this view</span>
        </Button>
      )}
    </div>
  );
}
