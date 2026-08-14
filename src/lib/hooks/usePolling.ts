"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `callback` immediately, then every `intervalMs` — but skips ticks
 * while the tab is hidden and catches up with an immediate call when it
 * becomes visible again, so background tabs don't keep hitting the API.
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };

    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
