import { getAccountContext } from "@/lib/auth";
import { PscListClient } from "./PscListClient";

export const metadata = {
  title: "Post-Summary Corrections | Qubere",
  description: "Correct entry summaries before CBP liquidation within the 270-day window.",
};

export default async function PscListPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  return <PscListClient />;
}
