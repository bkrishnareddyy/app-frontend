"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Code2 } from "lucide-react";
import { SignIn } from "@clerk/nextjs";
import { ApiStatusDrawer } from "@/components/ApiStatusDrawer";

export function SignInWrapper() {
  const [isApiDrawerOpen, setIsApiDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-muted flex flex-col justify-center items-center px-6 relative selection:bg-brand/20 selection:text-brand">
      {/* Top Header Controls */}
      <div className="absolute top-6 right-6 flex items-center space-x-3">
        <button
          onClick={() => setIsApiDrawerOpen(true)}
          className="px-4 py-2 text-xs font-bold bg-white hover:bg-slate-50 text-brand border border-border rounded-full shadow-2xs transition-all flex items-center space-x-1.5 cursor-pointer hover:scale-105"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>API Specifications</span>
        </button>
      </div>

      <div className="mb-8 text-center max-w-md">
        <Link href="/" className="inline-flex items-center space-x-3 group mb-4">
          <div className="w-11 h-11 rounded-2xl bg-brand flex items-center justify-center text-white shadow-md shadow-brand/20 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-ink">Qubere</span>
        </Link>
        <h1 className="text-2xl font-bold text-ink">Sign In</h1>
        <p className="text-ink-muted text-sm mt-1">Access your enterprise trade compliance workspace</p>
      </div>

      <div className="apple-card p-4 rounded-2xl border border-border shadow-lg max-w-md w-full">
        <SignIn
          forceRedirectUrl="/app/dashboard"
          appearance={{
            elements: {
              card: "bg-transparent shadow-none",
              headerTitle: "text-ink text-lg font-bold",
              headerSubtitle: "text-ink-muted text-sm",
              socialButtonsBlockButton: "bg-white border-border text-ink hover:bg-slate-50",
              formFieldLabel: "text-ink text-xs font-semibold",
              formFieldInput: "bg-white border-border text-ink rounded-xl focus:border-brand focus:ring-1 focus:ring-brand",
              formButtonPrimary: "bg-brand hover:bg-brand-hover text-white font-semibold rounded-full py-3 shadow-md shadow-brand/20 transition-all",
              footerActionLink: "text-brand hover:text-brand-hover font-semibold",
            },
          }}
        />
      </div>

      <ApiStatusDrawer isOpen={isApiDrawerOpen} onClose={() => setIsApiDrawerOpen(false)} />
    </div>
  );
}
