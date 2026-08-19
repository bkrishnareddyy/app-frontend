"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { matchStatusPresentation } from "@/modules/product/productDisplay";

interface FieldIssue {
  path: string;
  message: string;
}

interface ProductMatchCandidate {
  productId: string;
  explanation: string;
}

interface ProductMatchResult {
  status: string;
  candidates: ProductMatchCandidate[];
}

const IDENTIFIER_TYPES = [
  ["INTERNAL_SKU", "Internal SKU"],
  ["CUSTOMER_SKU", "Customer SKU"],
  ["SUPPLIER_SKU", "Supplier SKU"],
  ["MANUFACTURER_PART_NUMBER", "Manufacturer part number"],
  ["MODEL_NUMBER", "Model number"],
  ["GTIN", "GTIN"],
  ["UPC", "UPC"],
  ["EAN", "EAN"],
  ["STYLE_NUMBER", "Style number"],
  ["OTHER", "Other"],
] as const;

const COUNTRY_FACT_TYPES = [
  ["MANUFACTURE_COUNTRY", "Country of manufacture — where the goods are made"],
  ["PRODUCTION_COUNTRY", "Country of production"],
  ["ORIGIN_CLAIM", "Claimed country of origin — a claim someone is making"],
] as const;

export function NewProductForm(props: { clients?: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const [clientId, setClientId] = useState("");
  const [identifierType, setIdentifierType] = useState<string>("MANUFACTURER_PART_NUMBER");
  const [identifierValue, setIdentifierValue] = useState("");
  const [countryFactType, setCountryFactType] = useState<string>("");
  const [country, setCountry] = useState("");

  const [duplicateMatch, setDuplicateMatch] = useState<ProductMatchResult | null>(null);
  const confirmedDuplicateRef = useRef(false);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);

  function clearDuplicateWarning() {
    setDuplicateMatch(null);
    confirmedDuplicateRef.current = false;
  }

  async function submitProduct(payload: Record<string, unknown>) {
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? "The product could not be created.");
        setIssues(Array.isArray(body?.error?.details) ? body.error.details : []);
        return;
      }

      router.push(`/app/products/${body.product.id}`);
      router.refresh();
    } catch {
      setError("The request did not reach the server. Nothing was created.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssues([]);

    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
    };

    const productName = text("productName") ?? "";
    const brand = text("brand");

    const payload: Record<string, unknown> = {
      productName,
      clientId: clientId !== "" ? clientId : undefined,
      internalSku: text("internalSku"),
      brand,
      model: text("model"),
      commercialDescription: text("commercialDescription"),
      technicalDescription: text("technicalDescription"),
      customsDescription: text("customsDescription"),
    };

    if (identifierValue.trim() !== "") {
      payload.identifiers = [{ identifierType, value: identifierValue.trim(), sourceType: "USER" }];
    }

    // Both halves are required together: a country with no fact type would have
    // to be guessed into meaning, and guessing between "made here" and "origin
    // is here" is exactly the mistake this screen exists to prevent.
    if (countryFactType !== "" && country.trim() !== "") {
      payload.countryFacts = [
        { factType: countryFactType, country: country.trim(), sourceType: "USER" },
      ];
    }

    pendingPayloadRef.current = payload;

    if (!confirmedDuplicateRef.current) {
      try {
        const matchResponse = await fetch("/api/products/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productName,
            brand,
            clientId: clientId !== "" ? clientId : undefined,
            identifiers:
              identifierValue.trim() !== ""
                ? [{ identifierType, value: identifierValue.trim() }]
                : undefined,
          }),
        });
        if (matchResponse.ok) {
          const matchBody = await matchResponse.json();
          if (matchBody.match && matchBody.match.status !== "NO_MATCH") {
            setDuplicateMatch(matchBody.match);
            setSubmitting(false);
            return;
          }
        }
      } catch {
        // The duplicate check is a courtesy, not a gate — if it fails to reach
        // the server, fall through to creating the product normally.
      }
    }

    await submitProduct(payload);
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-border text-sm";
  const areaClass = "w-full p-3 rounded-xl border border-border text-sm";
  const labelClass = "block text-xs font-semibold text-ink-muted mb-1";

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-4xl">
      {error !== null && (
        <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-900">{error}</p>
          {issues.length > 0 && (
            <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
              {issues.map((issue, index) => (
                <li key={index}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {duplicateMatch !== null && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-amber-900">
              Matches existing product ({matchStatusPresentation(duplicateMatch.status).label})
            </span>
          </div>
          <p className="text-xs text-amber-900/80">
            This name or identifier looks very similar to an existing product in this account.
          </p>
          <ul className="text-xs text-amber-900 space-y-1">
            {duplicateMatch.candidates.map((candidate, idx) => (
              <li key={idx} className="font-mono">
                {candidate.explanation}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                confirmedDuplicateRef.current = true;
                if (pendingPayloadRef.current) {
                  setSubmitting(true);
                  submitProduct(pendingPayloadRef.current);
                }
              }}
              className="h-9 px-4 rounded-xl bg-amber-900 text-white text-xs font-semibold"
            >
              Create anyway
            </button>
            <button
              type="button"
              onClick={clearDuplicateWarning}
              className="h-9 px-4 rounded-xl border border-amber-300 text-amber-900 text-xs font-semibold"
            >
              Go back and edit
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-ink">Item identity</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            The canonical name and SKU of the product.
          </p>
        </div>

        <div>
          <label htmlFor="productName" className={labelClass}>
            Product name (required)
          </label>
          <input
            id="productName"
            name="productName"
            required
            maxLength={300}
            className={inputClass}
            onChange={clearDuplicateWarning}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="productClient" className={labelClass}>
              Client Scope
            </label>
            <select
              id="productClient"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="">Account-wide (Unassigned)</option>
              {props.clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="internalSku" className={labelClass}>
              Internal SKU
            </label>
            <input id="internalSku" name="internalSku" maxLength={100} className={inputClass} />
          </div>
          <div>
            <label htmlFor="brand" className={labelClass}>
              Brand
            </label>
            <input
              id="brand"
              name="brand"
              maxLength={200}
              className={inputClass}
              onChange={clearDuplicateWarning}
            />
          </div>
          <div>
            <label htmlFor="model" className={labelClass}>
              Model
            </label>
            <input id="model" name="model" maxLength={200} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-ink">Descriptions</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            The customs description is the one classification work is built on. Changing it later
            raises a re-check on every approved classification this product holds.
          </p>
        </div>

        <div>
          <label htmlFor="customsDescription" className={labelClass}>
            Customs description
          </label>
          <textarea
            id="customsDescription"
            name="customsDescription"
            rows={3}
            maxLength={4000}
            className={areaClass}
          />
        </div>
        <div>
          <label htmlFor="technicalDescription" className={labelClass}>
            Technical description
          </label>
          <textarea
            id="technicalDescription"
            name="technicalDescription"
            rows={3}
            maxLength={4000}
            className={areaClass}
          />
        </div>
        <div>
          <label htmlFor="commercialDescription" className={labelClass}>
            Commercial description
          </label>
          <textarea
            id="commercialDescription"
            name="commercialDescription"
            rows={2}
            maxLength={4000}
            className={areaClass}
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-ink">First identifier (optional)</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            Identifiers are how an incoming shipment line is matched to this product. More can be
            added afterwards.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="identifierType" className={labelClass}>
              Scheme
            </label>
            <select
              id="identifierType"
              value={identifierType}
              onChange={(event) => {
                setIdentifierType(event.target.value);
                clearDuplicateWarning();
              }}
              className={`${inputClass} bg-white`}
            >
              {IDENTIFIER_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="identifierValue" className={labelClass}>
              Value
            </label>
            <input
              id="identifierValue"
              value={identifierValue}
              onChange={(event) => {
                setIdentifierValue(event.target.value);
                clearDuplicateWarning();
              }}
              maxLength={128}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-ink">First country fact (optional)</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            Say which claim you are recording. Country of manufacture is a fact about where the
            goods are made; country of origin is a legal conclusion, and Qubere records a claim of
            it rather than deriving one.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="countryFactType" className={labelClass}>
              What this country is
            </label>
            <select
              id="countryFactType"
              value={countryFactType}
              onChange={(event) => setCountryFactType(event.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="">Not recording one</option>
              {COUNTRY_FACT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="country" className={labelClass}>
              Country
            </label>
            <input
              id="country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              maxLength={100}
              placeholder="ISO code or country name"
              className={inputClass}
              disabled={countryFactType === ""}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="h-10 px-5 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create product"}
        </button>
        <Link href="/app/products" className="text-sm font-semibold text-brand">
          Cancel
        </Link>
      </div>
    </form>
  );
}
