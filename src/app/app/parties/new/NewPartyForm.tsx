"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { matchStatusPresentation } from "@/modules/party/partyDisplay";

interface FieldIssue {
  path: string;
  message: string;
}

interface PartyMatchCandidate {
  partyId: string;
  explanation: string;
}

interface PartyMatchResult {
  status: string;
  candidates: PartyMatchCandidate[];
}

const IDENTIFIER_TYPES = [
  ["EORI", "EORI"],
  ["DUNS", "D-U-N-S"],
  ["LEI", "LEI"],
  ["VAT", "VAT number"],
  ["TAX_ID", "Tax ID"],
  ["CUSTOMS_ID", "Customs ID"],
  ["INTERNAL_PARTY_CODE", "Internal party code"],
  ["CUSTOMER_NUMBER", "Customer number"],
  ["SUPPLIER_NUMBER", "Supplier number"],
  ["OTHER", "Other"],
] as const;

const ROLE_TYPES = [
  ["IMPORTER", "Importer"],
  ["EXPORTER", "Exporter"],
  ["MANUFACTURER", "Manufacturer"],
  ["SUPPLIER", "Supplier"],
  ["CUSTOMER", "Customer"],
  ["CONSIGNEE", "Consignee"],
  ["CONSIGNOR", "Consignor"],
  ["CARRIER", "Carrier"],
  ["FREIGHT_FORWARDER", "Freight forwarder"],
  ["CUSTOMS_BROKER", "Customs broker"],
  ["BUYER", "Buyer"],
  ["SELLER", "Seller"],
  ["NOTIFY_PARTY", "Notify party"],
  ["OTHER", "Other"],
] as const;

export function NewPartyForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const [partyKind, setPartyKind] = useState("ORGANIZATION");
  const [identifierType, setIdentifierType] = useState<string>("EORI");
  const [identifierValue, setIdentifierValue] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationCountry, setRegistrationCountry] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressCountry, setAddressCountry] = useState("");
  const [roleType, setRoleType] = useState("");

  const [duplicateMatch, setDuplicateMatch] = useState<PartyMatchResult | null>(null);
  const confirmedDuplicateRef = useRef(false);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);

  function clearDuplicateWarning() {
    setDuplicateMatch(null);
    confirmedDuplicateRef.current = false;
  }

  async function submitParty(payload: Record<string, unknown>) {
    try {
      const response = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? "The party could not be created.");
        setIssues(Array.isArray(body?.error?.details) ? body.error.details : []);
        return;
      }

      router.push(`/app/parties/${body.party.id}`);
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

    const legalName = text("legalName") ?? "";

    const payload: Record<string, unknown> = {
      partyKind,
      internalPartyCode: text("internalPartyCode"),
      names: [{ nameType: "LEGAL", rawName: legalName, isPrimary: true, sourceType: "USER" }],
    };

    if (identifierValue.trim() !== "") {
      payload.identifiers = [
        { identifierType, value: identifierValue.trim(), sourceType: "USER" },
      ];
    }

    // A registration needs both a number and a country together — a number
    // with no stated jurisdiction cannot be recorded as claimed anywhere.
    if (registrationNumber.trim() !== "" && registrationCountry.trim() !== "") {
      payload.registrations = [
        {
          registrationNumber: registrationNumber.trim(),
          country: registrationCountry.trim(),
          sourceType: "USER",
        },
      ];
    }

    if (addressLine1.trim() !== "" && addressCountry.trim() !== "") {
      payload.addresses = [
        {
          addressType: "REGISTERED",
          addressLine1: addressLine1.trim(),
          country: addressCountry.trim(),
          sourceType: "USER",
        },
      ];
    }

    if (roleType !== "") {
      payload.roles = [{ roleType, sourceType: "USER" }];
    }

    pendingPayloadRef.current = payload;

    if (!confirmedDuplicateRef.current) {
      try {
        const matchResponse = await fetch("/api/parties/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legalName,
            registrationNumber: registrationNumber.trim() || undefined,
            registrationCountry: registrationCountry.trim() || undefined,
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
        // the server, fall through to creating the party normally.
      }
    }

    await submitParty(payload);
  }

  async function onCreateAnyway() {
    confirmedDuplicateRef.current = true;
    setDuplicateMatch(null);
    setSubmitting(true);
    if (pendingPayloadRef.current) {
      await submitParty(pendingPayloadRef.current);
    }
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-border text-sm";
  const labelClass = "block text-xs font-semibold text-ink-muted mb-1";

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
      {error && (
        <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900">
          <p className="font-semibold">{error}</p>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {issue.path ? `${issue.path}: ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <h2 className="text-sm font-bold text-ink">Identity</h2>

        <div>
          <label htmlFor="legalName" className={labelClass}>
            Legal name (required)
          </label>
          <input
            id="legalName"
            name="legalName"
            required
            maxLength={300}
            className={inputClass}
            onChange={clearDuplicateWarning}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="partyKind" className={labelClass}>
              Kind
            </label>
            <select
              id="partyKind"
              value={partyKind}
              onChange={(event) => setPartyKind(event.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="ORGANIZATION">Organization</option>
              <option value="INDIVIDUAL">Individual</option>
            </select>
          </div>
          <div>
            <label htmlFor="internalPartyCode" className={labelClass}>
              Internal party code
            </label>
            <input id="internalPartyCode" name="internalPartyCode" maxLength={100} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-ink">First identifier (optional)</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            An identifier is how this party is matched by more than its name. More can be added
            afterwards.
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
          <h2 className="text-sm font-bold text-ink">First registration (optional)</h2>
          <p className="text-xs text-[#6E6E73] mt-1">
            Recorded as claimed. Verifying it against evidence is a separate step done from the
            party&apos;s own page.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="registrationNumber" className={labelClass}>
              Registration number
            </label>
            <input
              id="registrationNumber"
              value={registrationNumber}
              onChange={(event) => {
                setRegistrationNumber(event.target.value);
                clearDuplicateWarning();
              }}
              maxLength={128}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="registrationCountry" className={labelClass}>
              Country
            </label>
            <input
              id="registrationCountry"
              value={registrationCountry}
              onChange={(event) => {
                setRegistrationCountry(event.target.value);
                clearDuplicateWarning();
              }}
              maxLength={100}
              className={inputClass}
              disabled={registrationNumber.trim() === ""}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <h2 className="text-sm font-bold text-ink">First address (optional)</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="addressLine1" className={labelClass}>
              Address line 1
            </label>
            <input
              id="addressLine1"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              maxLength={300}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="addressCountry" className={labelClass}>
              Country
            </label>
            <input
              id="addressCountry"
              value={addressCountry}
              onChange={(event) => setAddressCountry(event.target.value)}
              maxLength={100}
              className={inputClass}
              disabled={addressLine1.trim() === ""}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <h2 className="text-sm font-bold text-ink">First role (optional)</h2>
        <div>
          <label htmlFor="roleType" className={labelClass}>
            Role
          </label>
          <select
            id="roleType"
            value={roleType}
            onChange={(event) => setRoleType(event.target.value)}
            className={`${inputClass} bg-white sm:w-64`}
          >
            <option value="">Not recording one</option>
            {ROLE_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {duplicateMatch && (
        <div role="alert" className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 space-y-3">
          <p className="font-semibold">
            {matchStatusPresentation(duplicateMatch.status).label}: this looks like a party already
            recorded in this account.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {duplicateMatch.candidates.map((candidate) => (
              <li key={candidate.partyId}>
                <Link
                  href={`/app/parties/${candidate.partyId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Open existing party
                </Link>{" "}
                — {candidate.explanation}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCreateAnyway}
              disabled={submitting}
              className="h-9 px-4 rounded-xl bg-amber-900 text-white text-sm font-semibold disabled:opacity-60"
            >
              Create a new party anyway
            </button>
            <button
              type="button"
              onClick={() => setDuplicateMatch(null)}
              className="text-sm font-semibold text-amber-900"
            >
              Let me check first
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="h-10 px-5 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create party"}
        </button>
        <Link href="/app/parties" className="text-sm font-semibold text-brand">
          Cancel
        </Link>
      </div>
    </form>
  );
}
