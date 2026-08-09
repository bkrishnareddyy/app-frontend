"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Code, FileText, Download, ExternalLink, Edit2 } from "lucide-react";

interface RawExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  fileName: string;
  shipmentNumber?: string;
  fileUrl?: string | null;
  proxyUrl?: string;
}

export function RawExtractionModal({
  isOpen,
  onClose,
  documentId,
  fileName,
  shipmentNumber = "SHP-2026",
  fileUrl,
  proxyUrl,
}: RawExtractionModalProps) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  
  // Set default active tab to "DOC" (Document Preview) as first option
  const [activeTab, setActiveTab] = useState<"DOC" | "KV" | "JSON">("DOC");

  // Document renaming state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);

  // Sync renaming state when fileName prop changes
  useEffect(() => {
    setEditingNameValue(fileName);
  }, [fileName]);

  useEffect(() => {
    if (isOpen && documentId) {
      setLoading(true);
      fetch(`/api/documents/${documentId}/extractions`)
        .then((res) => res.json())
        .then((resData) => {
          setData(resData);
          router.refresh();
        })
        .catch((err) => console.error("Error fetching raw extraction:", err))
        .finally(() => setLoading(false));
    }
  }, [isOpen, documentId, router]);

  if (!isOpen) return null;

  const jsonString = data?.extractedJson
    ? JSON.stringify(data.extractedJson, null, 2)
    : JSON.stringify(
        {
          documentId,
          shipmentNumber,
          fileName: editingNameValue,
          extractedData: "Extraction pending vision agent processing",
        },
        null,
        2
      );

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenameDocument = async () => {
    if (editingNameValue.trim() === "" || editingNameValue.trim() === fileName) {
      setIsEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fileName: editingNameValue.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to rename document");
      }

      setIsEditingName(false);
      router.refresh();
      // Reload page to reflect renamed document in parent component lists
      window.location.reload();
    } catch (err: any) {
      alert(err.message || "Failed to rename document");
      setEditingNameValue(fileName);
    } finally {
      setRenaming(false);
    }
  };

  const isImageFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".png") || ext.includes(".jpg") || ext.includes(".jpeg") || ext.includes(".webp");
  };

  const isPdfFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".pdf");
  };

  const kvPairs = data?.extractedJson?.keyValuePairs || {};
  const kvEntries = Object.entries(kvPairs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-4xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Code className="w-5 h-5" />
            </div>
            <div>
              {isEditingName ? (
                <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameDocument();
                      if (e.key === "Escape") {
                        setIsEditingName(false);
                        setEditingNameValue(fileName);
                      }
                    }}
                    className="px-2.5 py-1 text-sm font-extrabold text-[#1D1D1F] border border-[#0071E3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white w-64"
                    disabled={renaming}
                    autoFocus
                  />
                  <button
                    onClick={handleRenameDocument}
                    disabled={renaming}
                    className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setEditingNameValue(fileName);
                    }}
                    disabled={renaming}
                    className="p-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <h3 className="text-base font-extrabold text-[#1D1D1F] flex items-center space-x-2 group">
                  <span>{editingNameValue}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditingName(true);
                    }}
                    className="p-1 rounded hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Rename Document"
                  >
                    <Edit2 className="w-3.5 h-3.5 animate-in fade-in" />
                  </button>
                </h3>
              )}
              <p className="text-xs text-[#86868B] mt-0.5">
                Neutral OCR &amp; Raw Extraction Vault • Shipment: <span className="font-mono text-[#0071E3] font-bold">{shipmentNumber}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection Bar */}
        <div className="flex items-center justify-between bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs shrink-0">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setActiveTab("DOC")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTab === "DOC" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Document Preview
            </button>
            <button
              onClick={() => setActiveTab("KV")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTab === "KV" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Neutral Key-Value Pairs ({kvEntries.length})
            </button>
            <button
              onClick={() => setActiveTab("JSON")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTab === "JSON" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Raw Extraction JSON Blob
            </button>
          </div>

          {activeTab === "JSON" && (
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] font-bold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#0071E3]" />}
              <span>{copied ? "Copied!" : "Copy JSON"}</span>
            </button>
          )}
        </div>

        {/* Content Box */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-xs py-12">
              <span>Loading raw extraction data...</span>
            </div>
          ) : activeTab === "DOC" ? (
            <div className="flex-1 overflow-y-auto bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] p-4 flex items-center justify-center min-h-[350px]">
              {proxyUrl ? (
                isImageFile(proxyUrl, editingNameValue) ? (
                  <img
                    src={proxyUrl}
                    alt={editingNameValue}
                    className="max-h-[55vh] rounded-xl border border-[#E5E5EA] shadow-md object-contain"
                  />
                ) : isPdfFile(proxyUrl, editingNameValue) ? (
                  <iframe
                    src={proxyUrl}
                    className="w-full h-[55vh] rounded-xl border border-[#E5E5EA]"
                    title={editingNameValue}
                  />
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <FileText className="w-12 h-12 text-[#0071E3] mx-auto" />
                    <div>
                      <h4 className="font-extrabold text-[#1D1D1F] text-sm">{editingNameValue}</h4>
                      <p className="text-xs text-[#86868B] mt-1">Binary trade file stored securely in Qubere Document Vault.</p>
                    </div>
                    <a
                      href={proxyUrl}
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
                    <h4 className="font-extrabold text-[#1D1D1F] text-sm">{editingNameValue}</h4>
                    <p className="text-xs text-[#86868B] mt-1">Document preview is currently unavailable.</p>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "KV" ? (
            <div className="flex-1 overflow-y-auto border border-[#E5E5EA] rounded-2xl p-4 bg-[#F9F9FB] space-y-3 text-xs">
              {kvEntries.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {kvEntries.map(([k, v], idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-0.5 shadow-2xs">
                      <p className="text-[10px] text-[#86868B] font-bold uppercase">{k}</p>
                      <p className="font-extrabold text-[#1D1D1F] break-words">
                        {v !== null && v !== undefined ? String(v) : (
                          <span className="italic font-normal text-amber-700">Not Present (Null)</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-[#86868B]">
                  <p className="font-bold text-[#1D1D1F]">No Discovered Key-Value Pairs</p>
                  <p className="text-[11px] mt-1">Document was processed with schema-neutral OCR. Raw content is preserved in JSON payload.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto bg-[#1E1E1E] text-emerald-400 p-4 rounded-2xl font-mono text-xs shadow-inner leading-relaxed select-all">
              <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[#E5E5EA] shrink-0 text-xs">
          <span className="text-[#86868B]">Source File: <strong>{editingNameValue}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
}
