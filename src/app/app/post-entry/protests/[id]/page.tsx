import { getAccountContext } from "@/lib/auth";
import { ProtestDetailClient } from "./ProtestDetailClient";

export const metadata = {
  title: "Protest Details | Qubere",
  description: "View and manage CBP Form 19 Protest status and legal grounds.",
};

export default async function ProtestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  const { id } = await params;
  return <ProtestDetailClient protestId={id} />;
}
