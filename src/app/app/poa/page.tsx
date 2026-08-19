import { getAccountContext } from "@/lib/auth";
import { PoaClient } from "./PoaClient";

export default async function PoaPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  return <PoaClient accountName={context.accountName} />;
}
