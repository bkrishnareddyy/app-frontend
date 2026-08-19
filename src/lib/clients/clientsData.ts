import { db } from "@/lib/db";
import type { AccountContext } from "@/lib/auth";

export interface FormattedCustomsProfile {
  id: string;
  cbpImporterNumber: string | null;
  ein: string | null;
  bondType: string | null;
  bondNumber: string | null;
  powerOfAttorneyStatus: string;
  active: boolean;
}

export interface FormattedLegalEntity {
  id: string;
  legalName: string;
  tradeName: string | null;
  entityType: string;
  country: string;
  taxIdentifier: string | null;
  status: string;
  customsProfiles: FormattedCustomsProfile[];
}

export interface FormattedClient {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  createdAt: string;
  shipmentCount: number;
  productCount: number;
  partyCount: number;
  legalEntities: FormattedLegalEntity[];
}

export interface ClientsData {
  clients: FormattedClient[];
}

export async function getClientsData(ctx: AccountContext): Promise<ClientsData> {
  const clients = await db.client.findMany({
    where: { accountId: ctx.accountId },
    include: {
      _count: { select: { shipments: true, products: true, parties: true } },
      legalEntities: {
        include: { customsProfiles: true },
        orderBy: { legalName: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      shipmentCount: c._count.shipments,
      productCount: c._count.products,
      partyCount: c._count.parties,
      legalEntities: c.legalEntities.map((le) => ({
        id: le.id,
        legalName: le.legalName,
        tradeName: le.tradeName,
        entityType: le.entityType,
        country: le.country,
        taxIdentifier: le.taxIdentifier,
        status: le.status,
        customsProfiles: le.customsProfiles.map((cp) => ({
          id: cp.id,
          cbpImporterNumber: cp.cbpImporterNumber,
          ein: cp.ein,
          bondType: cp.bondType,
          bondNumber: cp.bondNumber,
          powerOfAttorneyStatus: cp.powerOfAttorneyStatus,
          active: cp.active,
        })),
      })),
    })),
  };
}
