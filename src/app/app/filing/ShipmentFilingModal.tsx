"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Globe, CheckCircle2 } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select, Label, FormField } from "@/components/ui/Input";

interface Message {
  messageName: string;
  id: string;
}

interface Procedure {
  procedureCode: string;
  transactionType: string | null;
  messages: Message[];
}

interface Country {
  country: string;
  procedures: Procedure[];
}

interface ProcedureOption {
  procedureCode: string;
  messageName: string;
  transactionType: string | null;
  configId: string;
}

interface ShipmentFilingModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  defaultCountry?: string | null;
}

export function ShipmentFilingModal({ 
  isOpen, 
  onClose, 
  shipmentId,
  defaultCountry 
}: ShipmentFilingModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>(defaultCountry || "");
  const [availableOptions, setAvailableOptions] = useState<ProcedureOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<ProcedureOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available countries and procedures
  useEffect(() => {
    if (!isOpen) return;

    async function fetchProcedures() {
      try {
        setLoading(true);
        const res = await fetch("/api/filing/procedures");
        if (!res.ok) throw new Error("Failed to fetch procedures");
        const data = await res.json();
        setCountries(data.countries || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load filing procedures");
      } finally {
        setLoading(false);
      }
    }

    fetchProcedures();
  }, [isOpen]);

  // Update available options when country changes
  useEffect(() => {
    if (!selectedCountry) {
      setAvailableOptions([]);
      setSelectedOption(null);
      return;
    }

    const country = countries.find((c) => c.country === selectedCountry);
    if (!country) {
      setAvailableOptions([]);
      setSelectedOption(null);
      return;
    }

    const options: ProcedureOption[] = [];
    country.procedures.forEach((proc) => {
      proc.messages.forEach((msg) => {
        options.push({
          procedureCode: proc.procedureCode,
          messageName: msg.messageName,
          transactionType: proc.transactionType,
          configId: msg.id,
        });
      });
    });

    setAvailableOptions(options);
    setSelectedOption(null);
  }, [selectedCountry, countries]);

  async function handleCreate() {
    if (!selectedOption || !selectedCountry) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/filing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          country: selectedCountry,
          procedureCode: selectedOption.procedureCode,
          messageName: selectedOption.messageName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Failed to create filing");
      }

      // Navigate to the new filing
      router.push(`/app/filing/${data.filing.id}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create filing");
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedCountry(defaultCountry || "");
    setSelectedOption(null);
    setError(null);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="shipment-filing-title" size="lg">
      <ModalHeader
        titleId="shipment-filing-title"
        title="Create Filing from Shipment"
        subtitle="Select country, procedure, and message type"
        icon={<FileText className="w-5 h-5" />}
        onClose={onClose}
      />

      <ModalBody>
        {loading ? (
          <div className="py-12 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-brand border-r-transparent"></div>
            <p className="mt-4 text-sm text-ink-muted">Loading filing procedures...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Country Selection */}
            <FormField>
              <Label htmlFor="country">
                <Globe className="w-4 h-4 inline mr-2" />
                Country <span className="text-red-500">*</span>
              </Label>
              <Select
                id="country"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                disabled={submitting}
              >
                <option value="">Select a country...</option>
                {countries.map((c) => (
                  <option key={c.country} value={c.country}>
                    {c.country}
                  </option>
                ))}
              </Select>
              {defaultCountry && (
                <p className="text-xs text-ink-muted mt-1">
                  Defaulted to shipment's destination country
                </p>
              )}
            </FormField>

            {/* Procedure & Message Selection */}
            {selectedCountry && (
              <FormField>
                <Label htmlFor="procedure-message">
                  <FileText className="w-4 h-4 inline mr-2" />
                  Procedure & Message <span className="text-red-500">*</span>
                </Label>
                <Select
                  id="procedure-message"
                  value={selectedOption ? `${selectedOption.procedureCode}-${selectedOption.messageName}` : ""}
                  onChange={(e) => {
                    const [procedureCode, messageName] = e.target.value.split("-");
                    const option = availableOptions.find(
                      (o) => o.procedureCode === procedureCode && o.messageName === messageName
                    );
                    setSelectedOption(option || null);
                  }}
                  disabled={submitting || availableOptions.length === 0}
                >
                  <option value="">Select procedure and message...</option>
                  {availableOptions.map((opt) => (
                    <option
                      key={`${opt.procedureCode}-${opt.messageName}`}
                      value={`${opt.procedureCode}-${opt.messageName}`}
                    >
                      {opt.procedureCode} - {opt.messageName}
                      {opt.transactionType ? ` (${opt.transactionType})` : ""}
                    </option>
                  ))}
                </Select>
                {availableOptions.length === 0 && selectedCountry && (
                  <p className="text-xs text-red-600 mt-1">
                    No procedures configured for {selectedCountry}
                  </p>
                )}
              </FormField>
            )}

            {/* Selected Configuration Preview */}
            {selectedOption && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-blue-900">Selected Configuration</p>
                    <div className="mt-2 space-y-1 text-xs text-blue-800">
                      <p><strong>Country:</strong> {selectedCountry}</p>
                      <p><strong>Procedure:</strong> {selectedOption.procedureCode}</p>
                      <p><strong>Message:</strong> {selectedOption.messageName}</p>
                      {selectedOption.transactionType && (
                        <p><strong>Transaction Type:</strong> {selectedOption.transactionType}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-between w-full">
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={submitting || loading}
          >
            Reset
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!selectedOption || submitting || loading}
              loading={submitting}
            >
              Create Filing
            </Button>
          </div>
        </div>
      </ModalFooter>
    </Modal>
  );
}
