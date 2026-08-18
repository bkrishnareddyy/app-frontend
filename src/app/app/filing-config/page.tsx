import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getAccountContext } from "@/lib/auth";
import { getFilingConfigTableMeta, type FilingConfigTableKey } from "@/modules/filingConfig/registry";
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
            Filing Configuration edits the global rules every tenant&apos;s customs filings resolve against. It&apos;s available to Qubere Platform Administrators only.
          </p>
          <Link href="/app/dashboard" className="inline-block text-sm font-semibold text-brand">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Get table metadata - extract only serializable parts (no functions/schemas)
  const tableKeys: FilingConfigTableKey[] = [
    "transaction-type",
    "action-catalog",
    "procedure-config",
    "action-message-mapping",
    "action-configuration",
    "action-data-requirement",
    "ui-configuration",
    // "master-data-source" - removed, will implement later
  ];
  
  const tables: TableMeta[] = await Promise.all(
    tableKeys.map(async (key) => {
      const tableMeta = await getFilingConfigTableMeta(key);
      // Extract only serializable properties for client component
      return {
        key,
        label: tableMeta.label,
        description: tableMeta.description,
        idField: tableMeta.idField,
        fields: tableMeta.fields,
      };
    })
  );

  return <FilingConfigClient tables={tables} />;
}
