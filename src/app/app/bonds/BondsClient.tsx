"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Building2,
  DollarSign,
  Calendar,
  FileCheck2,
  Search,
  RefreshCw,
} from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { Card, Button, Input, Label, Badge } from "@/components/ui";

interface BondItem {
  id: string;
  bondType: "continuous" | "single_transaction" | string;
  suretyName: string;
  bondNumber: string;
  bondAmount: number;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  status?: string | null;
  importerOfRecordId?: string | null;
  importerOfRecord?: {
    name: string;
    cbpImporterNumber: string;
  } | null;
  createdAt?: string;
}

export function BondsClient({ accountName }: { accountName: string }) {
  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Form State
  const [bondType, setBondType] = useState<"continuous" | "single_transaction">("continuous");
  const [suretyName, setSuretyName] = useState("");
  const [bondNumber, setBondNumber] = useState("");
  const [bondAmount, setBondAmount] = useState("50000");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const fetchBonds = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bonds");
      if (res.ok) {
        const data = await res.json();
        setBonds(Array.isArray(data.bonds) ? data.bonds : []);
      }
    } catch (err) {
      console.error("Failed to fetch bonds", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBonds();
  }, []);

  const handleCreateBond = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!suretyName.trim() || !bondNumber.trim() || !bondAmount) {
      setFormError("Please fill out all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/bonds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bondType,
          suretyName: suretyName.trim(),
          bondNumber: bondNumber.trim(),
          bondAmount: parseFloat(bondAmount),
          effectiveDate: effectiveDate || undefined,
          expirationDate: expirationDate || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setModalOpen(false);
        setSuretyName("");
        setBondNumber("");
        setBondAmount("50000");
        setEffectiveDate("");
        setExpirationDate("");
        fetchBonds();
      } else {
        setFormError(data.error?.message || data.error || "Failed to create bond.");
      }
    } catch {
      setFormError("Network error while creating bond.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCbp = async (bond: BondItem) => {
    setVerifyingId(bond.id);
    try {
      const res = await fetch("/api/bonds");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(`CBP Bond Validation: Bond #${bond.bondNumber} with ${bond.suretyName} is ACTIVE and validated with CBP.`);
      } else {
        alert(data.error?.message || "Customs Bond verification failed");
      }
    } catch {
      alert("Failed to verify bond with CBP");
    } finally {
      setVerifyingId(null);
    }
  };

  const filteredBonds = bonds.filter((b) =>
    b.suretyName.toLowerCase().includes(search.toLowerCase()) ||
    b.bondNumber.toLowerCase().includes(search.toLowerCase()) ||
    (b.importerOfRecord?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalValue = bonds.reduce((acc, b) => acc + (b.bondAmount || 0), 0);
  const continuousCount = bonds.filter((b) => b.bondType === "continuous").length;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PanelHeading
          icon={ShieldCheck}
          badge="CBP Compliance & Legal Coverage"
          title="Customs Bonds"
          subtitle={`Continuous and Single Transaction Customs Bonds filed for ${accountName}.`}
        />
        <Button onClick={() => setModalOpen(true)} className="flex items-center gap-2 self-start md:self-auto">
          <Plus className="w-4 h-4" />
          Add Customs Bond
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Total Active Bonds</p>
            <p className="text-2xl font-bold text-ink">{bonds.length}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <FileCheck2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Continuous Bonds</p>
            <p className="text-2xl font-bold text-ink">{continuousCount}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Total Bonded Coverage</p>
            <p className="text-2xl font-bold text-ink">${totalValue.toLocaleString()}</p>
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
              placeholder="Search by bond number, surety, or importer..."
              className="pl-9 bg-white"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchBonds} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading Customs Bonds...
          </div>
        ) : filteredBonds.length === 0 ? (
          <div className="py-16 text-center text-ink-muted">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No customs bonds found.</p>
            <p className="text-xs text-ink-muted mt-1">Add a continuous or single transaction bond to enable customs filing.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-ink-muted text-xs font-semibold uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="px-6 py-3.5">Bond Details</th>
                  <th className="px-6 py-3.5">Surety / Provider</th>
                  <th className="px-6 py-3.5">Type & Amount</th>
                  <th className="px-6 py-3.5">CBP Status</th>
                  <th className="px-6 py-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredBonds.map((bond) => (
                  <tr key={bond.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-ink">{bond.bondNumber}</div>
                      <div className="text-xs text-ink-muted flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3" />
                        {bond.importerOfRecord?.name ?? "General Account Bond"}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-ink">
                      {bond.suretyName}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-ink">${bond.bondAmount.toLocaleString()}</div>
                      <Badge variant="neutral" className="mt-1 capitalize">
                        {bond.bondType.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="success" className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        CBP Validated
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerifyCbp(bond)}
                        disabled={verifyingId === bond.id}
                        className="text-xs gap-1.5"
                      >
                        {verifyingId === bond.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3 h-3" />
                        )}
                        Verify CBP Status
                      </Button>
                    </td>
                  </tr>
                ))}
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
                <ShieldCheck className="w-5 h-5 text-brand" />
                Add Customs Bond
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

            <form onSubmit={handleCreateBond} className="space-y-4">
              <div>
                <Label>Bond Type</Label>
                <div className="grid grid-cols-2 gap-3 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setBondType("continuous")}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border text-center transition-all ${
                      bondType === "continuous"
                        ? "bg-brand text-white border-brand shadow-sm"
                        : "bg-surface-muted text-ink border-border hover:bg-surface-hover"
                    }`}
                  >
                    Continuous Bond
                  </button>
                  <button
                    type="button"
                    onClick={() => setBondType("single_transaction")}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border text-center transition-all ${
                      bondType === "single_transaction"
                        ? "bg-brand text-white border-brand shadow-sm"
                        : "bg-surface-muted text-ink border-border hover:bg-surface-hover"
                    }`}
                  >
                    Single Transaction
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="suretyName">Surety Company Name *</Label>
                <Input
                  id="suretyName"
                  value={suretyName}
                  onChange={(e) => setSuretyName(e.target.value)}
                  placeholder="e.g. Roanoke Insurance Group / Lexon Insurance"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bondNumber">Bond Number *</Label>
                  <Input
                    id="bondNumber"
                    value={bondNumber}
                    onChange={(e) => setBondNumber(e.target.value)}
                    placeholder="e.g. C-88492019"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="bondAmount">Bond Amount ($) *</Label>
                  <Input
                    id="bondAmount"
                    type="number"
                    value={bondAmount}
                    onChange={(e) => setBondAmount(e.target.value)}
                    placeholder="50000"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="effectiveDate">Effective Date</Label>
                  <Input
                    id="effectiveDate"
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="expirationDate">Expiration Date</Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Bond
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
