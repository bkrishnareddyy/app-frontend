"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Focus management for modal dialogs.
 *
 * A dialog that does not trap focus is only visually modal: Tab walks straight
 * out of it into the page behind, which a keyboard or screen reader user cannot
 * see is still there. Escape must also close it, because the visible close
 * button may not be reachable once focus has escaped.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const containerRef = useRef<T | null>(null);
  // Read through a ref so a caller passing an inline arrow does not re-bind the
  // key listener on every render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const focusable = useCallback(() => {
    const root = containerRef.current;
    if (!root) return [] as HTMLElement[];
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the dialog itself rather than its first control, so a screen reader
    // announces the dialog before whatever happens to be at the top of it.
    containerRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === containerRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Returning focus to the control that opened the dialog is what makes the
      // dialog an excursion rather than a one-way trip.
      previouslyFocused?.focus?.();
    };
  }, [open, focusable]);

  return containerRef;
}

/** Props every dialog surface needs so the role and label are never forgotten. */
export function dialogSurfaceProps(labelledBy: string) {
  return {
    role: "dialog" as const,
    "aria-modal": true,
    "aria-labelledby": labelledBy,
    tabIndex: -1,
  };
}
