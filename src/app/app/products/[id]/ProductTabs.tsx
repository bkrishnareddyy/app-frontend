"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { displayDate, displayText } from "@/lib/honest";
import { findAttributeDefinition } from "@/modules/product/productAttributes";
import type { ProductDetail } from "@/modules/product/productService";
import type { CapabilityStatus } from "@/modules/product/productIntelligence";
import {
  PRODUCT_TABS,
  classificationStatusPresentation,
  countryFactStatusPresentation,
  countryFactTypePresentation,
  identifierTypeLabel,
  partyRoleLabel,
  revalidationPresentation,
  significancePresentation,
  sourceTypeLabel,
  type ProductTabId,
} from "@/modules/product/productDisplay";
import {
  AddAttributeForm,
  AddCompositionForm,
  AddCountryFactForm,
  AddIdentifierForm,
  ClassificationReviewActions,
  CountryFactReviewActions,
  ProposeClassificationForm,
  RemoveRowButton,
} from "./ProductActions";

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

export function ProductTabs({
  productId,
  initialTab,
  product,
  mayEdit,
  mayApprove,
  mayVerifyOrigin,
  activeAttributes,
  activeCompositions,
  activeParties,
  approvedJurisdictions,
  capabilities,
}: {
  productId: string;
  initialTab: ProductTabId;
  product: ProductDetail;
  mayEdit: boolean;
  mayApprove: boolean;
  mayVerifyOrigin: boolean;
  activeAttributes: ProductDetail["attributes"];
  activeCompositions: ProductDetail["compositions"];
  activeParties: ProductDetail["parties"];
  approvedJurisdictions: string[];
  capabilities: CapabilityStatus[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ProductTabId>(initialTab);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestedRef = useRef(false);

  function selectTab(next: ProductTabId) {
    setTab(next);
    const href = next === "overview" ? `/app/products/${productId}` : `/app/products/${productId}?tab=${next}`;
    router.replace(href, { scroll: false });
  }

  useEffect(() => {
    if (tab !== "history" || historyRequestedRef.current) return;
    historyRequestedRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    fetch(`/api/products/${productId}/history`)
      .then((response) => {
        if (!response.ok) throw new Error("history request failed");
        return response.json();
      })
      .then((body) => setHistory(Array.isArray(body.events) ? body.events : []))
      .catch(() => setHistoryError("History could not be loaded."))
      .finally(() => setHistoryLoading(false));
  }, [tab, productId]);

  return (
    <>
      <nav aria-label="Product sections" className="border-b border-border">
        <ul className="flex flex-wrap gap-1 -mb-px">
          {PRODUCT_TABS.map((entry) => {
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
                <dt className="w-40 shrink-0 text-[#6E6E73]">Brand</dt>
                <dd className="text-ink">{displayText(product.brand)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Model</dt>
                <dd className="text-ink">{displayText(product.model)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Internal SKU</dt>
                <dd className="text-ink">{displayText(product.internalSku)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Created</dt>
                <dd className="text-ink">{displayDate(product.createdAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-40 shrink-0 text-[#6E6E73]">Last changed</dt>
                <dd className="text-ink">{displayDate(product.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink">Customs position</h2>
            <p className="text-sm text-ink">
              {approvedJurisdictions.length === 0
                ? "No approved classification in any jurisdiction."
                : `Approved in ${approvedJurisdictions.join(", ")}.`}
            </p>
            <p className="text-xs text-[#6E6E73]">
              A classification is approved for one jurisdiction at a time. A code approved for the
              United States says nothing about how the same goods are classified in the EU, and this
              product carries no single global tariff code.
            </p>
            <button
              type="button"
              onClick={() => selectTab("trade")}
              className="inline-flex text-sm font-semibold text-brand"
            >
              Open Trade &amp; customs →
            </button>
          </section>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3 lg:col-span-2">
            <h2 className="text-sm font-bold text-ink">Descriptions</h2>
            <dl className="text-sm space-y-3">
              <div>
                <dt className="text-[#6E6E73]">Customs description</dt>
                <dd className="text-ink mt-1">{displayText(product.customsDescription)}</dd>
              </div>
              <div>
                <dt className="text-[#6E6E73]">Technical description</dt>
                <dd className="text-ink mt-1">{displayText(product.technicalDescription)}</dd>
              </div>
              <div>
                <dt className="text-[#6E6E73]">Commercial description</dt>
                <dd className="text-ink mt-1">{displayText(product.commercialDescription)}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {tab === "identifiers" && (
        <div className="space-y-4">
          {mayEdit && <AddIdentifierForm productId={productId} />}
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
                {product.identifiers.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 6 : 5}>
                    No identifiers. Without one, an incoming shipment line cannot be matched to this
                    product by anything stronger than its name.
                  </EmptyRow>
                ) : (
                  product.identifiers.map((identifier) => (
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
                        {displayText(identifier.issuerPartyId, "Not tied to a party")}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {sourceTypeLabel(identifier.sourceType)}
                      </td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton
                            url={`/api/products/${productId}/identifiers/${identifier.id}`}
                          />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#6E6E73]">
            A manufacturer part number that is not tied to an issuing party is a weak identifier:
            the same number belongs to different products at different manufacturers, so matching on
            it alone never produces an exact match.
          </p>
        </div>
      )}

      {tab === "attributes" && (
        <div className="space-y-4">
          {mayEdit && <AddAttributeForm productId={productId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Attribute</th>
                  <th className={headClass}>Value</th>
                  <th className={headClass}>Unit</th>
                  <th className={headClass}>Customs-significant</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeAttributes.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 6 : 5}>No attributes recorded.</EmptyRow>
                ) : (
                  activeAttributes.map((attribute) => {
                    const definition = findAttributeDefinition(attribute.attributeCode);
                    return (
                      <tr key={attribute.id}>
                        <td className={cellClass}>
                          <span className="font-medium text-ink">{attribute.attributeName}</span>
                          <span className="block text-xs text-[#6E6E73] font-mono">
                            {attribute.attributeCode}
                          </span>
                        </td>
                        <td className={`${cellClass} text-ink`}>{attribute.rawValue}</td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {displayText(attribute.rawUnit, "—")}
                          {attribute.normalizedUnit !== null &&
                            attribute.normalizedUnit !== attribute.rawUnit && (
                              <span className="block text-xs">
                                stored as {attribute.normalizedUnit}
                              </span>
                            )}
                        </td>
                        <td className={cellClass}>
                          {definition === null ? (
                            <Badge variant="warning">Treated as significant</Badge>
                          ) : definition.customsSignificant ? (
                            <Badge variant="danger">Yes</Badge>
                          ) : (
                            <Badge variant="neutral">No</Badge>
                          )}
                        </td>
                        <td className={`${cellClass} text-[#6E6E73]`}>
                          {sourceTypeLabel(attribute.sourceType)}
                        </td>
                        {mayEdit && (
                          <td className={`${cellClass} text-right`}>
                            <RemoveRowButton
                              url={`/api/products/${productId}/attributes/${attribute.id}`}
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
          <p className="text-xs text-[#6E6E73]">
            An attribute code Qubere does not recognise is treated as customs-significant, because
            nothing in the catalogue vouches for it. Removing an attribute supersedes it; the value
            and its evidence stay readable in history.
          </p>
        </div>
      )}

      {tab === "composition" && (
        <div className="space-y-4">
          {mayEdit && <AddCompositionForm productId={productId} />}
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Material</th>
                  <th className={headClass}>Component</th>
                  <th className={headClass}>Percentage</th>
                  <th className={headClass}>Grade / alloy</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeCompositions.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 6 : 5}>No composition recorded.</EmptyRow>
                ) : (
                  activeCompositions.map((row) => (
                    <tr key={row.id}>
                      <td className={`${cellClass} font-medium text-ink`}>{row.material}</td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {displayText(row.componentName)}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {row.percentage === null ? "Not stated" : `${row.percentage.toString()}%`}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {displayText(row.grade ?? row.alloy)}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {sourceTypeLabel(row.sourceType)}
                      </td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/products/${productId}/compositions/${row.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {activeCompositions.length > 0 && (
            <p className="text-xs text-[#6E6E73]">
              {activeCompositions.some((row) => row.isCompleteDeclaration)
                ? "At least one row was recorded as a complete declaration, so a percentage total is meaningful. Qubere reports the total; it does not enforce one."
                : "No source stated a complete composition, so these percentages do not add up to a whole and should not be read as if they did."}
            </p>
          )}
        </div>
      )}

      {tab === "parties" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={headClass}>Role</th>
                  <th className={headClass}>Party</th>
                  <th className={headClass}>Site</th>
                  <th className={headClass}>Source</th>
                  {mayEdit && <th className={headClass} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeParties.length === 0 ? (
                  <EmptyRow colSpan={mayEdit ? 5 : 4}>
                    No manufacturer, supplier or brand owner is linked. Parties are linked from the
                    account&apos;s legal entities.
                  </EmptyRow>
                ) : (
                  activeParties.map((party) => (
                    <tr key={party.id}>
                      <td className={cellClass}>{partyRoleLabel(party.role)}</td>
                      <td className={`${cellClass} font-medium text-ink`}>
                        {party.legalEntity.legalName}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {displayText(party.manufacturingSite)}
                      </td>
                      <td className={`${cellClass} text-[#6E6E73]`}>
                        {sourceTypeLabel(party.sourceType)}
                      </td>
                      {mayEdit && (
                        <td className={`${cellClass} text-right`}>
                          <RemoveRowButton url={`/api/products/${productId}/parties/${party.id}`} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded-2xl bg-white border border-border p-5">
            <h2 className="text-sm font-bold text-ink">Manufacturing is not origin</h2>
            <p className="text-sm text-[#6E6E73] mt-2">
              Naming a manufacturer records who makes the goods and, where the tenant tracks it,
              where. It does not set the country of origin. Origin is a legal conclusion drawn from
              rules of origin, and Qubere does not apply them — the country facts below are claims
              and their evidence, kept separately for exactly this reason.
            </p>
            <button
              type="button"
              onClick={() => selectTab("trade")}
              className="inline-flex text-sm font-semibold text-brand mt-3"
            >
              See country facts →
            </button>
          </div>
        </div>
      )}

      {tab === "trade" && (
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-ink">Classifications</h2>
              <p className="text-sm text-[#6E6E73] mt-1">
                One row per jurisdiction and nomenclature. Only a row marked Approved is a position
                of record; a candidate is working state and must not be filed.
              </p>
            </div>

            {mayEdit && <ProposeClassificationForm productId={productId} />}

            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Jurisdiction</th>
                    <th className={headClass}>Nomenclature</th>
                    <th className={headClass}>Code</th>
                    <th className={headClass}>Status</th>
                    <th className={headClass}>Decided by</th>
                    <th className={headClass}>Effective</th>
                    {mayEdit && <th className={headClass} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.classifications.length === 0 ? (
                    <EmptyRow colSpan={mayEdit ? 7 : 6}>
                      This product has no classification anywhere. It is not misclassified — it is
                      unclassified, and a filing that needs a code will need one made here first.
                    </EmptyRow>
                  ) : (
                    product.classifications.map((classification) => {
                      const presentation = classificationStatusPresentation(classification.status);
                      return (
                        <tr key={classification.id}>
                          <td className={`${cellClass} font-semibold text-ink`}>
                            {classification.jurisdiction}
                          </td>
                          <td className={`${cellClass} text-[#6E6E73]`}>
                            {classification.nomenclature}
                          </td>
                          <td className={`${cellClass} font-mono text-ink`}>
                            {classification.classificationCode}
                            {classification.description !== null && (
                              <span className="block font-sans text-xs text-[#6E6E73]">
                                {classification.description}
                              </span>
                            )}
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
                            {sourceTypeLabel(classification.decisionSource)}
                            <span className="block text-xs">{classification.decisionMethod}</span>
                          </td>
                          <td className={`${cellClass} text-[#6E6E73] whitespace-nowrap`}>
                            {classification.status === "APPROVED"
                              ? displayDate(classification.effectiveFrom)
                              : "—"}
                          </td>
                          {mayEdit && (
                            <td className={cellClass}>
                              <ClassificationReviewActions
                                productId={productId}
                                classificationId={classification.id}
                                status={classification.status}
                                canApprove={mayApprove}
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
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-ink">Country facts</h2>
              <p className="text-sm text-[#6E6E73] mt-1">
                Where goods are made and what origin is claimed are separate rows with separate
                evidence. Qubere records both; it derives neither from the other.
              </p>
            </div>

            {mayEdit && <AddCountryFactForm productId={productId} />}

            <div className="rounded-2xl bg-white border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headClass}>Claim</th>
                    <th className={headClass}>Country</th>
                    <th className={headClass}>Status</th>
                    <th className={headClass}>Source</th>
                    {mayEdit && <th className={headClass} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.countryFacts.length === 0 ? (
                    <EmptyRow colSpan={mayEdit ? 5 : 4}>No country facts recorded.</EmptyRow>
                  ) : (
                    product.countryFacts.map((fact) => {
                      const type = countryFactTypePresentation(fact.factType);
                      const presentation = countryFactStatusPresentation(fact.status);
                      return (
                        <tr key={fact.id}>
                          <td className={cellClass}>
                            <span className="font-medium text-ink">{type.label}</span>
                            <span className="block text-xs text-[#6E6E73] max-w-[20rem]">
                              {type.description}
                            </span>
                          </td>
                          <td className={cellClass}>
                            <span className="text-ink">{fact.rawCountry}</span>
                            {fact.countryCode === null ? (
                              <span className="block text-xs text-amber-700">
                                Not resolved to an ISO code
                              </span>
                            ) : (
                              <span className="block text-xs text-[#6E6E73] font-mono">
                                {fact.countryCode}
                              </span>
                            )}
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
                            {sourceTypeLabel(fact.sourceType)}
                            {fact.sourceReference !== null && (
                              <span className="block text-xs">{fact.sourceReference}</span>
                            )}
                          </td>
                          {mayEdit && (
                            <td className={cellClass}>
                              <CountryFactReviewActions
                                productId={productId}
                                factId={fact.id}
                                status={fact.status}
                                canVerify={mayVerifyOrigin}
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
          </section>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink">What Qubere does not do here</h2>
            <ul className="space-y-2 text-sm text-[#6E6E73]">
              {capabilities.map((capability) => (
                <li key={capability.capability}>
                  <span className="font-semibold text-ink capitalize">{capability.capability}</span>
                  : {capability.message}
                </li>
              ))}
            </ul>
          </section>
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
              {product.evidence.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No evidence is attached. Facts on this product rest on whoever entered them.
                </EmptyRow>
              ) : (
                product.evidence.map((evidence) => (
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
                  <EmptyRow colSpan={6}>Nothing has changed since this product was created.</EmptyRow>
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
                          <span className="block text-xs text-[#6E6E73] font-mono">
                            {event.entity}
                          </span>
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
