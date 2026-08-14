import { getAccountContext } from "@/lib/auth";
import { ProtestNewClient } from "./ProtestNewClient";

export const metadata = {
  title: "New Protest (Form 19) | Qubere",
  description: "Draft a new Form 19 protest challenging CBP entry summary liquidation.",
};

export default async function ProtestNewPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  return <ProtestNewClient />;
}
