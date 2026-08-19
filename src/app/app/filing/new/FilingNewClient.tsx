"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  Save,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import DynamicFormRenderer from "../[id]/DynamicFormRenderer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";

export function FilingNewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const country = searchParams.get("country");
  const procedure = searchParams.get("procedure");
  const message = searchParams.get("message");

  const [activeTab, setActiveTab] = useState<"overview" | "declaration" | "response">("declaration");
  const [declarationData, setDeclarationData] = useState<any>({});
  const [localReferenceNumber, setLocalReferenceNumber] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showTransmitModal, setShowTransmitModal] = useState(false);

  // Redirect if missing required params
  useEffect(() => {
    if (!country || !procedure || !message) {
      router.push("/app/filing");
    }
  }, [country, procedure, message, router]);

  if (!country || !procedure || !message) {
    return null;
  }

  function updateDeclarationField(path: string, value: any) {
    setDeclarationData((prev: any) => {
      const newData = { ...prev };
      const pathArray = path.split('.');
      let current = newData;
      for (let i = 0; i < pathArray.length - 1; i++) {
        if (!current[pathArray[i]]) current[pathArray[i]] = {};
        current = current[pathArray[i]];
      }
      current[pathArray[pathArray.length - 1]] = value;
      return newData;
    });
  }

  function handleLocalReferenceNumberChange(value: string) {
    setLocalReferenceNumber(value);
    // Automatically sync to GoodsDeclaration.ReferenceNumber
    updateDeclarationField("GoodsDeclaration.ReferenceNumber", value);
  }

  async function handleSaveDraft() {
    setBusy("saveDraft");
    setError(null);
    setSuccess(null);
    
    // Validate mandatory field
    if (!localReferenceNumber || localReferenceNumber.trim() === "") {
      setError("Local Reference Number is required");
      setBusy(null);
      return;
    }
    
    try {
      // Create filing with declaration data
      const res = await fetch("/api/filing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          procedureCode: procedure,
          messageName: message,
          standalone: true,
          declarationData,
          localReferenceNumber: localReferenceNumber.trim(),
          registrationNumber: registrationNumber?.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Failed to save filing");
      }

      setSuccess(`Filing saved successfully!`);
      
      // Redirect to the created filing
      setTimeout(() => {
        router.push(`/app/filing/${data.filing.id}`);
      }, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleTransmit() {
    setBusy("transmit");
    setError(null);
    setSuccess(null);

    // Validate mandatory field
    if (!localReferenceNumber || localReferenceNumber.trim() === "") {
      setError("Local Reference Number is required");
      setBusy(null);
      setShowTransmitModal(false);
      return;
    }

    try {
      // First create the filing
      const createRes = await fetch("/api/filing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          procedureCode: procedure,
          messageName: message,
          standalone: true,
          declarationData,
          localReferenceNumber: localReferenceNumber.trim(),
          registrationNumber: registrationNumber?.trim() || undefined,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error?.message || createData.error || "Failed to create filing");
      }

      // Then transmit it
      const transmitRes = await fetch(`/api/filing/${createData.filing.id}/transmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const transmitData = await transmitRes.json();
      if (!transmitRes.ok) {
        throw new Error(transmitData.error?.message || transmitData.error || "Failed to transmit filing");
      }

      setSuccess(`Filing transmitted successfully!`);
      setShowTransmitModal(false);

      // Redirect to the filing
      setTimeout(() => {
        router.push(`/app/filing/${createData.filing.id}`);
      }, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setShowTransmitModal(false);
    } finally {
      setBusy(null);
    }
  }

  const filingBadgeVariant = "default";

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface via-surface to-surface-dark">
      {/* Header */}
      <div className="border-b border-border bg-surface">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center space-x-4">
              <Link href="/app/filing">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Filings
                </Button>
              </Link>

              <div className="h-6 w-px bg-border" />

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-ink">New Filing</h1>
                  <Badge variant={filingBadgeVariant}>Draft (Unsaved)</Badge>
                </div>
                <p className="text-sm text-ink-muted mt-1">
                  {country} · {procedure} · {message}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveDraft}
                loading={busy === "saveDraft"}
                disabled={!!busy}
                variant="outline"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
              <Button
                onClick={() => setShowTransmitModal(true)}
                loading={busy === "transmit"}
                disabled={!!busy}
              >
                <Send className="w-4 h-4 mr-2" />
                Transmit to Customs
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Alert Messages */}
        {error && (
          <Alert variant="error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert variant="success">
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {/* Filing Information */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-xs font-bold text-ink mb-3">Filing Information</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-ink-muted font-bold">Country</span>
              <p className="text-ink font-mono">{country || "—"}</p>
            </div>
            <div>
              <span className="text-ink-muted font-bold">Procedure Code</span>
              <p className="text-ink font-mono">{procedure || "—"}</p>
            </div>
            <div>
              <span className="text-ink-muted font-bold">Message Name</span>
              <p className="text-ink font-mono">{message || "—"}</p>
            </div>
          </div>
        </div>

        {/* Local Reference Number and Registration Number */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="localReferenceNumber" className="text-xs font-bold text-ink">
                Local Reference Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="localReferenceNumber"
                type="text"
                value={localReferenceNumber}
                onChange={(e) => handleLocalReferenceNumberChange(e.target.value)}
                placeholder="Enter local reference number"
                className="mt-1"
              />
              <p className="text-xs text-ink-muted mt-1">
                Required for save and transmit.
              </p>
            </div>
            <div>
              <Label htmlFor="registrationNumber" className="text-xs font-bold text-ink">
                Registration Number
              </Label>
              <Input
                id="registrationNumber"
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="Enter registration number"
                className="mt-1"
              />
              <p className="text-xs text-ink-muted mt-1">
                Optional registration or license number.
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-border shadow-2xs w-fit">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "overview" ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("declaration")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "declaration" ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            Declaration
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("response")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "response" ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            Response
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <Card className="bg-surface border-border shadow-glow">
            <div className="p-6">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider mb-4">
                Filing Overview
              </h3>
              <p className="text-sm text-ink-muted">
                This is a new filing that has not been saved yet. Fill out the declaration form and save as draft or transmit directly to customs.
              </p>
            </div>
          </Card>
        )}

        {activeTab === "declaration" && (
          <Card className="bg-surface border-border shadow-glow">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider">
                    Declaration Details
                  </h3>
                  <Badge variant="warning">Unsaved</Badge>
                </div>
              </div>

              {/* Dynamic Form Renderer */}
              <DynamicFormRenderer
                country={country}
                procedureCode={procedure}
                messageName={message}
                messageType="request"
                data={declarationData}
                onChange={updateDeclarationField}
                readOnly={false}
              />
            </div>
          </Card>
        )}

        {activeTab === "response" && (
          <Card className="bg-surface border-border shadow-glow">
            <div className="p-6">
              <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider mb-4">
                Customs Response
              </h3>
              <p className="text-sm text-ink-muted">
                No response yet. Submit the filing to receive a response from customs.
              </p>
            </div>
          </Card>
        )}
      </div>

      {/* Transmit Confirmation Modal */}
      <Modal
        isOpen={showTransmitModal}
        onClose={() => setShowTransmitModal(false)}
        titleId="transmit-modal"
      >
        <ModalHeader
          titleId="transmit-modal"
          title="Transmit to Customs"
          subtitle="This will create and submit the filing"
          icon={<Send className="w-5 h-5" />}
          onClose={() => setShowTransmitModal(false)}
        />
        <ModalBody>
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Confirm Transmission</AlertTitle>
              <AlertDescription>
                This filing will be created and transmitted to customs authorities. This action cannot be undone.
              </AlertDescription>
            </Alert>
            <div className="text-sm text-ink-muted space-y-2">
              <p><strong>Country:</strong> {country}</p>
              <p><strong>Procedure:</strong> {procedure}</p>
              <p><strong>Message:</strong> {message}</p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowTransmitModal(false)}
              disabled={busy === "transmit"}
            >
              Cancel
            </Button>
            <Button
              onClick={handleTransmit}
              loading={busy === "transmit"}
              disabled={busy === "transmit"}
            >
              <Send className="w-4 h-4 mr-2" />
              Confirm & Transmit
            </Button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
}
