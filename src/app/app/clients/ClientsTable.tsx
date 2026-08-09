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
}

export function ClientsTable({ clients }: ClientsTableProps) {
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
      <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-4 flex items-center space-x-2">
          <UserPlus className="w-4 h-4 text-[#0071E3]" />
          <span>Add Client</span>
        </h3>

        <form onSubmit={handleCreateClient} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Client Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Target Corporation"
              required
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Contact Person</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Sarah Miller"
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="sarah@target.com"
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={createLoading}
              className="w-full py-2.5 px-4 bg-[#0071E3] text-white text-xs font-bold rounded-xl hover:bg-[#0071E3]/90 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>Add Client</span>
            </button>
          </div>
        </form>
      </div>

      {/* Clients & Legal Entities Table */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA]">
          <h3 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <Contact2 className="w-5 h-5 text-[#0071E3]" />
            <span>Clients & Domain Entities ({clients.length})</span>
          </h3>
        </div>

        <div className="divide-y divide-[#E5E5EA]">
          {clients.length === 0 && (
            <div className="p-10 text-center text-[#86868B] text-sm">
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
                  className="p-5 flex items-center justify-between hover:bg-[#F5F5F7]/60 cursor-pointer select-none transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <button className="text-[#86868B]">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-[#1D1D1F] text-base">{c.name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-50 text-[#0071E3] border border-blue-100">
                          {c.legalEntities.length} Legal {c.legalEntities.length === 1 ? "Entity" : "Entities"}
                        </span>
                      </div>
                      <p className="text-xs text-[#86868B] mt-0.5">
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

                  <div className="flex items-center space-x-6 text-xs text-[#86868B]">
                    <div className="flex items-center space-x-1.5 font-medium">
                      <Package className="w-3.5 h-3.5 text-[#0071E3]" />
                      <span>{c.shipmentCount} Shipments</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddEntityModalClient(c);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[#E5E5EA] text-[#0071E3] font-bold text-xs hover:bg-[#F5F5F7] transition-all flex items-center space-x-1.5 shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Legal Entity</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Legal Entities & Customs Profiles Section */}
                {isExpanded && (
                  <div className="bg-[#F5F5F7]/40 p-6 border-t border-[#E5E5EA] space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#86868B] flex items-center space-x-1.5">
                        <Building2 className="w-3.5 h-3.5 text-[#0071E3]" />
                        <span>Legal Entities & Customs Profiles under {c.name}</span>
                      </h4>
                      <span className="text-[11px] text-[#86868B]">
                        Domain Rule: <strong className="text-[#1D1D1F]">Client ≠ Importer of Record</strong>
                      </span>
                    </div>

                    {c.legalEntities.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] text-center text-xs text-[#86868B]">
                        No legal entities registered yet for {c.name}. Click <strong>Add Legal Entity</strong> to attach a legal organization (e.g. Target USA Inc.) and CBP importer number.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {c.legalEntities.map((le) => (
                          <div
                            key={le.id}
                            className="p-4 rounded-2xl bg-white border border-[#E5E5EA] shadow-2xs space-y-3"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h5 className="font-bold text-[#1D1D1F] text-sm flex items-center space-x-1.5">
                                  <span>{le.legalName}</span>
                                </h5>
                                {le.tradeName && (
                                  <p className="text-[11px] text-[#86868B]">DBA / Trade: {le.tradeName}</p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-slate-100 text-slate-700">
                                {le.entityType}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs text-[#86868B] pt-2 border-t border-[#F5F5F7]">
                              <div>
                                <span className="block text-[10px] font-bold text-[#86868B] uppercase">Country</span>
                                <span className="font-medium text-[#1D1D1F]">{le.country}</span>
                              </div>
                              <div>
                                <span className="block text-[10px] font-bold text-[#86868B] uppercase">Tax Identifier</span>
                                <span className="font-mono text-[#1D1D1F]">{le.taxIdentifier || "Not specified"}</span>
                              </div>
                            </div>

                            {/* Customs Profiles */}
                            <div className="pt-2 border-t border-[#F5F5F7]">
                              <span className="text-[10px] font-extrabold text-[#86868B] uppercase tracking-wider block mb-1.5 flex items-center space-x-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                <span>CBP Customs Profile</span>
                              </span>
                              {le.customsProfiles.length > 0 ? (
                                le.customsProfiles.map((cp) => (
                                  <div
                                    key={cp.id}
                                    className="p-2 rounded-xl bg-[#F5F5F7] text-xs flex items-center justify-between"
                                  >
                                    <div className="space-y-0.5">
                                      <span className="font-mono font-bold text-[#0071E3]">
                                        CBP Importer #{cp.cbpImporterNumber || "Pending Assignment"}
                                      </span>
                                      <div className="text-[10px] text-[#86868B]">
                                        POA Status: {cp.powerOfAttorneyStatus}
                                      </div>
                                    </div>
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      Active
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-[11px] text-[#86868B] italic">No Customs Profile assigned</p>
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
          <div className="bg-white rounded-3xl border border-[#E5E5EA] max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4">
              <div>
                <h3 className="text-lg font-bold text-[#1D1D1F]">Add Legal Entity</h3>
                <p className="text-xs text-[#86868B] mt-0.5">
                  Register a legal entity and customs identity for <strong>{addEntityModalClient.name}</strong>.
                </p>
              </div>
              <button
                onClick={() => setAddEntityModalClient(null)}
                className="text-[#86868B] hover:text-[#1D1D1F] font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLegalEntity} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Legal Company Name *</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Target USA Inc."
                  required
                  className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Trade Name / DBA (Optional)</label>
                <input
                  type="text"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  placeholder="Target Brands"
                  className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Tax ID / EIN</label>
                  <input
                    type="text"
                    value={taxIdentifier}
                    onChange={(e) => setTaxIdentifier(e.target.value)}
                    placeholder="12-3456789"
                    className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1D1D1F] mb-1">CBP Importer #</label>
                  <input
                    type="text"
                    value={cbpImporterNumber}
                    onChange={(e) => setCbpImporterNumber(e.target.value)}
                    placeholder="12-345678900"
                    className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#E5E5EA]">
                <button
                  type="button"
                  onClick={() => setAddEntityModalClient(null)}
                  className="px-4 py-2 text-xs font-bold text-[#86868B] hover:text-[#1D1D1F]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addEntityLoading}
                  className="px-5 py-2.5 bg-[#0071E3] text-white text-xs font-bold rounded-xl hover:bg-[#0071E3]/90 transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {addEntityLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Save Legal Entity</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
