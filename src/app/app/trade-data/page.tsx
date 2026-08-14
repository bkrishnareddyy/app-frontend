import Link from "next/link";
import { Package, Landmark, Database, ChevronRight } from "lucide-react";
import { getAccountContext } from "@/lib/auth";

export const metadata = {
  title: "Trade Data | Qubere",
  description: "Products and party master data for customs compliance.",
};

const TOOLS = [
  {
    id: "products",
    href: "/app/products",
    icon: Package,
    label: "Products",
    description:
      "Maintain your item master with HTS classifications, country of origin determinations, and composition details for every SKU you import.",
    accent: "from-violet-500 to-purple-400",
  },
  {
    id: "parties",
    href: "/app/parties",
    icon: Landmark,
    label: "Parties",
    description:
      "Manage importers, exporters, manufacturers, and intermediaries. Screen parties, verify registrations, and keep relationships current.",
    accent: "from-teal-500 to-emerald-400",
  },
] as const;

export default async function TradeDataPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Page header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <span>Tooling &amp; Docs</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">Trade Data</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-400 flex items-center justify-center shadow-sm shadow-violet-500/20">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Trade Data</h1>
            <p className="text-sm text-ink-muted">
              Products and parties — your master data for every entry.
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
