import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ShieldCheck, ArrowRight, Building2 } from "lucide-react";

export default async function LandingPage() {
  const { userId } = await auth();

  // If user is already authenticated, redirect straight to application dashboard
  if (userId) {
    redirect("/app/dashboard");
  }

  return (
    <div className="relative min-h-screen bg-[#F5F5F7] text-[#1D1D1F] selection:bg-[#0071E3]/20 selection:text-[#0071E3] flex flex-col justify-between">
      {/* Top subtle ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-b from-[#0071E3]/10 via-[#0071E3]/5 to-transparent blur-3xl pointer-events-none -z-10 rounded-full" />

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#F5F5F7]/80 backdrop-blur-md border-b border-[#E5E5EA]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1D1D1F]">Qubere</span>
          </Link>

          <nav className="flex items-center space-x-4">
            <Link
              href="/sign-in"
              className="px-4 py-2 text-sm font-medium text-[#1D1D1F] hover:text-[#0071E3] transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-2 text-sm font-medium bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Minimal Hero Section */}
      <main className="px-6 max-w-4xl mx-auto text-center my-auto py-16">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-[#1D1D1F] max-w-3xl mx-auto leading-[1.08] mb-6">
          AI Customs Compliance <br />
          <span className="text-[#0071E3]">
            Document-to-Filing Readiness
          </span>
        </h1>

        <p className="text-lg md:text-xl text-[#86868B] max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Qubere helps customs and trade-compliance teams turn invoices and product data into evidence-backed, review-ready import decisions—before filing.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="w-full sm:w-auto px-8 py-3.5 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full shadow-lg shadow-[#0071E3]/20 flex items-center justify-center space-x-2 transition-all hover:scale-[1.02]"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/app/dashboard"
            className="w-full sm:w-auto px-8 py-3.5 bg-white hover:bg-slate-50 text-[#1D1D1F] font-semibold rounded-full border border-[#E5E5EA] shadow-sm flex items-center justify-center space-x-2 transition-all"
          >
            <Building2 className="w-4 h-4 text-[#0071E3]" />
            <span>Go to App Console</span>
          </Link>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-[#E5E5EA] py-6 px-6 text-center text-[#86868B] text-xs">
        <p>© {new Date().getFullYear()} Qubere Inc. All rights reserved. Trade Compliance AI Platform.</p>
      </footer>
    </div>
  );
}
