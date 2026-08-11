"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles, Link2 } from "lucide-react";
import { useDialogFocus, dialogSurfaceProps } from "@/lib/useDialogFocus";

interface UploadOutcome {
  fileName: string;
  ok: boolean;
  message: string;
}

interface ShipmentOption {
  id: string;
  shipmentNumber?: string | null;
  status?: string | null;
}

interface ShipmentDocumentSummary {
  id: string;
  docType: string;
  fileName: string;
}

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId?: string;
  shipments?: ShipmentOption[];
  onUploadSuccess?: () => void;
}

export function DocumentUploadModal({
  isOpen,
  onClose,
  shipmentId: initialShipmentId = "",
  shipments = [],
  onUploadSuccess,
}: DocumentUploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [docType, setDocType] = useState<string>("Commercial Invoice");
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(initialShipmentId);
  const [availableShipments, setAvailableShipments] = useState<ShipmentOption[]>(shipments);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [shipmentSearch, setShipmentSearch] = useState<string>("");
  const [shipmentTotal, setShipmentTotal] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"UPLOAD" | "ATTACH_EXISTING">("UPLOAD");
  const [unattachedDocs, setUnattachedDocs] = useState<ShipmentDocumentSummary[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  // Reset here rather than in an effect so reopening never shows the previous tab.
  const closeModal = useCallback(() => {
    setMode("UPLOAD");
    onClose();
  }, [onClose]);

  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, () => {
    if (!isUploading) closeModal();
  });

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    // The picker used to request /api/shipments with no arguments, which
    // returned every shipment in the account together with its documents, line
    // items, decisions and filings, to fill a dropdown that needs two fields.
    const timer = setTimeout(() => {
      void (async () => {
        if (initialShipmentId) {
          setSelectedShipmentId(initialShipmentId);
        }
        try {
          const query = new URLSearchParams({ view: "summary", pageSize: "50" });
          if (shipmentSearch.trim()) query.set("q", shipmentSearch.trim());
          const res = await fetch(`/api/shipments?${query.toString()}`, {
            signal: controller.signal,
          });
          const data = await res.json();
          if (controller.signal.aborted) return;
          if (Array.isArray(data.shipments)) {
            setAvailableShipments(data.shipments);
            setShipmentTotal(typeof data.total === "number" ? data.total : null);
            if (!initialShipmentId && data.shipments.length > 0) {
              setSelectedShipmentId((prev) => prev || data.shipments[0].id);
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) console.error("Modal shipment fetch error:", err);
        }
      })();
    }, shipmentSearch ? 250 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, initialShipmentId, shipmentSearch]);

  // Detached documents keep their extraction, so they can be reattached instead of re-uploaded.
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/documents/unattached", { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        setUnattachedDocs(Array.isArray(data.documents) ? data.documents : []);
      } catch (err) {
        if (!controller.signal.aborted) console.error("Unattached documents fetch error:", err);
      }
    })();
    return () => controller.abort();
  }, [isOpen]);

  const handleAttachExisting = async (docId: string) => {
    if (!initialShipmentId) {
      setError("No target shipment selected.");
      return;
    }
    setAttachingId(docId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: initialShipmentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to attach document");
      }
      setSuccessMsg("Document attached and agents triggered.");
      if (onUploadSuccess) onUploadSuccess();
      setTimeout(() => {
        setSuccessMsg(null);
        closeModal();
        window.location.reload();
      }, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to attach document");
    } finally {
      setAttachingId(null);
    }
  };

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(e.target.files ? [...e.target.files] : []);
    setError(null);
    setOutcomes([]);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError("Please select at least one document to upload.");
      return;
    }
    if (!selectedShipmentId) {
      setError("Please select a shipment.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setOutcomes([]);

    // Uploaded one at a time and recorded per file. A batch that reported a
    // single result would call the whole batch a success when one file failed,
    // and the operator would never know which document is missing.
    const results: UploadOutcome[] = [];
    for (const file of files) {
      setUploadingName(file.name);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("docType", docType);
        formData.append("shipmentId", selectedShipmentId);

        const res = await fetch("/api/documents/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          results.push({
            fileName: file.name,
            ok: false,
            message: data?.error?.message ?? data?.error ?? "Upload failed",
          });
        } else {
          results.push({ fileName: file.name, ok: true, message: "Queued for processing" });
        }
      } catch (err: unknown) {
        results.push({
          fileName: file.name,
          ok: false,
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
      setOutcomes([...results]);
    }

    setUploadingName(null);
    setIsUploading(false);

    const succeeded = results.filter((r) => r.ok);
    if (succeeded.length > 0) {
      setFiles(files.filter((f) => !succeeded.some((s) => s.fileName === f.name)));
      onUploadSuccess?.();
    }

    // The dialog stays open while anything failed, so the per-file errors are
    // still on screen instead of being wiped by a reload.
    if (succeeded.length === results.length) {
      setTimeout(() => {
        closeModal();
        window.location.reload();
      }, 1200);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) {
          closeModal();
        }
      }}
    >
      <div
        ref={dialogRef}
        {...dialogSurfaceProps("upload-document-title")}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-[#E5E5EA] pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 id="upload-document-title" className="text-base font-extrabold text-[#1D1D1F]">Upload Trade Documents</h3>
              <p className="text-xs text-[#86868B]">Add one or more invoices, bills of lading, or certificates</p>
            </div>
          </div>
          <button
            onClick={closeModal}
            disabled={isUploading}
            aria-label="Close upload dialog"
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/*
          The dialog is centred, so content taller than the viewport used to be
          clipped at the top and the bottom at once with nothing to scroll — on a
          1080p screen at 100% zoom the upload button was off-screen. The header
          stays pinned and everything below it scrolls instead.
        */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pt-5 pr-1">
        {/* Alerts */}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center space-x-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {outcomes.length > 0 && (
          <ul className="space-y-1.5" aria-live="polite">
            {outcomes.map((outcome) => (
              <li
                key={outcome.fileName}
                className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                  outcome.ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {outcome.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                )}
                <span>
                  <span className="font-semibold">{outcome.fileName}</span> — {outcome.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Mode Tabs */}
        <div className="flex bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs">
          <button
            onClick={() => setMode("UPLOAD")}
            className={`flex-1 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              mode === "UPLOAD" ? "bg-white text-[#1D1D1F] shadow-3xs" : "text-[#86868B]"
            }`}
          >
            Upload New
          </button>
          <button
            onClick={() => setMode("ATTACH_EXISTING")}
            className={`flex-1 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              mode === "ATTACH_EXISTING" ? "bg-white text-[#1D1D1F] shadow-3xs" : "text-[#86868B]"
            }`}
          >
            Attach Existing ({unattachedDocs.length})
          </button>
        </div>

        {mode === "UPLOAD" ? (
          <>
            {/* Shipment Selection */}
            <div className="space-y-1.5">
              <label htmlFor="upload-shipment-search" className="text-xs font-semibold text-[#1D1D1F] ml-1">
                Find a shipment
              </label>
              <input
                id="upload-shipment-search"
                type="search"
                value={shipmentSearch}
                onChange={(e) => setShipmentSearch(e.target.value)}
                placeholder="Shipment number or importer"
                className="w-full px-4 py-2.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/20 transition-all"
              />
              <label htmlFor="upload-shipment" className="text-xs font-semibold text-[#1D1D1F] ml-1 block pt-1">
                Target Shipment
              </label>
              <select
                id="upload-shipment"
                value={selectedShipmentId}
                onChange={(e) => setSelectedShipmentId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/20 transition-all"
              >
                <option value="" disabled>Select a Shipment</option>
                {(availableShipments.length > 0 ? availableShipments : shipments).map((shp) => (
                  <option key={shp.id} value={shp.id}>
                    {shp.shipmentNumber ?? shp.id}
                    {shp.status ? ` (${shp.status})` : ""}
                  </option>
                ))}
              </select>
              {shipmentTotal !== null && shipmentTotal > availableShipments.length && (
                <p role="status" className="text-xs text-[#86868B] ml-1">
                  Showing {availableShipments.length} of {shipmentTotal} shipments. Search to narrow
                  the list.
                </p>
              )}
              {shipmentTotal === 0 && (
                <p role="status" className="text-xs text-[#86868B] ml-1">
                  No shipment matches that search.
                </p>
              )}
            </div>

            {/* Document Type Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#1D1D1F]">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3] font-medium"
              >
                <option value="AUTO_DETECT">✨ Auto-Detect Document Type (AI Agent Classification)</option>
                <option value="Bill of Lading">Bill of Lading (B/L)</option>
                <option value="Commercial Invoice">Commercial Invoice</option>
                <option value="Packing List">Packing List</option>
                <option value="Arrival Notice">Arrival Notice</option>
                <option value="Insurance Certificate">Insurance Certificate</option>
                <option value="Certificate of Origin">Certificate of Origin</option>
                <option value="Customs Entry Summary">Customs Entry Summary (CBP 7501)</option>
              </select>
            </div>

            {/* Drag and Drop File Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#1D1D1F]">Select Files</label>
              <div className="relative border-2 border-dashed border-[#E5E5EA] hover:border-[#0071E3] rounded-2xl p-6 text-center bg-[#F5F5F7] transition-all cursor-pointer group">
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.edi"
                  aria-label="Select one or more documents to upload"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#0071E3] group-hover:scale-110 transition-transform">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#1D1D1F]">
                      {files.length === 0
                        ? "Click to upload or drag & drop"
                        : files.length === 1
                          ? files[0].name
                          : `${files.length} files selected`}
                    </p>
                    <p className="text-xs text-[#86868B] mt-0.5">
                      {files.length === 0
                        ? "PDF, PNG, JPG, XLSX or EDI up to 25MB each"
                        : `${(files.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1)} KB total`}
                    </p>
                  </div>
                </div>
              </div>
              {files.length > 1 && (
                <ul className="text-xs text-[#86868B] space-y-0.5 pt-1">
                  {files.map((f) => (
                    <li key={f.name} className="truncate">
                      {f.name} — {(f.size / 1024).toFixed(1)} KB
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* AI Auto-Extraction Notice */}
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[#0071E3] shrink-0" />
              <span>
                Uploaded documents will be automatically parsed by the <strong>Document Intelligence Agent</strong>.
              </span>
            </div>

            {/* Modal Action Buttons */}
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={closeModal}
                disabled={isUploading}
                className="px-4 py-2.5 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] text-xs font-semibold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={isUploading || files.length === 0}
                className="px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-2 transition-all"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading {uploadingName ?? ""}…</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>
                      {files.length > 1 ? `Upload ${files.length} files` : "Upload & Parse"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Attach Existing Unattached Document */}
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center space-x-2">
              <Link2 className="w-4 h-4 text-[#0071E3] shrink-0" />
              <span>
                Reattaching ports over the document&apos;s existing extracted data as-is and triggers
                the same agents a fresh upload would — no re-extraction needed.
              </span>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {unattachedDocs.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#86868B]">
                  No detached documents available to attach.
                </div>
              ) : (
                unattachedDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-[#0071E3] shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-[#1D1D1F] text-xs truncate">{doc.docType}</p>
                        <p className="text-[10px] text-[#86868B] truncate">{doc.fileName}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAttachExisting(doc.id)}
                      disabled={attachingId === doc.id}
                      className="px-3 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white text-[11px] font-semibold rounded-lg shrink-0 flex items-center space-x-1.5 cursor-pointer"
                    >
                      {attachingId === doc.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span>Attach</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] text-xs font-semibold rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
