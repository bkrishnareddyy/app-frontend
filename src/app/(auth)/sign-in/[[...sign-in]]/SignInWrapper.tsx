"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Code2 } from "lucide-react";
import { SignIn } from "@clerk/nextjs";
import { ApiStatusDrawer } from "@/components/ApiStatusDrawer";

export function SignInWrapper() {
  const [isApiDrawerOpen, setIsApiDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col justify-center items-center px-6 relative selection:bg-[#0071E3]/20 selection:text-[#0071E3]">
      {/* Top Header Controls */}
      <div className="absolute top-6 right-6 flex items-center space-x-3">
        <button
          onClick={() => setIsApiDrawerOpen(true)}
          className="px-4 py-2 text-xs font-bold bg-white hover:bg-slate-50 text-[#0071E3] border border-[#E5E5EA] rounded-full shadow-2xs transition-all flex items-center space-x-1.5 cursor-pointer hover:scale-105"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>API Specifications</span>
        </button>
      </div>

      <div className="mb-8 text-center max-w-md">
        <Link href="/" className="inline-flex items-center space-x-3 group mb-4">
          <div className="w-11 h-11 rounded-2xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#1D1D1F]">Qubere</span>
        </Link>
        <h1 className="text-2xl font-bold text-[#1D1D1F]">Sign In</h1>
        <p className="text-[#86868B] text-sm mt-1">Access your enterprise trade compliance workspace</p>
      </div>

      <div className="apple-card p-4 rounded-2xl border border-[#E5E5EA] shadow-lg max-w-md w-full">
        <SignIn
          forceRedirectUrl="/app/dashboard"
          appearance={{
            elements: {
              card: "bg-transparent shadow-none",
              headerTitle: "text-[#1D1D1F] text-lg font-bold",
              headerSubtitle: "text-[#86868B] text-sm",
              socialButtonsBlockButton: "bg-white border-[#E5E5EA] text-[#1D1D1F] hover:bg-slate-50",
              formFieldLabel: "text-[#1D1D1F] text-xs font-semibold",
              formFieldInput: "bg-white border-[#E5E5EA] text-[#1D1D1F] rounded-xl focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3]",
              formButtonPrimary: "bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full py-3 shadow-md shadow-[#0071E3]/20 transition-all",
              footerActionLink: "text-[#0071E3] hover:text-[#0077ED] font-semibold",
            },
          }}
        />
      </div>

      <ApiStatusDrawer isOpen={isApiDrawerOpen} onClose={() => setIsApiDrawerOpen(false)} />
    </div>
  );
}
