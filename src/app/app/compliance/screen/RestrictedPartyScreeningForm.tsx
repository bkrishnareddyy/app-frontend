"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert, Search, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardHeaderIcon } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { displayDate } from "@/lib/honest";
import { CountryCombobox, type CountryOption } from "./CountryCombobox";

interface AdHocEmbargoFinding {
  kind: string;
  message: string;
}

interface AdHocEmbargoResult {
  complianceCountry: { code: string; name: string } | null;
  targetCountry: { code: string; name: string } | null;
  findings: AdHocEmbargoFinding[];
}

interface AdHocMatch {
  matchedName: string;
  matchedAddress: string | null;
  nameScore: number;
  matchMethod: string;
  countryMatch: boolean | null;
  sourceList: string;
  entityType: string;
  programCodes: string[];
  citation: string | null;
  agency: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  listDate: string | null;
}

interface AdHocPass {
  id: string;
  passType: string;
  status: string;
  screenedName: string;
  hitCount: number;
  redFlagCount: number;
  matches: AdHocMatch[];
  redFlagHits: { matchedWord: string }[];
}

interface AdHocScreeningResponse {
  success: boolean;
  embargo: AdHocEmbargoResult;
  party: { correlationId: string; passes: AdHocPass[] };
}

function statusBadge(status: string): BadgeProps["variant"] {
  if (status === "HIT") return "danger";
  if (status === "REVIEW_REQUIRED" || status === "PARTIAL") return "warning";
  if (status === "CLEAR" || status === "SKIPPED") return "success";
  return "neutral";
}

export function RestrictedPartyScreeningForm({ countries }: { countries: CountryOption[] }) {
  const [complianceCountry, setComplianceCountry] = useState("US");
  const [ultimateDestination, setUltimateDestination] = useState("");
  const [partyName, setPartyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [partyCountry, setPartyCountry] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [threshold, setThreshold] = useState(80);
  const [countryMatch, setCountryMatch] = useState(false);
  const [redFlagCheck, setRedFlagCheck] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdHocScreeningResponse | null>(null);

  const handleScreen = async () => {
    if (!partyName.trim() || !ultimateDestination.trim()) {
      setError("Party name and Ultimate Destination are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance/restricted-party-screening/ad-hoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          complianceCountry,
          ultimateDestination,
          referenceId: referenceId || undefined,
          party: {
            name: partyName,
            address: address1 || undefined,
            city: city || undefined,
            country: partyCountry || undefined,
            contactName: contactName || undefined,
          },
          threshold,
          countryMatch,
          redFlagCheck,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Screening failed.");
        setResult(null);
        return;
      }
      setResult(data);
    } catch {
      setError("Screening failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardHeaderIcon>
              <Search className="w-5 h-5" />
            </CardHeaderIcon>
            <div>
              <h2 className="text-sm font-bold text-ink">Party Information</h2>
              <p className="text-xs text-ink-muted">Who and where you&apos;re screening</p>
            </div>
          </CardHeader>

          <div className="space-y-4">
            {countries.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-800">
                  No country reference data is loaded in this environment, so country fields are disabled.
                </p>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-ink-muted">Compliance Country</label>
              <div className="mt-1">
                <CountryCombobox countries={countries} value={complianceCountry} onChange={setComplianceCountry} />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">Party Name *</label>
              <input
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Legal or trade name"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">Contact Name</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">Address</label>
              <input
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-muted">City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-muted">Party Country</label>
                <div className="mt-1">
                  <CountryCombobox countries={countries} value={partyCountry} onChange={setPartyCountry} allowClear placeholder="Search country..." />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">Ultimate Destination *</label>
              <div className="mt-1">
                <CountryCombobox
                  countries={countries}
                  value={ultimateDestination}
                  onChange={setUltimateDestination}
                  placeholder="Search destination country..."
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">Reference ID</label>
              <input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Optional, for your own tracking"
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardHeaderIcon>
              <ShieldAlert className="w-5 h-5" />
            </CardHeaderIcon>
            <div>
              <h2 className="text-sm font-bold text-ink">Configuration</h2>
              <p className="text-xs text-ink-muted">Matching sensitivity</p>
            </div>
          </CardHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-ink-muted">Match Threshold ({threshold})</label>
              <select
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              >
                {Array.from({ length: 11 }, (_, i) => 50 + i * 5).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-muted mb-1">Country Match Required</p>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={countryMatch} onChange={() => setCountryMatch(true)} /> Yes
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!countryMatch} onChange={() => setCountryMatch(false)} /> No
                </label>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-muted mb-1">Red Flag Words Check</p>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={redFlagCheck} onChange={() => setRedFlagCheck(true)} /> Yes
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!redFlagCheck} onChange={() => setRedFlagCheck(false)} /> No
                </label>
              </div>
            </div>

            {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

            <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={handleScreen}>
              Screen Party
            </Button>
          </div>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-6">
        {!result && (
          <Card className="text-center py-16 space-y-2">
            <Search className="w-8 h-8 text-ink-muted mx-auto" />
            <p className="text-sm font-semibold text-ink">Results will appear here</p>
            <p className="text-xs text-ink-muted">Fill in the party details and click Screen Party.</p>
          </Card>
        )}

        {result && (
          <>
            <Card>
              <CardHeader>
                <CardHeaderIcon>
                  <ShieldAlert className="w-5 h-5" />
                </CardHeaderIcon>
                <div>
                  <h2 className="text-sm font-bold text-ink">Country Embargo Screening</h2>
                  <p className="text-xs text-ink-muted">
                    {result.embargo.complianceCountry?.name ?? complianceCountry} →{" "}
                    {result.embargo.targetCountry?.name ?? ultimateDestination}
                  </p>
                </div>
              </CardHeader>

              {result.embargo.findings.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="text-sm font-bold text-ink">No embargo restrictions found.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {result.embargo.findings.map((f, idx) => (
                    <div key={idx} className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-start gap-2">
                      <Badge variant="danger">{f.kind.replace(/_/g, " ")}</Badge>
                      <p className="text-sm text-ink">{f.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {result.party.passes.map((pass) => (
              <Card key={pass.id}>
                <CardHeader>
                  <CardHeaderIcon>
                    <Search className="w-5 h-5" />
                  </CardHeaderIcon>
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <h2 className="text-sm font-bold text-ink">
                        {pass.passType === "CONTACT_NAME" ? "Contact Name" : "Party Name"}: {pass.screenedName}
                      </h2>
                      <p className="text-xs text-ink-muted">
                        {pass.hitCount} match(es) · {pass.redFlagCount} red flag(s)
                      </p>
                    </div>
                    <Badge variant={statusBadge(pass.status)}>
                      {pass.status === "CLEAR" || pass.status === "SKIPPED" ? "CLEAR" : pass.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </CardHeader>

                {pass.matches.length === 0 && pass.redFlagHits.length === 0 ? (
                  <div className="text-center py-6 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="text-sm font-bold text-ink">No restricted party matches found.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pass.matches.map((m, idx) => (
                      <div key={idx} className="rounded-xl border border-border p-3 space-y-1.5 text-xs bg-surface">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-semibold text-ink text-sm">{m.matchedName}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="neutral">{m.sourceList}</Badge>
                            <span className="font-mono text-[10px] text-ink-muted">{m.nameScore}% match</span>
                          </div>
                        </div>
                        {m.matchedAddress && <p className="text-ink-muted">{m.matchedAddress}</p>}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-ink-muted">
                          {m.programCodes.length > 0 && (
                            <span>
                              <strong className="text-ink">Program:</strong> {m.programCodes.join(", ")}
                            </span>
                          )}
                          {m.agency && (
                            <span>
                              <strong className="text-ink">Agency:</strong> {m.agency}
                            </span>
                          )}
                          {m.citation && (
                            <span>
                              <strong className="text-ink">Citation:</strong> {m.citation}
                            </span>
                          )}
                          {m.effectiveDate && (
                            <span>
                              <strong className="text-ink">Effective Date:</strong> {displayDate(m.effectiveDate)}
                            </span>
                          )}
                          {m.expirationDate && (
                            <span>
                              <strong className="text-ink">Expiration Date:</strong> {displayDate(m.expirationDate)}
                            </span>
                          )}
                          {!m.effectiveDate && m.listDate && (
                            <span>
                              <strong className="text-ink">List Date:</strong> {displayDate(m.listDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {pass.redFlagHits.map((h, idx) => (
                      <div key={idx} className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center gap-2 text-xs">
                        <Badge variant="warning">Red Flag</Badge>
                        <span className="text-ink">Word matched: &quot;{h.matchedWord}&quot;</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
