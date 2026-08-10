"use client";

import { useEffect, useRef, useState } from "react";
import { Tag } from "lucide-react";
import { RELEASE_LOG, CURRENT_RELEASE } from "@/lib/version/releaseLog";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const runtimeCommit = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA?.slice(0, 7);
const displayCommit = runtimeCommit && runtimeCommit !== "unknown" ? runtimeCommit : CURRENT_RELEASE.commit;

export function VersionPill() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-semibold bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F] hover:border-[#0071E3] hover:text-[#0071E3] transition-colors cursor-pointer"
        title="View deployment history"
      >
        <Tag className="w-3.5 h-3.5" />
        <span>
          v{CURRENT_RELEASE.version} · {displayCommit}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-h-96 overflow-y-auto bg-white rounded-2xl border border-[#E5E5EA] shadow-2xl z-20 p-2">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#86868B]">
            Deployment History
          </p>
          <div className="space-y-1">
            {RELEASE_LOG.map((entry) => (
              <div key={entry.commit} className="px-3 py-2 rounded-xl hover:bg-[#F5F5F7] transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-[#1D1D1F]">
                    v{entry.version} · {entry.commit}
                  </span>
                  <span className="text-[10px] text-[#86868B] whitespace-nowrap">{formatDateTime(entry.date)}</span>
                </div>
                <p className="text-xs text-[#86868B] mt-1 leading-snug">
                  {entry.summary[0]}
                  <br />
                  {entry.summary[1]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
