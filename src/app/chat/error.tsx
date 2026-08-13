"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Sparkles, RefreshCw, LayoutDashboard } from "lucide-react";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Chat page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl">
        <div className="w-12 h-12 bg-brand/20 text-brand rounded-2xl flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6 text-sky-400" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-100">Unable to load Ask Qubere</h2>
          <p className="text-sm text-slate-400">
            {error?.message || "An unexpected error occurred while initializing the chat assistant."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-medium text-sm transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Reload page
          </button>
          <Link
            href="/app/dashboard"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all"
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
