"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { displayDate, displayText } from "@/lib/honest";
import type { PartyDetail } from "@/modules/party/partyService";
import {
  PARTY_TABS,
  addressTypeLabel,
  identifierTypeLabel,
  nameTypeLabel,
  partyKindLabel,
  registrationStatusPresentation,
  relationshipTypeLabel,
  revalidationPresentation,
  roleTypeLabel,
  significancePresentation,
  sourceTypeLabel,
  type PartyTabId,
} from "@/modules/party/partyDisplay";
import {
  AddAddressForm,
  AddContactForm,
  AddIdentifierForm,
  AddNameForm,
  AddRegistrationForm,
  AddRelationshipForm,
  AddRoleForm,
  AddSiteForm,
  RegistrationReviewActions,
  RemoveRowButton,
} from "./PartyActions";

const cellClass = "px-3 py-3 align-top";
const headClass =
  "px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted bg-surface-muted";

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-[#6E6E73]">
        {children}
      </td>
    </tr>
  );
}

interface HistoryEvent {
  id: string;
  createdAt: string;
  versionNumber: number;
  field: string;
  entity: string;
  oldValue: string | null;
  newValue: string | null;
  significance: string;
  impactFlags: string[];
}

export function PartyTabs({
  partyId,
  initialTab,
  party,
  mayEdit,
  mayVerifyRegistration,
  reviewHint,
  activeNames,
  activeIdentifiers,
  activeAddresses,
  activeContacts,
  activeRoles,
  activeSites,
  activeRelationshipsFrom,
  activeRelationshipsTo,
  addressOptions,
}: {
  partyId: string;
  initialTab: PartyTabId;
  party: PartyDetail;
  mayEdit: boolean;
  mayVerifyRegistration: boolean;
  reviewHint: string;
  activeNames: PartyDetail["names"];
  activeIdentifiers: PartyDetail["identifiers"];
  activeAddresses: PartyDetail["addresses"];
  activeContacts: PartyDetail["contacts"];
  activeRoles: PartyDetail["roles"];
  activeSites: PartyDetail["sites"];
  activeRelationshipsFrom: PartyDetail["relationshipsFrom"];
  activeRelationshipsTo: PartyDetail["relationshipsTo"];
  addressOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PartyTabId>(initialTab);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestedRef = useRef(false);

  function selectTab(next: PartyTabId) {
    setTab(next);
    const href = next === "overview" ? `/app/parties/${partyId}` : `/app/parties/${partyId}?tab=${next}`;
    router.replace(href, { scroll: false });
  }

  useEffect(() => {
    if (tab !== "history" || historyRequestedRef.current) return;
    historyRequestedRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    fetch(`/api/parties/${partyId}/history`)
      .then((response) => {
        if (!response.ok) throw new Error("history request failed");
        return response.json();
      })
      .then((body) => setHistory(Array.isArray(body.events) ? body.events : []))
      .catch(() => setHistoryError("History could not be loaded."))
      .finally(() => setHistoryLoading(false));
  }, [tab, partyId]);

  return (
    <>
      <nav aria-label="Party sections" className="border-b border-border">
        <ul className="flex flex-wrap gap-1 -mb-px">
          {PARTY_TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => selectTab(entry.id)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex px-4 py-2.5 text-sm font-semibold border-b-2 ${
                    active
                      ? "border-brand text-brand"
                      : "border-transparent text-[#6E6E73] hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink">Identity</h2>
            <dl className="text-sm space-y-2">
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Kind</dt>
                <dd className="text-ink">{partyKindLabel(party.partyKind)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Internal code</dt>
                <dd className="text-ink">{displayText(party.internalPartyCode)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Created</dt>
                <dd className="text-ink">{displayDate(party.createdAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Last changed</dt>
                <dd className="text-ink">{displayDate(party.updatedAt)}</dd>
              </div>
            </dl>
            {reviewHint !== "" && <p className="text-xs text-[#6E6E73]">{reviewHint}</p>}
          </section>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink">Roles</h2>
            <p className="text-sm text-ink">
              {activeRoles.length === 0
                ? "No role recorded."
                : activeRoles.map((role) => roleTypeLabel(role.roleType)).join(", ")}
            </p>
            <p className="text-xs text-[#6E6E73]">
              A role says what this party does in a transaction. It is not a legal conclusion and it
              does not, by itself, license anything.
            </p>
            <button
              type="button"
              onClick={() => selectTab("roles")}
              className="inline-flex text-sm font-semibold text-brand"
            >
              Open roles →
            </button>
          </section>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3 lg:col-span-2">
            <h2 className="text-sm font-bold text-ink">Registrations</h2>
            <p className="text-sm text-ink">
              {party.registrations.length === 0
                ? "No registration recorded."
                : `${party.registrations.filter((r) => r.status === "VERIFIED").length} of ${
                    party.registrations.length
                  } verified against evidence.`}
            </p>
            <p className="text-xs text-[#6E6E73]">
              A registration is claimed until a named reviewer checks it against attached evidence.
              Claimed and verified never render the same way on this screen.
            </p>
            <button
              type="button"
              onClick={() => selectTab("registrations")}
              className="inline-flex text-sm font-semibold text-brand"
            >
              Open registrations →
            </button>
          </section>
        </div>
      )}

      {tab === "names" && (
        <div className="space-y-4">
          {mayEdit && <AddNameForm partyId={partyId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Type</th>
                  <th className={headClass}>Name</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeNames.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 4 : 3}>
                    No name recorded. Without one, this party can only be found by internal code or
                    identifier.
                  </EmptyRow>
                ) : (
                  activeNames.map((name) => (
                    <tr key={name.id}>
                      <td className={cellClass}>{nameTypeLabel(name.nameType)}</td>
                      <td className={`${cellClass} font-medium text-ink`}>
                        {name.rawName}
                        {name.isPrimary && (
                          <Badge variant="info" className="ml-2">
                            Primary
                          </Badge>
                        )}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>{sourceTypeLabel(name.sourceType)}</td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/parties/${partyId}/names/${name.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "identifiers" && (
        <div className="space-y-4">
          {mayEdit && <AddIdentifierForm partyId={partyId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Scheme</th>
                  <th className={headClass}>Value</th>
                  <th className={headClass}>Normalized</th>
                  <th className={headClass}>Issuer</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeIdentifiers.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 6 : 5}>
                    No identifier recorded. Without one, this party can only be matched by name.
                  </EmptyRow>
                ) : (
                  activeIdentifiers.map((identifier) => (
                    <tr key={identifier.id}>
                      <td className={cellClass}>
                        {identifierTypeLabel(identifier.identifierType)}
                        {identifier.isPrimary && (
                          <Badge variant="info" className="ml-2">
                            Primary
                          </Badge>
                        )}
                      </td>
                      <td className={`${cellClass} font-medium text-ink`}>{identifier.value}</td>
                      <td className={`${cellClass} text-[#6E6E73] font-mono text-xs`}>
                        {identifier.normalizedValue}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {displayText(identifier.issuingCountry)}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {sourceTypeLabel(identifier.sourceType)}
                      </td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/parties/${partyId}/identifiers/${identifier.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "registrations" && (
        <div className="space-y-4">
          {mayEdit && <AddRegistrationForm partyId={partyId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Registration</th>
                  <th className={headClass}>Country</th>
                  <th className={headClass}>Authority</th>
                  <th className={headClass}>Status</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {party.registrations.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 6 : 5}>
                    No registration recorded. This party is not known to be registered anywhere.
                  </EmptyRow>
                ) : (
                  party.registrations.map((registration) => {
                    const presentation = registrationStatusPresentation(registration.status);
                    return (
                      <tr key={registration.id}>
                        <td className={`${cellClass} font-medium text-ink`}>
                          {registration.registrationNumber}
                          {registration.legalForm !== null && (
                            <span className="block text-xs text-[#6E6E73]">{registration.legalForm}</span>
                          )}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>{registration.country}</td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {displayText(registration.registeringAuthority)}
                        </td>
                        <td className={cellClass}>
                          <Badge variant={presentation.tone}>{presentation.label}</Badge>
                          {presentation.hint !== "" && (
                            <span className="block text-xs text-[#6E6E73] mt-1 max-w-[16rem]">
                              {presentation.hint}
                            </span>
                          )}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {sourceTypeLabel(registration.sourceType)}
                        </td>
                        {mayEdit && (
                          <td className={cellClass}>
                            <RegistrationReviewActions
                              partyId={partyId}
                              registrationId={registration.id}
                              status={registration.status}
                              hasEvidence={registration.evidenceId !== null}
                              canVerify={mayVerifyRegistration}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "addresses" && (
        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-base font-bold text-ink">Addresses</h2>
            {mayEdit && <AddAddressForm partyId={partyId} />}
            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Type</th>
                    <th className={headClass}>Address</th>
                    <th className={headClass}>Country</th>
                    <th className={headClass}>Verified</th>
                    <th className={headClass}>Source</th>
                    {mayEdit && <th className={headClass} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeAddresses.length === 0 ? (
                    <EmptyRow colSpan={mayEdit ? 6 : 5}>No address recorded.</EmptyRow>
                  ) : (
                    activeAddresses.map((address) => (
                      <tr key={address.id}>
                        <td className={cellClass}>
                          {addressTypeLabel(address.addressType)}
                          {address.isPrimary && (
                            <Badge variant="info" className="ml-2">
                              Primary
                            </Badge>
                          )}
                        </td>
                        <td className={`${cellClass} text-ink`}>
                          {address.addressLine1}
                          {address.addressLine2 !== null && (
                            <span className="block text-[#6E6E73]">{address.addressLine2}</span>
                          )}
                          <span className="block text-xs text-[#6E6E73]">
                            {[address.city, address.stateProvince, address.postalCode]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>{address.country}</td>
                        <td className={cellClass}>
                          {address.isVerified ? (
                            <Badge variant="success">Verified</Badge>
                          ) : (
                            <Badge variant="neutral">Unverified</Badge>
                          )}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {sourceTypeLabel(address.sourceType)}
                        </td>
                        {mayEdit && (
                          <td className={`${cellClass} text-right`}>
                            <RemoveRowButton url={`/api/parties/${partyId}/addresses/${address.id}`} />
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-base font-bold text-ink">Sites</h2>
            {mayEdit && <AddSiteForm partyId={partyId} addressOptions={addressOptions} />}
            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Site</th>
                    <th className={headClass}>Address</th>
                    {mayEdit && <th className={headClass} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeSites.length === 0 ? (
                    <EmptyRow colSpan={mayEdit ? 3 : 2}>No site recorded.</EmptyRow>
                  ) : (
                    activeSites.map((site) => {
                      const linked = activeAddresses.find((a) => a.id === site.addressId);
                      return (
                        <tr key={site.id}>
                          <td className={`${cellClass} font-medium text-ink`}>{site.siteName}</td>
                          <td className={`${cellClass} text-[#6E6E73]`}>
                            {linked ? linked.addressLine1 : "Not tied to an address on file"}
                          </td>
                          {mayEdit && (
                            <td className={`${cellClass} text-right`}>
                              <RemoveRowButton url={`/api/parties/${partyId}/sites/${site.id}`} />
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "contacts" && (
        <div className="space-y-4">
          {mayEdit && <AddContactForm partyId={partyId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Name</th>
                  <th className={headClass}>Email</th>
                  <th className={headClass}>Phone</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeContacts.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 5 : 4}>No contact recorded.</EmptyRow>
                ) : (
                  activeContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td className={cellClass}>
                        {displayText(contact.name, "Unnamed contact")}
                        {contact.isPrimary && (
                          <Badge variant="info" className="ml-2">
                            Primary
                          </Badge>
                        )}
                        {contact.title !== null && (
                          <span className="block text-xs text-[#6E6E73]">{contact.title}</span>
                        )}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>{displayText(contact.email)}</td>
                      <td className={`${cellClass} text-[#6E6E73]`}>{displayText(contact.phone)}</td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {sourceTypeLabel(contact.sourceType)}
                      </td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/parties/${partyId}/contacts/${contact.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="space-y-4">
          {mayEdit && <AddRoleForm partyId={partyId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Role</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeRoles.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 3 : 2}>No role recorded.</EmptyRow>
                ) : (
                  activeRoles.map((role) => (
                    <tr key={role.id}>
                      <td className={`${cellClass} font-medium text-ink`}>{roleTypeLabel(role.roleType)}</td>
                      <td className={`${cellClass} text-[#6E6E73]`}>{sourceTypeLabel(role.sourceType)}</td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/parties/${partyId}/roles/${role.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "relationships" && (
        <div className="space-y-6">
          {mayEdit && <AddRelationshipForm partyId={partyId} />}

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">This party is…</h2>
            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Relationship</th>
                    <th className={headClass}>Other party</th>
                    <th className={headClass}>Source</th>
                    {mayEdit && <th className={headClass} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeRelationshipsFrom.length === 0 ? (
                    <EmptyRow colSpan={mayEdit ? 4 : 3}>No relationship recorded from this party.</EmptyRow>
                  ) : (
                    activeRelationshipsFrom.map((relationship) => (
                      <tr key={relationship.id}>
                        <td className={cellClass}>{relationshipTypeLabel(relationship.relationshipType)}</td>
                        <td className={`${cellClass} text-ink`}>
                          <Link
                            href={`/app/parties/${relationship.toParty.id}`}
                            className="font-semibold text-brand hover:underline"
                          >
                            {displayText(relationship.toParty.internalPartyCode, relationship.toParty.id)}
                          </Link>
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {sourceTypeLabel(relationship.sourceType)}
                        </td>
                        {mayEdit && (
                          <td className={`${cellClass} text-right`}>
                            <RemoveRowButton
                              url={`/api/parties/${partyId}/relationships/${relationship.id}`}
                            />
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">…and is named by</h2>
            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Other party</th>
                    <th className={headClass}>Relationship</th>
                    <th className={headClass}>Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeRelationshipsTo.length === 0 ? (
                    <EmptyRow colSpan={3}>No other party has recorded a relationship to this one.</EmptyRow>
                  ) : (
                    activeRelationshipsTo.map((relationship) => (
                      <tr key={relationship.id}>
                        <td className={`${cellClass} text-ink`}>
                          <Link
                            href={`/app/parties/${relationship.fromParty.id}`}
                            className="font-semibold text-brand hover:underline"
                          >
                            {displayText(relationship.fromParty.internalPartyCode, relationship.fromParty.id)}
                          </Link>
                        </td>
                        <td className={cellClass}>{relationshipTypeLabel(relationship.relationshipType)}</td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {sourceTypeLabel(relationship.sourceType)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="rounded-2xl bg-white border border-border p-5">
            <p className="text-sm text-[#6E6E73]">
              A relationship is a stated fact, named by whoever recorded it. Qubere does not infer one
              from name similarity, shared addresses, or anything else, and it never merges the two
              parties on either end of one.
            </p>
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <div className="rounded-2xl bg-white border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={headClass}>Source</th>
                <th className={headClass}>Points at</th>
                <th className={headClass}>Location</th>
                <th className={headClass}>Description</th>
                <th className={headClass}>Recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {party.evidence.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No evidence is attached. Facts on this party rest on whoever entered them.
                </EmptyRow>
              ) : (
                party.evidence.map((evidence) => (
                  <tr key={evidence.id}>
                    <td className={`${cellClass} text-ink`}>{sourceTypeLabel(evidence.sourceType)}</td>
                    <td className={`${cellClass} text-[#6E6E73]`}>
                      {evidence.sourceDocumentId !== null
                        ? "A document in this account"
                        : evidence.sourceExtractedFactId !== null
                          ? "A fact extracted from a document"
                          : evidence.sourceUrl !== null
                            ? evidence.sourceUrl
                            : displayText(evidence.sourceReference)}
                    </td>
                    <td className={`${cellClass} text-[#6E6E73]`}>
                      {evidence.page === null ? "—" : `Page ${evidence.page}`}
                    </td>
                    <td className={`${cellClass} text-[#6E6E73]`}>
                      {displayText(evidence.description)}
                    </td>
                    <td className={`${cellClass} text-[#6E6E73] whitespace-nowrap`}>
                      {displayDate(evidence.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          {historyError && (
            <p role="alert" className="text-sm text-red-700">
              {historyError}
            </p>
          )}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>When</th>
                  <th className={headClass}>Version</th>
                  <th className={headClass}>What changed</th>
                  <th className={headClass}>From</th>
                  <th className={headClass}>To</th>
                  <th className={headClass}>Significance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyLoading ? (
                  <EmptyRow colSpan={6}>Loading…</EmptyRow>
                ) : history.length === 0 ? (
                  <EmptyRow colSpan={6}>Nothing has changed since this party was created.</EmptyRow>
                ) : (
                  history.map((event) => {
                    const presentation = significancePresentation(event.significance);
                    return (
                      <tr key={event.id}>
                        <td className={`${cellClass} text-[#6E6E73] whitespace-nowrap`}>
                          {displayDate(event.createdAt)}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>{event.versionNumber}</td>
                        <td className={cellClass}>
                          <span className="text-ink">{event.field}</span>
                          <span className="block text-xs text-[#6E6E73] font-mono">{event.entity}</span>
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {displayText(event.oldValue, "—")}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {displayText(event.newValue, "—")}
                        </td>
                        <td className={cellClass}>
                          <Badge variant={presentation.tone}>{presentation.label}</Badge>
                          {event.impactFlags.length > 0 && (
                            <span className="block text-xs text-[#6E6E73] mt-1">
                              {event.impactFlags
                                .map((flag) => revalidationPresentation(flag).label)
                                .join(", ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#6E6E73]">
            Showing the most recent 500 changes. Values are superseded rather than overwritten, so a
            prior value stays readable here even after it stops being the one in force.
          </p>
        </div>
      )}
    </>
  );
}
