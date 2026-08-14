import { getAccountContext } from "@/lib/auth";
import { PscNewClient } from "./PscNewClient";

export const metadata = {
  title: "New Post-Summary Correction | Qubere",
  description: "Create a new Post-Summary Correction (PSC) draft for CBP ACE entry summary.",
};

export default async function PscNewPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  return <PscNewClient />;
}
