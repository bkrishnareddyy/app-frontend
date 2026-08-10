import { getAccountContext } from "@/lib/auth";
import { getSettingsAuditData } from "@/lib/admin/auditData";
import { SettingsAuditPanel } from "./SettingsAuditPanel";

export default async function AdminSettingsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const data = await getSettingsAuditData(context);

  return <SettingsAuditPanel accountName={context.accountName} {...data} />;
}
