import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, Building2 } from "lucide-react";
import { LandingPageHeader } from "@/components/LandingPageHeader";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export default async function LandingPage() {
  const { userId } = await auth();

  // If user is already authenticated, redirect straight to application dashboard
  if (userId) {
    redirect("/app/dashboard");
  }

  return (
    <div className="relative min-h-screen bg-surface-muted text-ink selection:bg-brand/20 selection:text-brand flex flex-col justify-between">
      {/* Top subtle ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-b from-brand/10 via-brand/5 to-transparent blur-3xl pointer-events-none -z-10 rounded-full" />

      {/* Navigation Header */}
      <LandingPageHeader />

      {/* Minimal Hero Section */}
      <main className="px-6 max-w-4xl mx-auto text-center my-auto py-16">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-ink max-w-3xl mx-auto leading-[1.08] mb-6">
          AI Customs Compliance <br />
          <span className="text-brand">
            Document-to-Filing Readiness
          </span>
        </h1>

        <p className="text-lg md:text-xl text-ink-muted max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Qubere helps customs and trade-compliance teams turn invoices and product data into evidence-backed, review-ready import decisions—before filing.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/sign-in"
            className={cn(
              buttonVariants({ variant: "primary", size: "lg" }),
              "w-full sm:w-auto px-8 py-3.5 text-base shadow-lg shadow-brand/20 hover:scale-[1.02]"
            )}
          >
            <span>Sign In</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/app/dashboard"
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "w-full sm:w-auto px-8 py-3.5 text-base hover:bg-slate-50 shadow-sm"
            )}
          >
            <Building2 className="w-4 h-4 text-brand" />
            <span>Go to App Console</span>
          </Link>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-border py-6 px-6 text-center text-ink-muted text-xs">
        <p>© {new Date().getFullYear()} Qubere Inc. All rights reserved. Trade Compliance AI Platform.</p>
      </footer>
    </div>
  );
}
