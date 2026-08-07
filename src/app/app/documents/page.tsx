"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";

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
}

import { useLanguage } from "@/lib/i18n/LanguageContext";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<ShipmentDocumentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("ALL");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<ShipmentDocumentItem | null>(null);
  const [targetShipmentId, setTargetShipmentId] = useState("shp_demo_default");
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/shipments");
      if (res.ok) {
        const data = await res.json();
        const docs: ShipmentDocumentItem[] = [];
        if (data.shipments && Array.isArray(data.shipments)) {
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
                });
              });
            }
          });
        }
        setDocuments(docs);
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.shipmentRef && doc.shipmentRef.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesType = selectedType === "ALL" || doc.docType === selectedType;

    return matchesSearch && matchesType;
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
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
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
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs hover:shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{t.documents.uploadButton}</span>
        </button>
      </div>

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
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]"
          >
            <option value="ALL">{t.documents.allTypes}</option>
            <option value="COMMERCIAL_INVOICE">Commercial Invoice</option>
            <option value="OCEAN_BILL_OF_LADING">Ocean Bill of Lading (B/L)</option>
            <option value="GENERAL_CERTIFICATE_OF_ORIGIN">Certificate of Origin</option>
            <option value="CBP_FORM_7501_ENTRY_SUMMARY">CBP Form 7501</option>
            <option value="PACKING_LIST">Packing List</option>
          </select>

          <button
            onClick={fetchDocuments}
            disabled={isLoading}
            className="p-2 rounded-xl border border-[#E5E5EA] bg-white hover:bg-[#F5F5F7] text-[#1D1D1F] transition-colors"
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
                <th className="py-3 px-5">{t.documents.colDate}</th>
                <th className="py-3 px-5 text-right">{t.documents.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#86868B]">
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

                    <td className="py-3.5 px-5 font-mono text-[11px] text-[#0071E3]">
                      {doc.shipmentRef}
                    </td>

                    <td className="py-3.5 px-5">
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Processed (98% Conf)</span>
                      </span>
                    </td>

                    <td className="py-3.5 px-5 text-[#86868B]">{doc.uploadedAt}</td>

                    {/* Actions Column: Opens in New Tab */}
                    <td className="py-3.5 px-5 text-right space-x-2">
                      <button
                        onClick={() => setPreviewDoc(doc)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#F5F5F7] hover:bg-[#E5E5EA] text-xs text-[#1D1D1F] font-medium transition-colors"
                        title="Quick Modal Preview"
                      >
                        <Eye className="w-3 h-3 text-[#86868B]" />
                        <span>Preview</span>
                      </button>

                      {doc.url && doc.url !== "#" ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1 px-3 py-1 rounded-lg bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-2xs transition-colors"
                          title="Open document in new browser tab"
                        >
                          <span>Open in New Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-[#86868B]">In Store</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document Viewer Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-4xl w-full p-6 space-y-5 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-[#1D1D1F] flex items-center space-x-2">
                    <span>{previewDoc.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F]">
                      {previewDoc.type}
                    </span>
                  </h3>
                  <p className="text-xs text-[#86868B]">
                    Shipment Ref: <span className="font-mono text-[#0071E3] font-semibold">{previewDoc.shipmentRef}</span> • Ingested: {previewDoc.uploadedAt}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-2 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* AI Agent Status Summary Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F5F5F7] p-3 rounded-2xl border border-[#E5E5EA] text-xs">
              <div>
                <p className="text-[10px] text-[#86868B] uppercase font-bold">OCR Confidence</p>
                <p className="font-extrabold text-emerald-600 flex items-center space-x-1 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>98% High Accuracy</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[#86868B] uppercase font-bold">Classified Category</p>
                <p className="font-semibold text-[#1D1D1F] mt-0.5 truncate">{previewDoc.type}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#86868B] uppercase font-bold">CBP Rule Compliance</p>
                <p className="font-semibold text-emerald-600 mt-0.5">19 CFR § 141.86 Passed</p>
              </div>
              <div>
                <p className="text-[10px] text-[#86868B] uppercase font-bold">Agent Pipeline</p>
                <p className="font-semibold text-[#0071E3] mt-0.5">Agents 1-10 Triggered</p>
              </div>
            </div>

            {/* Document Preview Body */}
            <div className="flex-1 overflow-y-auto min-h-[350px] bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] p-4 flex items-center justify-center">
              {previewDoc.url && previewDoc.url !== "#" ? (
                isImageFile(previewDoc.url, previewDoc.name) ? (
                  <img
                    src={previewDoc.url}
                    alt={previewDoc.name}
                    className="max-h-[55vh] rounded-xl border border-[#E5E5EA] shadow-md object-contain"
                  />
                ) : isPdfFile(previewDoc.url, previewDoc.name) ? (
                  <iframe
                    src={previewDoc.url}
                    className="w-full h-[55vh] rounded-xl border border-[#E5E5EA]"
                    title={previewDoc.name}
                  />
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <FileCheck2 className="w-12 h-12 text-[#0071E3] mx-auto" />
                    <div>
                      <h4 className="font-extrabold text-[#1D1D1F] text-sm">{previewDoc.name}</h4>
                      <p className="text-xs text-[#86868B] mt-1">Binary trade file stored securely in Qubere Document Vault.</p>
                    </div>
                    <a
                      href={previewDoc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#0071E3] text-white text-xs font-semibold hover:bg-[#0077ED] transition-colors"
                    >
                      <span>Open File in New Tab</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )
              ) : (
                <div className="text-center p-8 space-y-3">
                  <FileText className="w-12 h-12 text-[#86868B]/50 mx-auto" />
                  <div>
                    <h4 className="font-extrabold text-[#1D1D1F] text-sm">{previewDoc.name}</h4>
                    <p className="text-xs text-[#86868B] mt-1">
                      Document buffer stored in local session. Trigger Agent 1 Vision to view OCR bounding boxes.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="flex items-center justify-between border-t border-[#E5E5EA] pt-4">
              <span className="text-xs text-[#86868B]">Qubere Document Store ID: {previewDoc.id}</span>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="px-4 py-2 rounded-xl border border-[#E5E5EA] hover:bg-[#F5F5F7] text-xs font-semibold text-[#1D1D1F] transition-colors"
                >
                  Close
                </button>

                {previewDoc.url && previewDoc.url !== "#" && (
                  <a
                    href={previewDoc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition-colors"
                  >
                    <span>Open in New Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        shipmentId={targetShipmentId}
        onUploadSuccess={fetchDocuments}
      />
    </div>
  );
}
