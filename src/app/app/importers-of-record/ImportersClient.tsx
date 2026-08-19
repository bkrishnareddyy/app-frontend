"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  FileSignature,
  Search,
  RefreshCw,
  Upload,
} from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { ClientNavTabs } from "@/components/clients/ClientNavTabs";
import { Card, Button, Input, Label, Badge } from "@/components/ui";

interface ImporterItem {
  id: string;
  name: string;
  irsEin?: string | null;
  cbpImporterNumber: string;
  address?: unknown;
  bondId?: string | null;
  bond?: {
    id: string;
    bondNumber: string;
    suretyName: string;
    bondAmount: number;
    bondType: string;
  } | null;
  powersOfAttorney?: Array<{
    id: string;
    status: string;
    documentUrl?: string | null;
    grantedAt?: string | null;
  }>;
  client?: {
    id: string;
    name: string;
  } | null;
  createdAt?: string;
}

export function ImportersClient({ accountName }: { accountName: string }) {
  const [importers, setImporters] = useState<ImporterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [cbpImporterNumber, setCbpImporterNumber] = useState("");
  const [irsEin, setIrsEin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const fetchImporters = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/importers-of-record");
      if (res.ok) {
        const data = await res.json();
        setImporters(Array.isArray(data.importersOfRecord) ? data.importersOfRecord : []);
      }
    } catch (err) {
      console.error("Failed to fetch importers of record", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImporters();
  }, []);

  const handleCreateImporter = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !cbpImporterNumber.trim()) {
      setFormError("Legal Name and CBP Importer Number are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/importers-of-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          cbpImporterNumber: cbpImporterNumber.trim(),
          irsEin: irsEin.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setModalOpen(false);
        setName("");
        setCbpImporterNumber("");
        setIrsEin("");
        fetchImporters();
      } else {
        setFormError(data.error || "Failed to add Importer of Record.");
      }
    } catch {
      setFormError("Network error while creating Importer of Record.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePoaUpload = async (importerId: string, file: File) => {
    setUploadingId(importerId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/importers-of-record/${importerId}/poa`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        fetchImporters();
      } else {
        alert("Failed to upload Power of Attorney document.");
      }
    } catch {
      alert("Error uploading POA document.");
    } finally {
      setUploadingId(null);
    }
  };

  const filteredImporters = importers.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.cbpImporterNumber.toLowerCase().includes(search.toLowerCase()) ||
    (i.irsEin ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (i.client?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const poaGrantedCount = importers.filter((i) =>
    i.powersOfAttorney?.some((p) => p.status === "GRANTED" || p.status === "ACTIVE")
  ).length;

  const bondActiveCount = importers.filter((i) => i.bond || i.bondId).length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PanelHeading
          icon={Building2}
          badge="Enterprise Entity Management"
          title="Importers of Record (IOR)"
          subtitle={`Registered CBP Importers of Record, EIN tax identities, and legal entities for ${accountName}.`}
        />
        <Button onClick={() => setModalOpen(true)} className="flex items-center gap-2 self-start md:self-auto">
          <Plus className="w-4 h-4" />
          Add Importer of Record
        </Button>
      </div>

      <ClientNavTabs />

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Registered Importers</p>
            <p className="text-2xl font-bold text-ink">{importers.length}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Active Bonds Covered</p>
            <p className="text-2xl font-bold text-ink">{bondActiveCount}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
            <FileSignature className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Valid POAs on File</p>
            <p className="text-2xl font-bold text-ink">{poaGrantedCount}</p>
          </div>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-muted/30">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-3 text-ink-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by legal name, CBP number, or EIN..."
              className="pl-9 bg-white"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchImporters} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading Importers of Record...
          </div>
        ) : filteredImporters.length === 0 ? (
          <div className="py-16 text-center text-ink-muted">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No Importers of Record found.</p>
            <p className="text-xs text-ink-muted mt-1">Register a CBP Importer of Record to authorize customs filings.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs font-semibold uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="px-6 py-3.5">Importer / Legal Entity</th>
                  <th className="px-6 py-3.5">CBP Importer #</th>
                  <th className="px-6 py-3.5">IRS EIN</th>
                  <th className="px-6 py-3.5">Bond Status</th>
                  <th className="px-6 py-3.5">POA Status</th>
                  <th className="px-6 py-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredImporters.map((importer) => {
                  const hasPoa = importer.powersOfAttorney?.some(
                    (p) => p.status === "GRANTED" || p.status === "ACTIVE"
                  );
                  return (
                    <tr key={importer.id} className="hover:bg-surface-hover/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-ink">{importer.name}</div>
                        {importer.client && (
                          <div className="text-xs text-ink-muted mt-0.5">
                            Client: {importer.client.name}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-ink">
                        {importer.cbpImporterNumber}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-ink-muted">
                        {importer.irsEin || "—"}
                      </td>
                      <td className="px-6 py-4">
                        {importer.bond ? (
                          <Badge variant="success" className="inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            {importer.bond.bondNumber}
                          </Badge>
                        ) : (
                          <Badge variant="neutral">No Specific Bond</Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {hasPoa ? (
                          <Badge variant="success" className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            POA Granted
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="inline-flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Missing POA
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <label className="cursor-pointer inline-flex items-center">
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handlePoaUpload(importer.id, f);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingId === importer.id}
                            className="text-xs gap-1.5 pointer-events-none"
                          >
                            {uploadingId === importer.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            Upload POA
                          </Button>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-border space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                <Building2 className="w-5 h-5 text-brand" />
                Add Importer of Record
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-ink-muted hover:text-ink text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-600 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateImporter} className="space-y-4">
              <div>
                <Label htmlFor="legalName">Legal Name *</Label>
                <Input
                  id="legalName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pacific Logistics Holdings LLC"
                  required
                />
              </div>

              <div>
                <Label htmlFor="cbpNumber">CBP Importer Number *</Label>
                <Input
                  id="cbpNumber"
                  value={cbpImporterNumber}
                  onChange={(e) => setCbpImporterNumber(e.target.value)}
                  placeholder="e.g. 95-382910400"
                  required
                />
              </div>

              <div>
                <Label htmlFor="irsEin">IRS EIN / Tax ID</Label>
                <Input
                  id="irsEin"
                  value={irsEin}
                  onChange={(e) => setIrsEin(e.target.value)}
                  placeholder="e.g. 95-3829104"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Importer
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
