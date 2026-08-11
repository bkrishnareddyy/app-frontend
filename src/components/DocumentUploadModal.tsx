"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles, Link2 } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label, FormField } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

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

const TITLE_ID = "upload-document-title";

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
    <Modal isOpen={isOpen} onClose={closeModal} titleId={TITLE_ID} closeDisabled={isUploading}>
      <ModalHeader
        titleId={TITLE_ID}
        title="Upload Trade Documents"
        subtitle="Add one or more invoices, bills of lading, or certificates"
        icon={<Upload className="w-5 h-5" />}
        onClose={closeModal}
        closeDisabled={isUploading}
      />

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
              className={cn(
                "p-2.5 rounded-xl border text-xs flex items-start gap-2",
                outcome.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-700"
              )}
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
      <div className="flex bg-surface-muted p-1 rounded-xl border border-border text-xs">
        <button
          onClick={() => setMode("UPLOAD")}
          className={cn(
            "flex-1 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer",
            mode === "UPLOAD" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
          )}
        >
          Upload New
        </button>
        <button
          onClick={() => setMode("ATTACH_EXISTING")}
          className={cn(
            "flex-1 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer",
            mode === "ATTACH_EXISTING" ? "bg-white text-ink shadow-3xs" : "text-ink-muted"
          )}
        >
          Attach Existing ({unattachedDocs.length})
        </button>
      </div>

      {mode === "UPLOAD" ? (
        <>
          {/* The form scrolls; the header above and the actions below stay put, so
              the submit button cannot be pushed off a short viewport. */}
          <ModalBody className="space-y-5">
          {/* Shipment Selection */}
          <FormField>
            <Label htmlFor="upload-shipment-search" className="ml-1">
              Find a shipment
            </Label>
            <Input
              id="upload-shipment-search"
              type="search"
              value={shipmentSearch}
              onChange={(e) => setShipmentSearch(e.target.value)}
              placeholder="Shipment number or importer"
              className="bg-white"
            />
            <Label htmlFor="upload-shipment" className="ml-1 block pt-1">
              Target Shipment
            </Label>
            <Select
              id="upload-shipment"
              value={selectedShipmentId}
              onChange={(e) => setSelectedShipmentId(e.target.value)}
              className="bg-white"
            >
              <option value="" disabled>Select a Shipment</option>
              {(availableShipments.length > 0 ? availableShipments : shipments).map((shp) => (
                <option key={shp.id} value={shp.id}>
                  {shp.shipmentNumber ?? shp.id}
                  {shp.status ? ` (${shp.status})` : ""}
                </option>
              ))}
            </Select>
            {shipmentTotal !== null && shipmentTotal > availableShipments.length && (
              <p role="status" className="text-xs text-ink-muted ml-1">
                Showing {availableShipments.length} of {shipmentTotal} shipments. Search to narrow
                the list.
              </p>
            )}
            {shipmentTotal === 0 && (
              <p role="status" className="text-xs text-ink-muted ml-1">
                No shipment matches that search.
              </p>
            )}
          </FormField>

          {/* Document Type Dropdown */}
          <FormField>
            <Label className="font-bold">Document Type</Label>
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="AUTO_DETECT">✨ Auto-Detect Document Type (AI Agent Classification)</option>
              <option value="Bill of Lading">Bill of Lading (B/L)</option>
              <option value="Commercial Invoice">Commercial Invoice</option>
              <option value="Packing List">Packing List</option>
              <option value="Arrival Notice">Arrival Notice</option>
              <option value="Insurance Certificate">Insurance Certificate</option>
              <option value="Certificate of Origin">Certificate of Origin</option>
              <option value="Customs Entry Summary">Customs Entry Summary (CBP 7501)</option>
            </Select>
          </FormField>

          {/* Drag and Drop File Input */}
          <FormField>
            <Label className="font-bold">Select Files</Label>
            <div className="relative border-2 border-dashed border-border hover:border-brand rounded-2xl p-6 text-center bg-surface-muted transition-all cursor-pointer group">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.edi"
                aria-label="Select one or more documents to upload"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-white border border-border flex items-center justify-center text-brand group-hover:scale-110 transition-transform">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-ink">
                    {files.length === 0
                      ? "Click to upload or drag & drop"
                      : files.length === 1
                        ? files[0].name
                        : `${files.length} files selected`}
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {files.length === 0
                      ? "PDF, PNG, JPG, XLSX or EDI up to 25MB each"
                      : `${(files.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1)} KB total`}
                  </p>
                </div>
              </div>
            </div>
            {files.length > 1 && (
              <ul className="text-xs text-ink-muted space-y-0.5 pt-1">
                {files.map((f) => (
                  <li key={f.name} className="truncate">
                    {f.name} — {(f.size / 1024).toFixed(1)} KB
                  </li>
                ))}
              </ul>
            )}
          </FormField>

          {/* AI Auto-Extraction Notice */}
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-brand shrink-0" />
            <span>
              Uploaded documents will be automatically parsed by the <strong>Document Intelligence Agent</strong>.
            </span>
          </div>

          </ModalBody>

          {/* Modal Action Buttons */}
          <ModalFooter>
            <Button variant="secondary" onClick={closeModal} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={isUploading || files.length === 0} loading={isUploading}>
              {!isUploading && <Upload className="w-4 h-4" />}
              <span>
                {isUploading
                  ? `Uploading ${uploadingName ?? ""}…`
                  : files.length > 1
                    ? `Upload ${files.length} files`
                    : "Upload & Parse"}
              </span>
            </Button>
          </ModalFooter>
        </>
      ) : (
        <>
          <ModalBody className="space-y-5">
          {/* Attach Existing Unattached Document */}
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center space-x-2">
            <Link2 className="w-4 h-4 text-brand shrink-0" />
            <span>
              Reattaching ports over the document&apos;s existing extracted data as-is and triggers
              the same agents a fresh upload would — no re-extraction needed.
            </span>
          </div>

          {/* No cap of its own: the body around it scrolls now, and a scroller
              inside a scroller gives the operator two bars to fight over. */}
          <div className="space-y-2">
            {unattachedDocs.length === 0 ? (
              <div className="p-4 text-center text-xs text-ink-muted">
                No detached documents available to attach.
              </div>
            ) : (
              unattachedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 rounded-xl bg-surface-muted border border-border flex items-center justify-between gap-2"
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-brand shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold text-ink text-xs truncate">{doc.docType}</p>
                      <p className="text-[10px] text-ink-muted truncate">{doc.fileName}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleAttachExisting(doc.id)}
                    disabled={attachingId === doc.id}
                    className="shrink-0"
                  >
                    {attachingId === doc.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    <span>Attach</span>
                  </Button>
                </div>
              ))
            )}
          </div>

          </ModalBody>

          <ModalFooter>
            <Button variant="secondary" onClick={closeModal}>
              Close
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
