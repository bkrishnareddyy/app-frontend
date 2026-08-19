import { getAccountContext } from "@/lib/auth";
import { ImportersClient } from "./ImportersClient";

export default async function ImportersPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  return <ImportersClient accountName={context.accountName} />;
}
