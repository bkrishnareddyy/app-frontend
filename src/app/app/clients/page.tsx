import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { ClientsTable } from "./ClientsTable";
import { Contact2 } from "lucide-react";

export default async function ClientsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const clients = await db.client.findMany({
    where: { accountId: context.accountId },
    include: { _count: { select: { shipments: true } } },
    orderBy: { name: "asc" },
  });

  const formattedClients = clients.map((c) => ({
    id: c.id,
    name: c.name,
    contactName: c.contactName,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    shipmentCount: c._count.shipments,
  }));

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
          <Contact2 className="w-3.5 h-3.5" />
          <span>Client Portfolio</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">Clients</h1>
        <p className="text-[#86868B] text-sm mt-1">
          Manage the customers you file shipments for under {context.accountName}.
        </p>
      </div>

      <ClientsTable clients={formattedClients} />
    </div>
  );
}
