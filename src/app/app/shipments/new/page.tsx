"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Package, ShieldCheck, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardHeaderIcon } from "@/components/ui/Card";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input, Select, Label, FormField } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { COUNTRIES } from "@/modules/shipment/countryCode";

export default function NewShipmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);

  const [formData, setFormData] = useState({
    importerName: "ABC Manufacturing India Pvt Ltd",
    poReference: "PO-2026-849102",
    entryType: "Consumption Entry",
    incoterm: "CIF Los Angeles",
    portOfEntry: "Port of Los Angeles (2704)",
    carrierName: "Maersk Line",
    countryOfExport: "Germany",
    destinationCountry: "",
    estimatedArrival: "2026-05-20",
    clientId: "",
  });

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients || []))
      .catch((err) => console.error("Failed to fetch clients:", err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, clientId: formData.clientId || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Failed to create shipment");
      }

      const shipmentId = data.shipment?.id;
      if (shipmentId) {
        router.push(`/app/shipments/${shipmentId}`);
      } else {
        router.push("/app/shipments");
      }
    } catch (err: unknown) {
      console.error("Error creating shipment:", err);
      setError(err instanceof Error ? err.message : "Failed to create shipment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex items-center space-x-4">
        <Link
          href="/app/dashboard"
          className="p-2 bg-white border border-border rounded-xl hover:bg-surface-muted transition-all text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <Badge variant="info">Shipment Management</Badge>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-1">Create New Shipment</h1>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center space-x-3 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Form Card */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardHeaderIcon>
              <Package className="w-5 h-5" />
            </CardHeaderIcon>
            <div>
              <h2 className="text-base font-semibold text-ink">Shipment & Importer Details</h2>
              <p className="text-xs text-ink-muted">Enter logistics details to initialize compliance checking & document ingestion.</p>
            </div>
          </CardHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField>
              <Label>Importer of Record Name *</Label>
              <Input
                required
                value={formData.importerName}
                onChange={(e) => setFormData({ ...formData, importerName: e.target.value })}
                placeholder="e.g. ABC Manufacturing India Pvt Ltd"
              />
            </FormField>

            <FormField>
              <Label>Purchase Order (PO) Reference</Label>
              <Input
                value={formData.poReference}
                onChange={(e) => setFormData({ ...formData, poReference: e.target.value })}
                placeholder="e.g. PO-778899"
              />
            </FormField>

            <FormField>
              <Label>Customs Entry Type</Label>
              <Select
                value={formData.entryType}
                onChange={(e) => setFormData({ ...formData, entryType: e.target.value })}
              >
                <option value="Consumption Entry">Consumption Entry (Type 01)</option>
                <option value="Informal Entry">Informal Entry (Type 11)</option>
                <option value="In-Bond Entry">In-Bond Entry (Type 61)</option>
                <option value="Foreign Trade Zone Entry">Foreign Trade Zone (Type 06)</option>
                <option value="Temporary Importation under Bond">TIB Entry (Type 23)</option>
              </Select>
            </FormField>

            <FormField>
              <Label>Incoterms & Delivery Port</Label>
              <Input
                value={formData.incoterm}
                onChange={(e) => setFormData({ ...formData, incoterm: e.target.value })}
                placeholder="e.g. CIF Los Angeles"
              />
            </FormField>

            <FormField>
              <Label>US Port of Entry</Label>
              <Input
                value={formData.portOfEntry}
                onChange={(e) => setFormData({ ...formData, portOfEntry: e.target.value })}
                placeholder="e.g. Port of Los Angeles (2704)"
              />
            </FormField>

            <FormField>
              <Label>Carrier / Ocean Vessel</Label>
              <Input
                value={formData.carrierName}
                onChange={(e) => setFormData({ ...formData, carrierName: e.target.value })}
                placeholder="e.g. Maersk Line"
              />
            </FormField>

            <FormField>
              <Label>Country of Export</Label>
              <Input
                value={formData.countryOfExport}
                onChange={(e) => setFormData({ ...formData, countryOfExport: e.target.value })}
                placeholder="e.g. Germany"
              />
            </FormField>

            <FormField>
              <Label>Destination Country *</Label>
              <Select
                required
                value={formData.destinationCountry}
                onChange={(e) => setFormData({ ...formData, destinationCountry: e.target.value })}
              >
                <option value="">Select the country this shipment is being imported into</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField>
              <Label>Estimated Date of Arrival (ETA)</Label>
              <Input
                type="date"
                value={formData.estimatedArrival}
                onChange={(e) => setFormData({ ...formData, estimatedArrival: e.target.value })}
              />
            </FormField>

            <FormField>
              <Label>Client</Label>
              <Select
                value={formData.clientId}
                onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              >
                <option value="">No Client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {/* Submit Actions */}
          <div className="pt-6 mt-6 border-t border-border flex items-center justify-end space-x-3">
            <Link href="/app/dashboard" className={buttonVariants({ variant: "secondary", size: "md" })}>
              Cancel
            </Link>
            <Button type="submit" loading={loading}>
              {!loading && <ShieldCheck className="w-4 h-4" />}
              <span>{loading ? "Creating Shipment..." : "Initialize Shipment"}</span>
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
