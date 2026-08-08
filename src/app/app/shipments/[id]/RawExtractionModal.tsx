"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Code, FileText, Download } from "lucide-react";

interface RawExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  fileName: string;
  shipmentNumber?: string;
}

export function RawExtractionModal({
  isOpen,
  onClose,
  documentId,
  fileName,
  shipmentNumber = "SHP-2026",
}: RawExtractionModalProps) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"KV" | "JSON">("KV");

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
          fileName,
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
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#1D1D1F]">Neutral OCR & Raw Extraction Vault</h3>
              <p className="text-xs text-[#86868B]">
                Doc ID: <span className="font-mono">{documentId}</span> • Shipment: <span className="font-mono text-[#0071E3] font-bold">{shipmentNumber}</span>
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
        <div className="flex items-center justify-between bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
          <div className="flex items-center space-x-1">
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

          <button
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] font-bold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#0071E3]" />}
            <span>{copied ? "Copied!" : "Copy JSON"}</span>
          </button>
        </div>

        {/* Content Box */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-xs py-12">
              <span>Loading raw extraction data...</span>
            </div>
          ) : activeTab === "KV" ? (
            <div className="flex-1 overflow-y-auto border border-[#E5E5EA] rounded-2xl p-4 bg-[#F9F9FB] space-y-3 text-xs">
              {kvEntries.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {kvEntries.map(([k, v], idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-0.5 shadow-2xs">
                      <p className="text-[10px] text-[#86868B] font-bold uppercase">{k}</p>
                      <p className="font-extrabold text-[#1D1D1F] break-words">{v !== null && v !== undefined ? String(v) : <span className="italic font-normal text-amber-700">Not Present (Null)</span>}</p>
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
          <span className="text-[#86868B]">Source File: <strong>{fileName}</strong></span>
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
