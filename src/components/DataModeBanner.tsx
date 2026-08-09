import { AlertTriangle } from "lucide-react";
import { dataModeBannerCopy, type DataMode } from "@/lib/dataMode";

/**
 * Persistent, unmistakable banner shown on every authenticated page of a
 * non-production workspace. Production workspaces render nothing.
 */
export function DataModeBanner({ dataMode }: { dataMode: DataMode }) {
  const copy = dataModeBannerCopy(dataMode);
  if (!copy) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-start gap-3 border-b-2 border-amber-500 bg-amber-100 px-4 py-3 text-amber-950 sm:px-6"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="text-sm">
        <span className="font-bold uppercase tracking-wide">{copy.label}</span>
        <span className="mx-2" aria-hidden="true">
          •
        </span>
        <span>{copy.description}</span>
      </p>
    </div>
  );
}
