import { getAccountContext } from "@/lib/auth";
import { DocumentsClient } from "./DocumentsClient";

export default async function DocumentsPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  return <DocumentsClient accountName={ctx.accountName} />;
}
