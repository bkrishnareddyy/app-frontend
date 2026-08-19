import { getAccountContext } from "@/lib/auth";
import { BondsClient } from "./BondsClient";

export default async function BondsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  return <BondsClient accountName={context.accountName} />;
}
