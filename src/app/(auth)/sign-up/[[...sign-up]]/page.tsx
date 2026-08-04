"use client";

import { SignUp, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";

export default function SignUpPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && isSignedIn && user) {
      router.push("/app/dashboard");
    }
  }, [isLoaded, isSignedIn, user, router]);

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col justify-center items-center px-6 relative py-12 selection:bg-[#0071E3]/20 selection:text-[#0071E3]">
      <div className="mb-8 text-center max-w-md">
        <Link href="/" className="inline-flex items-center space-x-3 group mb-4">
          <div className="w-11 h-11 rounded-2xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#1D1D1F]">Qubere</span>
        </Link>
        <h1 className="text-2xl font-bold text-[#1D1D1F]">Get Started with Qubere</h1>
        <p className="text-[#86868B] text-sm mt-1">Create your personal workspace or access your invitations</p>
      </div>

      <div className="apple-card p-4 rounded-2xl border border-[#E5E5EA] shadow-lg max-w-md w-full">
        <SignUp
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
    </div>
  );
}
