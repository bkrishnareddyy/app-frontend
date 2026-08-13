"use client";

import { useState } from "react";
import { ExternalLink, HelpCircle } from "lucide-react";
import { QUBERE_WEBSITE_URL } from "@/lib/constants";

/**
 * Deliberately one item. There is no real documentation or help-center
 * destination in this app yet -- add entries above "About Qubere" here
 * once one exists, rather than linking to something that isn't there.
 */
export function HelpMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="relative flex items-center shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape") setIsOpen(false);
      }}
    >
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="p-2 rounded-full hover:bg-surface-muted transition-colors cursor-pointer"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <HelpCircle className="w-5 h-5 text-ink-muted" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            role="menu"
            aria-label="Help"
            className="absolute right-0 top-full mt-2 w-56 bg-white border border-border rounded-2xl shadow-lg z-20 overflow-hidden p-1.5"
          >
            <a
              role="menuitem"
              href={QUBERE_WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-ink hover:bg-surface-muted transition-colors cursor-pointer"
            >
              <span>About Qubere</span>
              <ExternalLink className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
