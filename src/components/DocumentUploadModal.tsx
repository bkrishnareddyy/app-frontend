"use client";

import { useState, useEffect } from "react";
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles } from "lucide-react";
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
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, () => {
    if (!isUploading) onClose();
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
        onClose();
        window.location.reload();
      }, 1200);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        {...dialogSurfaceProps("upload-document-title")}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
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
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close upload dialog"
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
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
            onClick={onClose}
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
      </div>
    </div>
  );
}
