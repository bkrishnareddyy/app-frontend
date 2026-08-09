"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Upload,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Bot,
  RefreshCw,
  Plus,
  Eye,
  X,
  FileCheck2,
  Maximize2,
  Users,
} from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { RawExtractionModal } from "@/components/RawExtractionModal";

interface ShipmentDocumentItem {
  id: string;
  name: string;
  type: string;
  docType?: string;
  status: string;
  uploadedAt: string;
  url: string;
  shipmentId: string;
  shipmentRef?: string;
  fileSize?: string;
  confidenceScore?: number;
  assignedBrokerId?: string | null;
  assignedBrokerName: string;
  clientId?: string | null;
  clientName: string;
  unattached?: boolean;
}

interface DocumentsClientProps {
  context: {
    userId: string;
    roleNames: string[];
    accountType: string;
    accountName: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
  teamMembers: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
}

export function DocumentsClient({ context, teamMembers }: DocumentsClientProps) {
  const isEnterpriseAdmin =
    context.accountType === "ENTERPRISE" &&
    (context.roleNames.includes("ADMIN") || context.roleNames.includes("OWNER"));

  // Construct full team list containing the logged-in admin themselves
  const fullTeamList = useMemo(() => {
    const list = [...teamMembers];
    const hasMe = list.some((m) => m.userId === context.userId);
    if (!hasMe) {
      list.unshift({
        userId: context.userId,
        email: context.email || "me@qubere.ai",
        firstName: context.firstName || "Me",
        lastName: context.lastName || "",
      });
    }
    return list;
  }, [teamMembers, context]);

  const [documents, setDocuments] = useState<ShipmentDocumentItem[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("ALL");
  const [selectedClientId, setSelectedClientId] = useState("ALL");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<ShipmentDocumentItem | null>(null);
  const [targetShipmentId, setTargetShipmentId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useLanguage();

  // Selected team member IDs. Default is [] (All Documents)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const [shipmentsRes, unattachedRes] = await Promise.all([
        fetch("/api/shipments"),
        fetch("/api/documents/unattached"),
      ]);

      const docs: ShipmentDocumentItem[] = [];

      if (shipmentsRes.ok) {
        const data = await shipmentsRes.json();
        if (data.shipments && Array.isArray(data.shipments)) {
          setShipments(data.shipments);
          data.shipments.forEach((shp: any) => {
            if (shp.documents && Array.isArray(shp.documents)) {
              shp.documents.forEach((d: any) => {
                docs.push({
                  id: d.id,
                  name: d.fileName || d.name || "Trade_Document.pdf",
                  type: d.docType || d.type || "Commercial Invoice",
                  docType: d.docType || d.type || "COMMERCIAL_INVOICE",
                  status: d.status || "Processed",
                  uploadedAt: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "Just now",
                  url: d.fileUrl || d.url || "#",
                  shipmentId: shp.id,
                  shipmentRef: shp.referenceNumber || shp.id,
                  confidenceScore: 98,
                  assignedBrokerId: shp.assignedBrokerId,
                  assignedBrokerName: shp.assignedBroker
                    ? `${shp.assignedBroker.firstName ?? ""} ${shp.assignedBroker.lastName ?? ""}`.trim() || shp.assignedBroker.email
                    : "Unassigned",
                  clientId: shp.clientId ?? null,
                  clientName: shp.client?.name || "No Client",
                });
              });
            }
          });
        }
      }

      // Detached documents -- no shipmentId, but still real rows with their
      // extractedJson intact, kept visible here so they're findable and
      // reattachable rather than disappearing after being detached.
      if (unattachedRes.ok) {
        const data = await unattachedRes.json();
        if (data.documents && Array.isArray(data.documents)) {
          data.documents.forEach((d: any) => {
            docs.push({
              id: d.id,
              name: d.fileName || "Trade_Document.pdf",
              type: d.docType || "Commercial Invoice",
              docType: d.docType || "COMMERCIAL_INVOICE",
              status: d.status || "Received",
              uploadedAt: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "Just now",
              url: d.fileUrl || "#",
              shipmentId: "",
              shipmentRef: "Unattached",
              confidenceScore: d.confidence || 95,
              assignedBrokerId: null,
              assignedBrokerName: "—",
              clientId: null,
              clientName: "No Client",
              unattached: true,
            });
          });
        }
      }

      setDocuments(docs);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Derived from the shipments loaded via /api/shipments (already includes client)
  const availableClients = useMemo(() => {
    const map = new Map<string, string>();
    shipments.forEach((shp: any) => {
      if (shp.client) map.set(shp.client.id, shp.client.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [shipments]);

  const filteredDocs = documents.filter((doc) => {
    // 1. Assignee/Owner filter
    if (isEnterpriseAdmin) {
      if (selectedUserIds.length > 0) {
        if (!doc.assignedBrokerId || !selectedUserIds.includes(doc.assignedBrokerId)) {
          return false;
        }
      }
    }

    // 2. Search query filter
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.shipmentRef && doc.shipmentRef.toLowerCase().includes(searchQuery.toLowerCase()));

    // 3. Document type dropdown filter
    const matchesType = selectedType === "ALL" || doc.docType === selectedType;

    // 4. Client dropdown filter
    const matchesClient =
      selectedClientId === "ALL" ||
      (selectedClientId === "UNASSIGNED" ? !doc.clientId : doc.clientId === selectedClientId);

    return matchesSearch && matchesType && matchesClient;
  });

  const isImageFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".png") || ext.includes(".jpg") || ext.includes(".jpeg") || ext.includes(".webp");
  };

  const isPdfFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".pdf");
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-3xl border border-[#E5E5EA] shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-blue-50 text-[#0071E3] border border-blue-100">
              Agent 1 & 2 Ingestion
            </span>
            <span className="text-xs text-[#86868B]">150+ Dynamic Trade Document Types</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight mt-1">
            {t.documents.title}
          </h1>
          <p className="text-xs text-[#86868B] mt-0.5">
            {t.documents.subtitle}
          </p>
        </div>

        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t.documents.uploadButton}</span>
        </button>
      </div>

      {/* Enterprise Admin Top Filter Controls */}
      {isEnterpriseAdmin && (
        <div className="bg-white p-4 rounded-3xl border border-[#E5E5EA] shadow-2xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-2.5">
            <Users className="w-4 h-4 text-[#0071E3]" />
            <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider">
              Assignee View
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
              <button
                onClick={() => setSelectedUserIds([])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 0 ? "bg-white text-[#1D1D1F] shadow-3xs" : "text-[#86868B]"
                }`}
              >
                All Documents
              </button>
              <button
                onClick={() => setSelectedUserIds([context.userId])}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  selectedUserIds.length === 1 && selectedUserIds[0] === context.userId
                    ? "bg-white text-[#1D1D1F] shadow-3xs"
                    : "text-[#86868B]"
                }`}
              >
                My Documents
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs relative">
              <span className="text-[#86868B] font-semibold">Team Members:</span>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="px-3.5 py-1.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] font-semibold cursor-pointer flex items-center space-x-1.5 shadow-3xs"
              >
                <span>
                  {selectedUserIds.length === 0
                    ? "All Team Members"
                    : selectedUserIds.length === 1
                    ? selectedUserIds[0] === context.userId
                      ? `My Documents (${context.firstName || "Me"})`
                      : (() => {
                          const user = fullTeamList.find((u) => u.userId === selectedUserIds[0]);
                          return user
                            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
                            : "1 Selected";
                        })()
                    : `${selectedUserIds.length} Selected`}
                </span>
                <span className="text-[#86868B] text-[9px]">▼</span>
              </button>

              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-[#E5E5EA] rounded-2xl shadow-lg p-3 z-20 space-y-2 max-h-60 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2 mb-1 text-[10px] font-bold text-[#86868B] uppercase">
                      <span>Select Members</span>
                      <div className="space-x-2">
                        <button
                          onClick={() => setSelectedUserIds(fullTeamList.map((t) => t.userId))}
                          className="text-[#0071E3] hover:underline cursor-pointer"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setSelectedUserIds([])}
                          className="text-[#0071E3] hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {fullTeamList.map((member) => {
                        const isChecked = selectedUserIds.includes(member.userId);
                        const memberName =
                          member.firstName || member.lastName
                            ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()
                            : member.email;

                        return (
                          <label
                            key={member.userId}
                            className="flex items-center space-x-2.5 p-2 hover:bg-[#F5F5F7] rounded-xl cursor-pointer text-left transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleUser(member.userId)}
                              className="rounded border-[#E5E5EA] text-[#0071E3] focus:ring-[#0071E3] cursor-pointer"
                            />
                            <div className="truncate">
                              <p className="font-bold text-[#1D1D1F] text-xs truncate">
                                {memberName}
                                {member.userId === context.userId && " (Me)"}
                              </p>
                              <p className="text-[10px] text-[#86868B] truncate">
                                {member.email}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
          <input
            type="text"
            placeholder={t.documents.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] transition-colors"
          />
        </div>

        {/* Filter & Refresh */}
        <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] cursor-pointer font-medium"
          >
            <option value="ALL">{t.documents.allTypes}</option>
            <option value="COMMERCIAL_INVOICE">Commercial Invoice</option>
            <option value="OCEAN_BILL_OF_LADING">Ocean Bill of Lading (B/L)</option>
            <option value="GENERAL_CERTIFICATE_OF_ORIGIN">Certificate of Origin</option>
            <option value="CBP_FORM_7501_ENTRY_SUMMARY">CBP Form 7501</option>
            <option value="PACKING_LIST">Packing List</option>
          </select>

          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] cursor-pointer font-medium"
          >
            <option value="ALL">All Clients</option>
            <option value="UNASSIGNED">No Client</option>
            {availableClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            onClick={fetchDocuments}
            disabled={isLoading}
            className="p-2 rounded-xl border border-[#E5E5EA] bg-white hover:bg-[#F5F5F7] text-[#1D1D1F] transition-colors cursor-pointer"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#0071E3]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Document Roster Table */}
      <div className="bg-white rounded-3xl border border-[#E5E5EA] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-5">{t.documents.colName}</th>
                <th className="py-3 px-5">{t.documents.colType}</th>
                <th className="py-3 px-5">{t.documents.colShipment}</th>
                <th className="py-3 px-5">{t.documents.colStatus}</th>
                <th className="py-3 px-5">Client</th>
                {isEnterpriseAdmin && <th className="py-3 px-5">Owner</th>}
                <th className="py-3 px-5">{t.documents.colDate}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={isEnterpriseAdmin ? 7 : 6} className="py-12 text-center text-[#86868B]">
                    <FileText className="w-8 h-8 mx-auto text-[#86868B]/40 mb-2" />
                    <p className="font-semibold text-xs text-[#1D1D1F]">No Trade Documents Uploaded Yet</p>
                    <p className="text-[11px] text-[#86868B] mt-1">
                      Click <strong className="text-[#0071E3]">Upload Document</strong> above to ingest a file and trigger Agent 1.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[#F5F5F7]/50 transition-colors">
                    {/* Document Name Click triggers Modal */}
                    <td className="py-3.5 px-5 font-semibold text-[#1D1D1F]">
                      <button
                        onClick={() => setPreviewDoc(doc)}
                        className="flex items-center space-x-2.5 hover:text-[#0071E3] transition-colors text-left group cursor-pointer"
                        title="Click to view document in modal"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] shrink-0 group-hover:scale-105 transition-transform">
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className="truncate max-w-xs group-hover:underline">{doc.name}</span>
                        <Eye className="w-3.5 h-3.5 text-[#86868B] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </td>

                    <td className="py-3.5 px-5 font-medium text-[#86868B]">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]">
                        {doc.type}
                      </span>
                    </td>

                    <td className="py-3.5 px-5 font-mono text-[11px]">
                      {doc.unattached ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 font-sans">
                          Unattached
                        </span>
                      ) : (
                        <span className="text-[#0071E3]">{doc.shipmentRef}</span>
                      )}
                    </td>

                    <td className="py-3.5 px-5">
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Processed (98% Conf)</span>
                      </span>
                    </td>

                    <td className="py-3.5 px-5">
                      {doc.clientId ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#0071E3]/10 text-[#0071E3]">
                          {doc.clientName}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#86868B]">—</span>
                      )}
                    </td>

                    {isEnterpriseAdmin && (
                      <td className="py-3.5 px-5 font-semibold text-[#1D1D1F]">
                        {doc.assignedBrokerName}
                      </td>
                    )}

                    <td className="py-3.5 px-5 text-[#86868B]">{doc.uploadedAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reusable Document Viewer Modal */}
      {previewDoc && (
        <RawExtractionModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentId={previewDoc.id}
          fileName={previewDoc.name}
          shipmentNumber={previewDoc.shipmentRef}
          fileUrl={previewDoc.url}
          proxyUrl={
            previewDoc.url && previewDoc.url !== "#"
              ? previewDoc.url.includes("vercel-storage.com")
                ? `/api/documents/proxy?url=${encodeURIComponent(previewDoc.url)}`
                : previewDoc.url
              : undefined
          }
        />
      )}

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        shipmentId={targetShipmentId}
        shipments={shipments}
        onUploadSuccess={fetchDocuments}
      />
    </div>
  );
}
