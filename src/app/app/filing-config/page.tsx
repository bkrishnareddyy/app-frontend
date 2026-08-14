import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { FILING_CONFIG_TABLES, type FilingConfigTableKey } from "@/modules/filingConfig/registry";
import { FilingConfigClient, type TableMeta } from "./FilingConfigClient";

export default async function FilingConfigPage() {
  const context = await getAccountContext();
  if (!context) return null;

  if (!context.isPlatformAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="apple-card p-8 rounded-3xl border border-red-200 bg-white max-w-md text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-ink">Platform Admin Access Restricted</h1>
          <p className="text-sm text-ink-muted">
            Filing Configuration edits the global rules every tenant's customs filings resolve against. It's available to Qubere Platform Administrators only.
          </p>
          <Link href="/app/dashboard" className="inline-block text-sm font-semibold text-brand">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Function-valued properties (list/create/update/remove) can't cross the
  // server->client boundary -- only the plain, serializable metadata is sent.
  const tables: TableMeta[] = (Object.keys(FILING_CONFIG_TABLES) as FilingConfigTableKey[]).map((key) => {
    const t = FILING_CONFIG_TABLES[key];
    return { key, label: t.label, description: t.description, idField: t.idField, fields: t.fields };
  });

  return <FilingConfigClient tables={tables} />;
}
