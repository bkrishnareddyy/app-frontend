import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite } from "@/lib/api/write-access";
import { Badge } from "@/components/ui";
import { displayDate, displayText } from "@/lib/honest";
import { holdsPermission, partyActor } from "@/modules/party/partyActor";
import { getParty } from "@/modules/party/partyService";
import {
  addressTypeLabel,
  partyDisplayName,
  partyKindLabel,
  partyStatusPresentation,
  resolveTab,
  reviewStatusPresentation,
  revalidationPresentation,
} from "@/modules/party/partyDisplay";
import { PartyReviewActions, RevalidationActions } from "./PartyActions";
import { PartyTabs } from "./PartyTabs";

export const dynamic = "force-dynamic";

export default async function PartyDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const actor = partyActor(context, "page");
  const party = await getParty(actor, id);
  // A party in another account is absent, not forbidden.
  if (party === null) notFound();

  const rawTab = searchParams.tab;
  const tab = resolveTab(typeof rawTab === "string" ? rawTab : null);

  const writable = canWrite(context);
  const mayEdit = writable && holdsPermission(context, "parties.edit");
  const mayApprove = writable && holdsPermission(context, "parties.review.approve");
  const mayVerifyRegistration = writable && holdsPermission(context, "parties.registration.verify");
  const mayReadScreening = holdsPermission(context, "compliance.restrictedParty.read");
  const mayScreen = writable && holdsPermission(context, "compliance.restrictedParty.screen");
  const mayDisposeScreening = writable && holdsPermission(context, "compliance.restrictedParty.dispose");

  const status = partyStatusPresentation(party.status);
  const review = reviewStatusPresentation(party.reviewStatus);
  const openFlags = party.revalidationFlags.filter((flag) => flag.status === "OPEN");
  const activeNames = party.names.filter((n) => n.status === "ACTIVE");
  const activeIdentifiers = party.identifiers.filter((i) => i.status === "ACTIVE");
  const activeAddresses = party.addresses.filter((a) => a.status === "ACTIVE");
  const activeContacts = party.contacts.filter((c) => c.status === "ACTIVE");
  const activeRoles = party.roles.filter((r) => r.status === "ACTIVE");
  const activeSites = party.sites.filter((s) => s.status === "ACTIVE");
  const activeRelationshipsFrom = party.relationshipsFrom.filter((r) => r.status === "ACTIVE");
  const activeRelationshipsTo = party.relationshipsTo.filter((r) => r.status === "ACTIVE");

  const addressOptions = activeAddresses.map((address) => ({
    id: address.id,
    label: `${addressTypeLabel(address.addressType)} — ${address.addressLine1}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/parties" className="text-sm font-semibold text-brand">
          ← Parties
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {partyDisplayName(party)}
            </h1>
            <p className="text-sm text-ink-muted mt-1">
              {displayText(party.internalPartyCode, "No internal code")} · {partyKindLabel(party.partyKind)}{" "}
              · version {party.currentVersion}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={review.tone}>{review.label}</Badge>
            <Badge variant={status.tone}>{status.label}</Badge>
          </div>
        </div>
        {mayEdit && (
          <div className="mt-3">
            <PartyReviewActions partyId={id} reviewStatus={party.reviewStatus} canApprove={mayApprove} />
          </div>
        )}
      </div>

      {openFlags.length > 0 && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-amber-900">
              {openFlags.length === 1
                ? "One thing is waiting to be re-checked"
                : `${openFlags.length} things are waiting to be re-checked`}
            </h2>
            <p className="text-xs text-amber-900/80 mt-1">
              These are requests for a person to look again. Nothing here has changed this party&apos;s
              identity, registration, or review state, and none of it is a screening result.
            </p>
          </div>
          <ul className="space-y-3">
            {openFlags.map((flag) => {
              const presentation = revalidationPresentation(flag.flag);
              return (
                <li key={flag.id} className="rounded-xl bg-white border border-amber-200 p-4 space-y-2">
                  <p className="text-sm font-semibold text-ink">{presentation.label}</p>
                  <p className="text-xs text-[#6E6E73]">{flag.reason}</p>
                  <p className="text-xs text-[#6E6E73]">{presentation.description}</p>
                  <p className="text-xs text-[#6E6E73]">Raised {displayDate(flag.createdAt)}</p>
                  {mayEdit && <RevalidationActions partyId={id} flagId={flag.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <PartyTabs
        partyId={id}
        initialTab={tab}
        party={party}
        mayEdit={mayEdit}
        mayVerifyRegistration={mayVerifyRegistration}
        mayReadScreening={mayReadScreening}
        mayScreen={mayScreen}
        mayDisposeScreening={mayDisposeScreening}
        reviewHint={review.hint}
        activeNames={activeNames}
        activeIdentifiers={activeIdentifiers}
        activeAddresses={activeAddresses}
        activeContacts={activeContacts}
        activeRoles={activeRoles}
        activeSites={activeSites}
        activeRelationshipsFrom={activeRelationshipsFrom}
        activeRelationshipsTo={activeRelationshipsTo}
        addressOptions={addressOptions}
      />
    </div>
  );
}
