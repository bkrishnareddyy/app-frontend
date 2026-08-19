"use client";

import { useState, useEffect } from "react";
import {
  FileSignature,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Building2,
  ShieldCheck,
  Search,
  RefreshCw,
  Clock,
} from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { ClientNavTabs } from "@/components/clients/ClientNavTabs";
import { Card, Button, Input, Badge } from "@/components/ui";

interface ImporterItem {
  id: string;
  name: string;
  irsEin?: string | null;
  cbpImporterNumber: string;
  bond?: {
    bondNumber: string;
    suretyName: string;
  } | null;
  powersOfAttorney?: Array<{
    id: string;
    status: string;
    documentUrl?: string | null;
    grantedAt?: string | null;
  }>;
  client?: {
    name: string;
  } | null;
}

export function PoaClient({ accountName }: { accountName: string }) {
  const [importers, setImporters] = useState<ImporterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "GRANTED" | "PENDING">("ALL");

  const fetchImporters = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/importers-of-record");
      if (res.ok) {
        const data = await res.json();
        setImporters(Array.isArray(data.importersOfRecord) ? data.importersOfRecord : []);
      }
    } catch (err) {
      console.error("Failed to fetch importers for POA", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImporters();
  }, []);

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

  const filteredImporters = importers.filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.cbpImporterNumber.toLowerCase().includes(search.toLowerCase()) ||
      (i.client?.name ?? "").toLowerCase().includes(search.toLowerCase());

    const hasPoa = i.powersOfAttorney?.some(
      (p) => p.status === "GRANTED" || p.status === "ACTIVE"
    );

    if (statusFilter === "GRANTED") return matchesSearch && hasPoa;
    if (statusFilter === "PENDING") return matchesSearch && !hasPoa;
    return matchesSearch;
  });

  const grantedCount = importers.filter((i) =>
    i.powersOfAttorney?.some((p) => p.status === "GRANTED" || p.status === "ACTIVE")
  ).length;

  const pendingCount = importers.length - grantedCount;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PanelHeading
        icon={FileSignature}
        badge="Legal Representation & Customs Authority"
        title="Powers of Attorney (POA)"
        subtitle={`Customs Power of Attorney authorizations granted to file customs entries for ${accountName}.`}
      />

      <ClientNavTabs />

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Total IOR Legal Entities</p>
            <p className="text-2xl font-bold text-ink">{importers.length}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Valid POAs Granted</p>
            <p className="text-2xl font-bold text-ink">{grantedCount}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Pending POA Uploads</p>
            <p className="text-2xl font-bold text-ink">{pendingCount}</p>
          </div>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-muted/30">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-ink-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by importer name or CBP number..."
                className="pl-9 bg-white"
              />
            </div>
            <div className="flex bg-surface-muted p-1 rounded-xl border border-border text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === "ALL" ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("GRANTED")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === "GRANTED" ? "bg-white text-emerald-700 shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                Granted
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("PENDING")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === "PENDING" ? "bg-white text-amber-700 shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                Pending
              </button>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={fetchImporters} className="gap-2 self-end sm:self-auto">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading Power of Attorney records...
          </div>
        ) : filteredImporters.length === 0 ? (
          <div className="py-16 text-center text-ink-muted">
            <FileSignature className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No Power of Attorney records found.</p>
            <p className="text-xs text-ink-muted mt-1">Select an Importer of Record to upload signed Power of Attorney documentation.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs font-semibold uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="px-6 py-3.5">Importer of Record</th>
                  <th className="px-6 py-3.5">CBP Importer #</th>
                  <th className="px-6 py-3.5">Bond Status</th>
                  <th className="px-6 py-3.5">POA Status</th>
                  <th className="px-6 py-3.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredImporters.map((importer) => {
                  const poaRecord = importer.powersOfAttorney?.[0];
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
                      <td className="px-6 py-4">
                        {importer.bond ? (
                          <Badge variant="success" className="inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            {importer.bond.bondNumber}
                          </Badge>
                        ) : (
                          <Badge variant="neutral">General Coverage</Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {hasPoa ? (
                          <div className="flex flex-col gap-1">
                            <Badge variant="success" className="inline-flex items-center gap-1 w-max">
                              <CheckCircle2 className="w-3 h-3" />
                              Granted / Active
                            </Badge>
                            {poaRecord?.grantedAt && (
                              <span className="text-[11px] text-ink-muted">
                                Granted {new Date(poaRecord.grantedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="warning" className="inline-flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Pending Document Upload
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
                            variant={hasPoa ? "outline" : "primary"}
                            size="sm"
                            disabled={uploadingId === importer.id}
                            className="text-xs gap-1.5 pointer-events-none"
                          >
                            {uploadingId === importer.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            {hasPoa ? "Re-upload POA" : "Upload Signed POA"}
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
    </div>
  );
}
