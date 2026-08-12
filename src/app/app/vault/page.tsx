import { getAccountContext } from "@/lib/auth";
import { VaultClient } from "./VaultClient";

export default async function VaultPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  return <VaultClient />;
}
