"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The write actions on the party detail page.
 *
 * Each one posts to its own endpoint and refreshes the server-rendered page,
 * so what the screen shows afterwards is what the database holds — not an
 * optimistic guess that could disagree with a rule the server applied.
 */

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
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
// Party review
// ---------------------------------------------------------------------------

export function PartyReviewActions({
  partyId,
  reviewStatus,
  canApprove,
}: {
  partyId: string;
  reviewStatus: string;
  canApprove: boolean;
}) {
  const { busy, error, run } = useAction();
  const base = `/api/parties/${partyId}/review`;
  const act = (action: string) => run(base, "POST", { action });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {(reviewStatus === "UNREVIEWED" || reviewStatus === "NEEDS_REVIEW") && (
          <button type="button" disabled={busy} onClick={() => act("START_REVIEW")} className={buttonClass}>
            Start review
          </button>
        )}
        {reviewStatus === "IN_REVIEW" && canApprove && (
          <button type="button" disabled={busy} onClick={() => act("APPROVE")} className={primaryClass}>
            Approve
          </button>
        )}
        {reviewStatus === "IN_REVIEW" && !canApprove && (
          <span className="text-xs text-[#6E6E73]">Approving needs parties.review.approve.</span>
        )}
        {reviewStatus === "IN_REVIEW" && (
          <button type="button" disabled={busy} onClick={() => act("REJECT")} className={buttonClass}>
            Reject
          </button>
        )}
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function AddNameForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [nameType, setNameType] = useState("LEGAL");
  const [rawName, setRawName] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/names`, "POST", {
      nameType,
      rawName,
      sourceType: "USER",
    });
    if (ok) setRawName("");
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add a name</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="name-type" className={labelClass}>
            Type
          </label>
          <select
            id="name-type"
            value={nameType}
            onChange={(e) => setNameType(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="LEGAL">Legal name</option>
            <option value="TRADE">Trade name</option>
            <option value="DBA">Doing business as</option>
            <option value="FORMER_LEGAL">Former legal name</option>
            <option value="TRANSLATED">Translated name</option>
          </select>
        </div>
        <div>
          <label htmlFor="raw-name" className={labelClass}>
            Name
          </label>
          <input
            id="raw-name"
            value={rawName}
            onChange={(e) => setRawName(e.target.value)}
            maxLength={300}
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

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export function AddIdentifierForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [identifierType, setIdentifierType] = useState("EORI");
  const [value, setValue] = useState("");
  const [issuingCountry, setIssuingCountry] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/identifiers`, "POST", {
      identifierType,
      value,
      issuingCountry: issuingCountry === "" ? undefined : issuingCountry,
      sourceType: "USER",
    });
    if (ok) {
      setValue("");
      setIssuingCountry("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add an identifier</h3>
      <div className="grid gap-3 sm:grid-cols-3">
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
            <option value="EORI">EORI</option>
            <option value="DUNS">D-U-N-S</option>
            <option value="LEI">LEI</option>
            <option value="VAT">VAT number</option>
            <option value="TAX_ID">Tax ID</option>
            <option value="CUSTOMS_ID">Customs ID</option>
            <option value="INTERNAL_PARTY_CODE">Internal party code</option>
            <option value="CUSTOMER_NUMBER">Customer number</option>
            <option value="SUPPLIER_NUMBER">Supplier number</option>
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
        <div>
          <label htmlFor="issuing-country" className={labelClass}>
            Issuing country
          </label>
          <input
            id="issuing-country"
            value={issuingCountry}
            onChange={(e) => setIssuingCountry(e.target.value)}
            maxLength={100}
            placeholder="Optional"
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

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

export function AddRegistrationForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [country, setCountry] = useState("");
  const [registeringAuthority, setRegisteringAuthority] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/registrations`, "POST", {
      registrationNumber,
      country,
      registeringAuthority: registeringAuthority === "" ? undefined : registeringAuthority,
      sourceType: "USER",
    });
    if (ok) {
      setRegistrationNumber("");
      setCountry("");
      setRegisteringAuthority("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Record a registration</h3>
        <p className="text-xs text-[#6E6E73] mt-1">
          Always recorded as claimed. Verifying it against evidence is a separate step below.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="registration-number" className={labelClass}>
            Registration number
          </label>
          <input
            id="registration-number"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            maxLength={128}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="registration-country" className={labelClass}>
            Country
          </label>
          <input
            id="registration-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={100}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="registering-authority" className={labelClass}>
            Registering authority
          </label>
          <input
            id="registering-authority"
            value={registeringAuthority}
            onChange={(e) => setRegisteringAuthority(e.target.value)}
            maxLength={200}
            placeholder="Optional"
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

export function RegistrationReviewActions({
  partyId,
  registrationId,
  status,
  hasEvidence,
  canVerify,
}: {
  partyId: string;
  registrationId: string;
  status: string;
  hasEvidence: boolean;
  canVerify: boolean;
}) {
  const { busy, error, run } = useAction();
  const [evidenceId, setEvidenceId] = useState("");
  const base = `/api/parties/${partyId}/registrations/${registrationId}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "CLAIMED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(base, "POST", { action: "START_REVIEW" })}
            className={buttonClass}
          >
            Start review
          </button>
        )}
        {status === "UNDER_REVIEW" && canVerify && (
          <button
            type="button"
            disabled={busy || (!hasEvidence && evidenceId.trim() === "")}
            onClick={() =>
              run(base, "POST", {
                action: "VERIFY",
                evidenceId: evidenceId.trim() === "" ? undefined : evidenceId.trim(),
              })
            }
            className={primaryClass}
          >
            Verified against evidence
          </button>
        )}
        {status === "UNDER_REVIEW" && !canVerify && (
          <span className="text-xs text-[#6E6E73]">Verifying needs parties.registration.verify.</span>
        )}
        {(status === "CLAIMED" || status === "UNDER_REVIEW") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(base, "POST", { action: "REJECT" })}
            className={buttonClass}
          >
            Reject
          </button>
        )}
      </div>
      {status === "UNDER_REVIEW" && canVerify && !hasEvidence && (
        <input
          value={evidenceId}
          onChange={(e) => setEvidenceId(e.target.value)}
          placeholder="Evidence id — required to verify"
          maxLength={64}
          className={`${inputClass} w-full`}
        />
      )}
      <ErrorNote message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Addresses & sites
// ---------------------------------------------------------------------------

export function AddAddressForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [addressType, setAddressType] = useState("REGISTERED");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/addresses`, "POST", {
      addressType,
      addressLine1,
      city: city === "" ? undefined : city,
      country,
      sourceType: "USER",
    });
    if (ok) {
      setAddressLine1("");
      setCity("");
      setCountry("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add an address</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="address-type" className={labelClass}>
            Type
          </label>
          <select
            id="address-type"
            value={addressType}
            onChange={(e) => setAddressType(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="REGISTERED">Registered address</option>
            <option value="MAILING">Mailing address</option>
            <option value="BILLING">Billing address</option>
            <option value="SITE">Site address</option>
            <option value="OPERATING">Operating address</option>
          </select>
        </div>
        <div>
          <label htmlFor="address-line1" className={labelClass}>
            Address line 1
          </label>
          <input
            id="address-line1"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            maxLength={300}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="address-city" className={labelClass}>
            City
          </label>
          <input
            id="address-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={150}
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="address-country" className={labelClass}>
            Country
          </label>
          <input
            id="address-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={100}
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

export function AddSiteForm({ partyId, addressOptions }: { partyId: string; addressOptions: { id: string; label: string }[] }) {
  const { busy, error, run } = useAction();
  const [siteName, setSiteName] = useState("");
  const [addressId, setAddressId] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/sites`, "POST", {
      siteName,
      addressId: addressId === "" ? undefined : addressId,
    });
    if (ok) setSiteName("");
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add a site</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="site-name" className={labelClass}>
            Site name
          </label>
          <input
            id="site-name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            maxLength={300}
            required
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="site-address" className={labelClass}>
            At address
          </label>
          <select
            id="site-address"
            value={addressId}
            onChange={(e) => setAddressId(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="">Not tied to an address on file</option>
            {addressOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Saving…" : "Add"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export function AddContactForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/parties/${partyId}/contacts`, "POST", {
      name: name === "" ? undefined : name,
      email: email === "" ? undefined : email,
      phone: phone === "" ? undefined : phone,
      sourceType: "USER",
    });
    if (ok) {
      setName("");
      setEmail("");
      setPhone("");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add a contact</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="contact-name" className={labelClass}>
            Name
          </label>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="contact-email" className={labelClass}>
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label htmlFor="contact-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="contact-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={64}
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

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function AddRoleForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [roleType, setRoleType] = useState("SUPPLIER");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(`/api/parties/${partyId}/roles`, "POST", { roleType, sourceType: "USER" });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink">Add a role</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="role-type" className={labelClass}>
            Role
          </label>
          <select
            id="role-type"
            value={roleType}
            onChange={(e) => setRoleType(e.target.value)}
            className={`${inputClass} w-56 bg-white`}
          >
            <option value="IMPORTER">Importer</option>
            <option value="EXPORTER">Exporter</option>
            <option value="MANUFACTURER">Manufacturer</option>
            <option value="SUPPLIER">Supplier</option>
            <option value="CUSTOMER">Customer</option>
            <option value="CONSIGNEE">Consignee</option>
            <option value="CONSIGNOR">Consignor</option>
            <option value="CARRIER">Carrier</option>
            <option value="FREIGHT_FORWARDER">Freight forwarder</option>
            <option value="CUSTOMS_BROKER">Customs broker</option>
            <option value="BUYER">Buyer</option>
            <option value="SELLER">Seller</option>
            <option value="NOTIFY_PARTY">Notify party</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

interface PartyOption {
  id: string;
  label: string;
  code: string | null;
}

/** Searches the party master by name or code instead of asking for a raw id. */
function PartyPicker({
  inputId,
  value,
  onChange,
  excludePartyId,
}: {
  inputId: string;
  value: PartyOption | null;
  onChange: (party: PartyOption | null) => void;
  excludePartyId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartyOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/parties?q=${encodeURIComponent(query.trim())}&pageSize=8`);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (cancelled) return;
        const rows: unknown[] = Array.isArray(body?.parties) ? body.parties : [];
        setResults(
          rows
            .map((row) => row as { id: string; displayName?: string | null; internalPartyCode?: string | null })
            .filter((row) => row.id !== excludePartyId)
            .map((row) => ({
              id: row.id,
              label: row.displayName ?? "Unnamed party",
              code: row.internalPartyCode ?? null,
            }))
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, excludePartyId]);

  if (value !== null) {
    return (
      <div className={`${inputClass} w-full flex items-center justify-between gap-2`}>
        <span className="truncate">
          {value.label}
          {value.code && <span className="text-[#6E6E73]"> · {value.code}</span>}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs font-semibold text-brand shrink-0"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        id={inputId}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="Search by name or code…"
        autoComplete="off"
        className={`${inputClass} w-full`}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-white shadow-lg max-h-56 overflow-y-auto">
          {loading && <p className="px-3 py-2 text-xs text-[#6E6E73]">Searching…</p>}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-[#6E6E73]">No party matches.</p>
          )}
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(row);
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted"
            >
              <span className="font-semibold text-ink">{row.label}</span>
              {row.code && <span className="text-xs text-[#6E6E73] ml-2">{row.code}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AddRelationshipForm({ partyId }: { partyId: string }) {
  const { busy, error, run } = useAction();
  const [toParty, setToParty] = useState<PartyOption | null>(null);
  const [relationshipType, setRelationshipType] = useState("SUBSIDIARY_OF");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (toParty === null) return;
    const ok = await run(`/api/parties/${partyId}/relationships`, "POST", {
      toPartyId: toParty.id,
      relationshipType,
      sourceType: "USER",
    });
    if (ok) setToParty(null);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Record a relationship</h3>
        <p className="text-xs text-[#6E6E73] mt-1">
          Search for the other party by name or code. This is a stated relationship, not a
          beneficial-ownership graph, and it is never inferred.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="relationship-type" className={labelClass}>
            Relationship
          </label>
          <select
            id="relationship-type"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value)}
            className={`${inputClass} w-full bg-white`}
          >
            <option value="PARENT_OF">Parent of</option>
            <option value="SUBSIDIARY_OF">Subsidiary of</option>
            <option value="AFFILIATE_OF">Affiliate of</option>
            <option value="AGENT_OF">Agent of</option>
            <option value="SUCCESSOR_OF">Successor of</option>
            <option value="PREDECESSOR_OF">Predecessor of</option>
          </select>
        </div>
        <div>
          <label htmlFor="to-party-search" className={labelClass}>
            Other party
          </label>
          <PartyPicker inputId="to-party-search" value={toParty} onChange={setToParty} excludePartyId={partyId} />
        </div>
      </div>
      <button type="submit" disabled={busy || toParty === null} className={primaryClass}>
        {busy ? "Saving…" : "Record"}
      </button>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Generic remove
// ---------------------------------------------------------------------------

export function RemoveRowButton({ url, label = "Remove" }: { url: string; label?: string }) {
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
// Restricted party screening
// ---------------------------------------------------------------------------

export function RescreenPartyButton({ partyId, onDone }: { partyId: string; onDone?: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const ok = await run(`/api/v1/parties/${partyId}/restricted-party-screening/rescreen`, "POST");
          if (ok) onDone?.();
        }}
        className={primaryClass}
      >
        {busy ? "Screening…" : "Re-screen now"}
      </button>
      <ErrorNote message={error} />
    </div>
  );
}

export function RestrictedPartyDispositionForm({
  screeningId,
  currentStatus,
  onDone,
}: {
  screeningId: string;
  currentStatus: string | null;
  onDone?: () => void;
}) {
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState("CONFIRMED_MATCH");
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(`/api/v1/screening/restricted-party/${screeningId}/disposition`, "PATCH", {
      status,
      notes: notes.trim() === "" ? undefined : notes.trim(),
    });
    if (ok) {
      setNotes("");
      setOpen(false);
      onDone?.();
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        {currentStatus === null ? "Record disposition" : "Change disposition"}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-border p-3 bg-surface-muted">
      <div>
        <label htmlFor={`disposition-status-${screeningId}`} className={labelClass}>
          Disposition
        </label>
        <select
          id={`disposition-status-${screeningId}`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${inputClass} w-full bg-white`}
        >
          <option value="CONFIRMED_MATCH">Confirmed match</option>
          <option value="FALSE_POSITIVE">False positive</option>
          <option value="APPROVED">Approved</option>
          <option value="BLOCKED">Blocked</option>
          <option value="REQUEST_MORE_INFORMATION">Request more information</option>
        </select>
      </div>
      <div>
        <label htmlFor={`disposition-notes-${screeningId}`} className={labelClass}>
          Notes
        </label>
        <input
          id={`disposition-notes-${screeningId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you check? (optional)"
          maxLength={2000}
          className={`${inputClass} w-full`}
        />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? "Saving…" : "Save disposition"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-[#6E6E73]">
        This records a reviewer&apos;s judgment. The screening result itself does not change — a hit
        stays a hit in history even after being dispositioned false positive.
      </p>
      <ErrorNote message={error} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Revalidation flags
// ---------------------------------------------------------------------------

export function RevalidationActions({ partyId, flagId }: { partyId: string; flagId: string }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const base = `/api/parties/${partyId}/revalidation/${flagId}`;

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
        Closing this records that a person looked. It changes no identity, registration, or review
        state, and it is not a screening result.
      </p>
      <ErrorNote message={error} />
    </div>
  );
}
