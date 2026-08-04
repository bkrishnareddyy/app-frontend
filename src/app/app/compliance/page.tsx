import { Scale, Sparkles } from "lucide-react";

export default function CompliancePlaceholderPage() {
  return (
    <div className="space-y-8 max-w-4xl mx-auto py-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
        <Scale className="w-8 h-8" />
      </div>
      <div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">Compliance Rules & Tariff Engine</h1>
        <p className="text-[#86868B] text-sm mt-2 max-w-md mx-auto">
          AI-driven Harmonized System (HS) classification, sanction list screening, and duty minimization rules will be introduced in Phase 2.
        </p>
      </div>
      <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-white border border-[#E5E5EA] text-xs text-[#86868B] font-mono shadow-2xs">
        <Sparkles className="w-4 h-4 text-indigo-600" />
        <span>Module Status: Scheduled for Phase 2 Deployment</span>
      </div>
    </div>
  );
}
