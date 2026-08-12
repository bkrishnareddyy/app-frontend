"use client";

import { Sparkles } from "lucide-react";
import { useCopilot } from "./CopilotProvider";

/**
 * The "Ask Qubere AI" entry point, in the app header next to the notification
 * bell.
 *
 * There was no such button before this feature; this is the whole of the new
 * chrome. It uses the app's existing header-control styling rather than a
 * gradient or a glow, because the Copilot is a Qubere feature and not a guest
 * from somewhere else. The label collapses to the icon below `sm`, where the
 * header is already tight.
 */
export function CopilotLauncher() {
  const { enabled, isOpen, toggle } = useCopilot();

  // Switched off for this deployment: no button, and the header is exactly as it
  // was before the feature existed.
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={isOpen}
      aria-controls="copilot-composer"
      title="Ask Qubere AI"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold text-ink-muted hover:text-ink hover:bg-white/70 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Sparkles className="w-4 h-4 text-brand" aria-hidden="true" />
      <span className="hidden sm:inline">Ask Qubere AI</span>
      <span className="sr-only sm:hidden">Ask Qubere AI</span>
    </button>
  );
}
