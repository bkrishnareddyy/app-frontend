import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { RegulatoryClient } from "./RegulatoryClient";

export default async function RegulatoryIntelligencePage() {
  const context = await getAccountContext();
  if (!context) return null;

  const updates = await db.regulatoryUpdate.findMany({
    orderBy: { effectiveDate: "desc" },
  });

  // Map to matching client-side updates shape
  const formattedUpdates = updates.map((u) => ({
    id: u.id,
    title: u.title,
    description: u.description,
    jurisdiction: u.jurisdiction,
    category: u.category,
    impactLevel: u.impactLevel,
    effectiveDate: u.effectiveDate.toISOString(),
    affectedShipmentsCount: u.affectedShipmentsCount,
    publishedText: u.publishedText,
    status: u.status,
    documentNumber: u.documentNumber,
    metadata: u.metadata,
  }));

  return <RegulatoryClient initialUpdates={formattedUpdates} />;
}
