import { Contact2 } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { ClientNavTabs } from "@/components/clients/ClientNavTabs";
import { ClientsTable } from "./ClientsTable";
import type { FormattedClient } from "@/lib/clients/clientsData";

interface ClientsPanelProps {
  accountName: string;
  clients: FormattedClient[];
  onSaved?: () => void;
  compact?: boolean;
}

export function ClientsPanel({ accountName, clients, onSaved, compact }: ClientsPanelProps) {
  return (
    <div className={compact ? "space-y-5" : "space-y-6 max-w-6xl mx-auto"}>
      <PanelHeading
        icon={Contact2}
        badge="Client Portfolio & Legal Entities"
        title="Clients & Legal Entities"
        subtitle={`Commercial clients, legal entities, and CBP customs profiles under ${accountName}.`}
        compact={compact}
      />

      {!compact && <ClientNavTabs />}

      <ClientsTable clients={clients} onSaved={onSaved} />
    </div>
  );
}
