import { getAccountContext } from "@/lib/auth";
import { getClientsData } from "@/lib/clients/clientsData";
import { ClientsPanel } from "./ClientsPanel";

export default async function ClientsPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const data = await getClientsData(context);

  return <ClientsPanel accountName={context.accountName} {...data} />;
}
