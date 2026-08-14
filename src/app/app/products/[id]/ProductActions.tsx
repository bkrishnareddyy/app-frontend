"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The write actions on the product detail page.
 *
 * Each one posts to its own endpoint and refreshes the server-rendered page,
 * so what the screen shows afterwards is what the database holds — not an
 * optimistic guess that could disagree with a rule the server applied.
 */

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const details = payload?.error?.details;
        const detailText = Array.isArray(details)
          ? details.map((d: { path?: string; message?: string }) => d.message).filter(Boolean).join(" ")
          : "";
        setError([payload?.error?.message ?? "That did not work.", detailText].filter(Boolean).join(" "));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("The request did not reach the server. Nothing changed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}

function ErrorNote({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-xs text-red-700 mt-2">
      {message}
    </p>
  );
}

const buttonClass =
  "h-8 px-3 rounded-lg border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50";
const primaryClass =
  "h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-50";
const inputClass = "h-9 px-3 rounded-xl border border-border text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted mb-1";

// ---------------------------------------------------------------------------
// Classifications
// ---------------------------------------------------------------------------

export function ClassificationReviewActions({
  productId,
  classificationId,
  status,
  canApprove,
}: {
  productId: string;
  classificationId: string;
  status: string;
  canApprove: boolean;
}) {
  const { busy, error, run } = useAction();
  const base = `/api/products/${productId}/classifications/${classificationId}`;

  const act = (action: string) => run(base, "POST", { action });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "CANDIDATE" && (
          <button type="button" disabled={busy} onClick={() => act("PROPOSE")} className={buttonClass}>
            Put forward
          </button>
        )}
        {(status === "CANDIDATE" || status === "PROPOSED") && (
          <button type="button" disabled={busy} onClick={() => act("START_REVIEW")} className={buttonClass}>
            Start review
          </button>
        )}
        {status === "UNDER_REVIEW" && canApprove && (
          <button type="button" disabled={busy} onClick={() => act("APPROVE")} className={primaryClass}>
            Approve for this jurisdiction
          </button>
        )}
        {status === "UNDER_REVIEW" && !canApprove && (
          <span className="text-xs text-[#6E6E73]">
            Approving needs products.classification.approve.
          </span>
        )}
        {status !== "APPROVED" && status !== "REJECTED" && status !== "SUPERSEDED" && (
          <button type="button" disabled={busy} onClick={() => act("REJECT")} className={buttonClass}>
            Reject
          </button>
        )}
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

export function ProposeClassificationForm({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const [jurisdiction, setJurisdiction] = useState("");
  const [nomenclature, setNomenclature] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/products/${productId}/classifications`, "POST", {
      jurisdiction,
      nomenclature,
      classificationCode: code,
      description: description === "" ? undefined : description,
      decisionMethod: "MANUAL",
    });
    if (ok) {
      setCode("");
      setDescription("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Propose a classification</h3>
        <p className="text-xs text-[#6E6E73] mt-1">
          For one jurisdiction. Qubere checks the shape of the code, not whether it exists in that
          country&apos;s tariff, and it does not classify goods for you.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="jurisdiction" className={labelClass}>
            Jurisdiction
          </label>
          <input
            id="jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            placeholder="US"
            maxLength={16}
            required
            className={`${inputClass} w-full uppercase`}
          />
        </div>
        <div>
          <label htmlFor="nomenclature" className={labelClass}>
            Nomenclature
          </label>
          <input
            id="nomenclature"
            value={nomenclature}
            onChange={(e) => setNomenclature(e.target.value)}
            placeholder="HTSUS"
            maxLength={32}
            required
            className={`${inputClass} w-full uppercase`}
          />
        </div>
        <div>
          <label htmlFor="code" className={labelClass}>
            Code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="8481.80.5090"
            maxLength={32}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="classification-description" className={labelClass}>
            Note
          </label>
          <input
            id="classification-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Propose"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Country facts
// ---------------------------------------------------------------------------

export function CountryFactReviewActions({
  productId,
  factId,
  status,
  canVerify,
}: {
  productId: string;
  factId: string;
  status: string;
  canVerify: boolean;
}) {
  const { busy, error, run } = useAction();
  const base = `/api/products/${productId}/country-facts/${factId}`;
  const act = (action: string) => run(base, "POST", { action });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "CLAIMED" && (
          <button type="button" disabled={busy} onClick={() => act("START_REVIEW")} className={buttonClass}>
            Start review
          </button>
        )}
        {status === "UNDER_REVIEW" && canVerify && (
          <button type="button" disabled={busy} onClick={() => act("VERIFY")} className={primaryClass}>
            Verified against evidence
          </button>
        )}
        {status === "UNDER_REVIEW" && !canVerify && (
          <span className="text-xs text-[#6E6E73]">Verifying needs products.origin.verify.</span>
        )}
        {(status === "CLAIMED" || status === "UNDER_REVIEW") && (
          <button type="button" disabled={busy} onClick={() => act("REJECT")} className={buttonClass}>
            Reject
          </button>
        )}
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

export function AddCountryFactForm({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const [factType, setFactType] = useState("MANUFACTURE_COUNTRY");
  const [country, setCountry] = useState("");
  const [sourceReference, setSourceReference] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/products/${productId}/country-facts`, "POST", {
      factType,
      country,
      sourceType: "USER",
      sourceReference: sourceReference === "" ? undefined : sourceReference,
    });
    if (ok) {
      setCountry("");
      setSourceReference("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Record a country fact</h3>
        <p className="text-xs text-[#6E6E73] mt-1">
          Say which claim this is. Nothing here infers origin from a manufacturer address, a
          supplier, or where the goods were shipped from.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="factType" className={labelClass}>
            Claim
          </label>
          <select
            id="factType"
            value={factType}
            onChange={(e) => setFactType(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="MANUFACTURE_COUNTRY">Country of manufacture</option>
            <option value="PRODUCTION_COUNTRY">Country of production</option>
            <option value="ORIGIN_CLAIM">Claimed country of origin</option>
          </select>
        </div>
        <div>
          <label htmlFor="country-value" className={labelClass}>
            Country
          </label>
          <input
            id="country-value"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={100}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="sourceReference" className={labelClass}>
            Where this came from
          </label>
          <input
            id="sourceReference"
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
            placeholder="e.g. supplier declaration 2026-02-11"
            maxLength={500}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Record"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Attributes, composition, identifiers
// ---------------------------------------------------------------------------

export function AddAttributeForm({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const [attributeCode, setAttributeCode] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [rawUnit, setRawUnit] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/products/${productId}/attributes`, "POST", {
      attributeCode,
      rawValue,
      rawUnit: rawUnit === "" ? undefined : rawUnit,
      sourceType: "USER",
    });
    if (ok) {
      setAttributeCode("");
      setRawValue("");
      setRawUnit("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Set an attribute</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="attributeCode" className={labelClass}>
            Code
          </label>
          <input
            id="attributeCode"
            value={attributeCode}
            onChange={(e) => setAttributeCode(e.target.value)}
            placeholder="MATERIAL"
            maxLength={64}
            required
            className={`${inputClass} w-full uppercase`}
          />
        </div>
        <div>
          <label htmlFor="rawValue" className={labelClass}>
            Value
          </label>
          <input
            id="rawValue"
            value={rawValue}
            onChange={(e) => setRawValue(e.target.value)}
            maxLength={2000}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="rawUnit" className={labelClass}>
            Unit
          </label>
          <input
            id="rawUnit"
            value={rawUnit}
            onChange={(e) => setRawUnit(e.target.value)}
            maxLength={32}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Set"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

export function AddCompositionForm({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const [material, setMaterial] = useState("");
  const [percentage, setPercentage] = useState("");
  const [grade, setGrade] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = percentage.trim() === "" ? null : Number(percentage);
    const ok = await run(`/api/products/${productId}/compositions`, "POST", {
      material,
      percentage: parsed !== null && Number.isFinite(parsed) ? parsed : undefined,
      grade: grade === "" ? undefined : grade,
      sourceType: "USER",
    });
    if (ok) {
      setMaterial("");
      setPercentage("");
      setGrade("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Add a material</h3>
        <p className="text-xs text-[#6E6E73] mt-1">
          Leave the percentage blank if the source did not state one. It is never inferred to make a
          declaration reach 100%.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="material" className={labelClass}>
            Material
          </label>
          <input
            id="material"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            maxLength={200}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="percentage" className={labelClass}>
            Percentage by weight
          </label>
          <input
            id="percentage"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            inputMode="decimal"
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="grade" className={labelClass}>
            Grade or alloy
          </label>
          <input
            id="grade"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            maxLength={100}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Add"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

export function AddIdentifierForm({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const [identifierType, setIdentifierType] = useState("MANUFACTURER_PART_NUMBER");
  const [value, setValue] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/products/${productId}/identifiers`, "POST", {
      identifierType,
      value,
      sourceType: "USER",
    });
    if (ok) setValue("");
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add an identifier</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="identifier-type" className={labelClass}>
            Scheme
          </label>
          <select
            id="identifier-type"
            value={identifierType}
            onChange={(e) => setIdentifierType(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="INTERNAL_SKU">Internal SKU</option>
            <option value="CUSTOMER_SKU">Customer SKU</option>
            <option value="SUPPLIER_SKU">Supplier SKU</option>
            <option value="MANUFACTURER_PART_NUMBER">Manufacturer part number</option>
            <option value="MODEL_NUMBER">Model number</option>
            <option value="GTIN">GTIN</option>
            <option value="UPC">UPC</option>
            <option value="EAN">EAN</option>
            <option value="STYLE_NUMBER">Style number</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="identifier-value" className={labelClass}>
            Value
          </label>
          <input
            id="identifier-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={128}
            required
            className={`${inputClass} w-full`}
          />
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Add"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

export function RemoveRowButton({
  url,
  label = "Remove",
}: {
  url: string;
  label?: string;
}) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={busy} onClick={() => run(url, "DELETE")} className={buttonClass}>
        {label}
      </button>
      <ErrorNote message={error} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Revalidation flags
// ---------------------------------------------------------------------------

export function RevalidationActions({
  productId,
  flagId,
}: {
  productId: string;
  flagId: string;
}) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const base = `/api/products/${productId}/revalidation/${flagId}`;

  return (
    <div className="space-y-2">
      <label htmlFor={`note-${flagId}`} className="sr-only">
        What you checked
      </label>
      <input
        id={`note-${flagId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did you check?"
        maxLength={2000}
        className={`${inputClass} w-full`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(base, "POST", { action: "RESOLVE", note: note || undefined })}
          className={primaryClass}
        >
          Looked at it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(base, "POST", { action: "DISMISS", note: note || undefined })}
          className={buttonClass}
        >
          Not relevant
        </button>
      </div>
      <p className="text-xs text-[#6E6E73]">
        Closing this records that a person looked. It changes no classification and no origin.
      </p>
      <ErrorNote message={error} />
    </div>
  );
}

export function EnrichProductAction({ productId }: { productId: string }) {
  const { busy, error, run } = useAction();
  const base = `/api/products/${productId}/enrich`;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(base, "POST", {})}
        className={primaryClass}
      >
        {busy ? "Enriching..." : "Enrich with AI"}
      </button>
      <ErrorNote message={error} />
    </div>
  );
}
