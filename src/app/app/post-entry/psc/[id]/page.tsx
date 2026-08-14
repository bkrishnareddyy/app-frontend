import { getAccountContext } from "@/lib/auth";
import { PscDetailClient } from "./PscDetailClient";

export const metadata = {
  title: "PSC Details | Qubere",
  description: "View and manage Post-Summary Correction status and filings.",
};

export default async function PscDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  const { id } = await params;
  return <PscDetailClient pscId={id} />;
}
