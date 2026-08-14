import Link from "next/link";
import { Globe, Scale, BookOpen, ChevronRight } from "lucide-react";
import { getAccountContext } from "@/lib/auth";

export const metadata = {
  title: "Tariffs & Regulations | Qubere",
  description: "Regulatory intelligence and tariff simulation tools for brokers.",
};

const TOOLS = [
  {
    id: "regulatory",
    href: "/app/regulatory",
    icon: Globe,
    label: "Regulatory Updates",
    description:
      "Track live Federal Register notices, AD/CVD orders, Section 301 actions, and trade agreement changes. Get AI-summarised impact assessments for your portfolio.",
    accent: "from-sky-500 to-blue-400",
  },
  {
    id: "simulator",
    href: "/app/simulator",
    icon: Scale,
    label: "Tariff Simulator",
    description:
      "Model duty stacks before you file — base rates, Section 301 adders, AD/CVD, FTA preferences, and MPF. Compare scenarios and export the duty calc.",
    accent: "from-orange-500 to-amber-400",
  },
] as const;

export default async function TariffsPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Page header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <span>Tooling &amp; Docs</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">Tariffs &amp; Regulations</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-400 flex items-center justify-center shadow-sm shadow-sky-500/20">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Tariffs &amp; Regulations</h1>
            <p className="text-sm text-ink-muted">
              Regulatory intelligence and duty modelling for every entry.
            </p>
          </div>
        </div>
      </div>

      {/* Tool pills */}
      <div className="px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.id}
                href={tool.href}
                className="group relative flex flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-brand/30"
              >
                <div
                  className={`w-11 h-11 rounded-xl bg-gradient-to-br ${tool.accent} flex items-center justify-center shadow-sm`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-ink group-hover:text-brand transition-colors">
                    {tool.label}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted leading-relaxed">
                    {tool.description}
                  </p>
                </div>
                <ChevronRight className="absolute top-5 right-5 w-4 h-4 text-ink-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
