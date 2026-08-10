"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import {
  Contact2,
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Package,
  Building2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Plus,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface CustomsProfileItem {
  id: string;
  cbpImporterNumber?: string | null;
  ein?: string | null;
  bondType?: string | null;
  bondNumber?: string | null;
  powerOfAttorneyStatus: string;
  active: boolean;
}

interface LegalEntityItem {
  id: string;
  legalName: string;
  tradeName?: string | null;
  entityType: string;
  country: string;
  taxIdentifier?: string | null;
  status: string;
  customsProfiles: CustomsProfileItem[];
}

interface ClientItem {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status: string;
  createdAt: string;
  shipmentCount: number;
  legalEntities: LegalEntityItem[];
}

interface ClientsTableProps {
  clients: ClientItem[];
  /** Called after any successful mutation, in addition to router.refresh(), so embedders that don't rely on the route's server data (e.g. a modal fetching client-side) can refresh their own copy. */
  onSaved?: () => void;
}

export function ClientsTable({ clients, onSaved }: ClientsTableProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(clients[0]?.id || null);

  // Legal Entity Modal State
  const [addEntityModalClient, setAddEntityModalClient] = useState<ClientItem | null>(null);
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [taxIdentifier, setTaxIdentifier] = useState("");
  const [cbpImporterNumber, setCbpImporterNumber] = useState("");
  const [addEntityLoading, setAddEntityLoading] = useState(false);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactName, contactEmail, contactPhone }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Client "${name}" added.` });
        setName("");
        setContactName("");
        setContactEmail("");
        setContactPhone("");
        router.refresh();
        onSaved?.();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to add client" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateLegalEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEntityModalClient) return;

    setAddEntityLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/legal-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: addEntityModalClient.id,
          legalName,
          tradeName,
          taxIdentifier,
          cbpImporterNumber,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: `Legal Entity "${legalName}" created under ${addEntityModalClient.name}.`,
        });
        setLegalName("");
        setTradeName("");
        setTaxIdentifier("");
        setCbpImporterNumber("");
        setAddEntityModalClient(null);
        router.refresh();
        onSaved?.();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create legal entity" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setAddEntityLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Add Client Form */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-4 flex items-center space-x-2">
          <UserPlus className="w-4 h-4 text-brand" />
          <span>Add Client</span>
        </h3>

        <form onSubmit={handleCreateClient} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <Label className="block mb-1 font-bold">Client Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Target Corporation"
              required
            />
          </div>
          <div>
            <Label className="block mb-1 font-bold">Contact Person</Label>
            <Input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Sarah Miller"
            />
          </div>
          <div>
            <Label className="block mb-1 font-bold">Email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="sarah@target.com"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={createLoading} className="w-full">
              {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>Add Client</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Clients & Legal Entities Table */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-bold text-ink flex items-center space-x-2">
            <Contact2 className="w-5 h-5 text-brand" />
            <span>Clients & Domain Entities ({clients.length})</span>
          </h3>
        </div>

        <div className="divide-y divide-border">
          {clients.length === 0 && (
            <div className="p-10 text-center text-ink-muted text-sm">
              No clients yet. Add your first commercial client above.
            </div>
          )}

          {clients.map((c) => {
            const isExpanded = expandedClientId === c.id;
            return (
              <div key={c.id} className="transition-colors">
                {/* Main Client Row */}
                <div
                  onClick={() => setExpandedClientId(isExpanded ? null : c.id)}
                  className="p-5 flex items-center justify-between hover:bg-surface-muted/60 cursor-pointer select-none transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <button className="text-ink-muted">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-ink text-base">{c.name}</span>
                        <Badge variant="info" className="font-extrabold">
                          {c.legalEntities.length} Legal {c.legalEntities.length === 1 ? "Entity" : "Entities"}
                        </Badge>
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {c.contactName || c.contactEmail ? (
                          <span>
                            Contact: {c.contactName} {c.contactEmail ? `(${c.contactEmail})` : ""}
                          </span>
                        ) : (
                          "No primary contact specified"
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6 text-xs text-ink-muted">
                    <div className="flex items-center space-x-1.5 font-medium">
                      <Package className="w-3.5 h-3.5 text-brand" />
                      <span>{c.shipmentCount} Shipments</span>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddEntityModalClient(c);
                      }}
                      className="rounded-xl text-brand"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Legal Entity</span>
                    </Button>
                  </div>
                </div>

                {/* Expanded Legal Entities & Customs Profiles Section */}
                {isExpanded && (
                  <div className="bg-surface-muted/40 p-6 border-t border-border space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-ink-muted flex items-center space-x-1.5">
                        <Building2 className="w-3.5 h-3.5 text-brand" />
                        <span>Legal Entities & Customs Profiles under {c.name}</span>
                      </h4>
                      <span className="text-[11px] text-ink-muted">
                        Domain Rule: <strong className="text-ink">Client ≠ Importer of Record</strong>
                      </span>
                    </div>

                    {c.legalEntities.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-white border border-border text-center text-xs text-ink-muted">
                        No legal entities registered yet for {c.name}. Click <strong>Add Legal Entity</strong> to attach a legal organization (e.g. Target USA Inc.) and CBP importer number.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {c.legalEntities.map((le) => (
                          <div
                            key={le.id}
                            className="p-4 rounded-2xl bg-white border border-border shadow-2xs space-y-3"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h5 className="font-bold text-ink text-sm flex items-center space-x-1.5">
                                  <span>{le.legalName}</span>
                                </h5>
                                {le.tradeName && (
                                  <p className="text-[11px] text-ink-muted">DBA / Trade: {le.tradeName}</p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-slate-100 text-slate-700">
                                {le.entityType}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted pt-2 border-t border-surface-muted">
                              <div>
                                <span className="block text-[10px] font-bold text-ink-muted uppercase">Country</span>
                                <span className="font-medium text-ink">{le.country}</span>
                              </div>
                              <div>
                                <span className="block text-[10px] font-bold text-ink-muted uppercase">Tax Identifier</span>
                                <span className="font-mono text-ink">{le.taxIdentifier || "Not specified"}</span>
                              </div>
                            </div>

                            {/* Customs Profiles */}
                            <div className="pt-2 border-t border-surface-muted">
                              <span className="text-[10px] font-extrabold text-ink-muted uppercase tracking-wider block mb-1.5 flex items-center space-x-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                <span>CBP Customs Profile</span>
                              </span>
                              {le.customsProfiles.length > 0 ? (
                                le.customsProfiles.map((cp) => (
                                  <div
                                    key={cp.id}
                                    className="p-2 rounded-xl bg-surface-muted text-xs flex items-center justify-between"
                                  >
                                    <div className="space-y-0.5">
                                      <span className="font-mono font-bold text-brand">
                                        CBP Importer #{cp.cbpImporterNumber || "Pending Assignment"}
                                      </span>
                                      <div className="text-[10px] text-ink-muted">
                                        POA Status: {cp.powerOfAttorneyStatus}
                                      </div>
                                    </div>
                                    <Badge variant="success" className="text-[9px]">
                                      Active
                                    </Badge>
                                  </div>
                                ))
                              ) : (
                                <p className="text-[11px] text-ink-muted italic">No Customs Profile assigned</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Legal Entity Modal */}
      {addEntityModalClient && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-border max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-lg font-bold text-ink">Add Legal Entity</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Register a legal entity and customs identity for <strong>{addEntityModalClient.name}</strong>.
                </p>
              </div>
              <button
                onClick={() => setAddEntityModalClient(null)}
                className="text-ink-muted hover:text-ink font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLegalEntity} className="space-y-4">
              <div>
                <Label className="block mb-1 font-bold">Legal Company Name *</Label>
                <Input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Target USA Inc."
                  required
                />
              </div>

              <div>
                <Label className="block mb-1 font-bold">Trade Name / DBA (Optional)</Label>
                <Input
                  type="text"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  placeholder="Target Brands"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="block mb-1 font-bold">Tax ID / EIN</Label>
                  <Input
                    type="text"
                    value={taxIdentifier}
                    onChange={(e) => setTaxIdentifier(e.target.value)}
                    placeholder="12-3456789"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label className="block mb-1 font-bold">CBP Importer #</Label>
                  <Input
                    type="text"
                    value={cbpImporterNumber}
                    onChange={(e) => setCbpImporterNumber(e.target.value)}
                    placeholder="12-345678900"
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAddEntityModalClient(null)}
                  className="px-4 py-2"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addEntityLoading}>
                  {addEntityLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Save Legal Entity</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
