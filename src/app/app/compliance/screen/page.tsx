import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { holdsPermission } from "@/modules/party/partyActor";
import { db } from "@/lib/db";
import { RestrictedPartyScreeningForm } from "./RestrictedPartyScreeningForm";

export const dynamic = "force-dynamic";

export default async function RestrictedPartyScreeningPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const writable = canWrite(context);
  const mayScreen = writable && holdsPermission(context, "compliance.restrictedParty.screen");

  const countries = await db.country.findMany({ orderBy: { cyName: "asc" } });
  const countryOptions = countries.map((c) => {
    const name = c.cyName ?? c.cyShortName ?? c.cyId;
    return { code: c.cyId, label: `${name} (${c.cyId})` };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/compliance?tab=screening&screeningTab=party" className="text-sm font-semibold text-brand">
          ← Party Screening
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mt-2">Restricted Party Screening</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-3xl">
          Screen an arbitrary party and country pair that isn&apos;t (yet) a saved Party Master record or
          shipment. Runs the same country embargo and denied-party checks used everywhere else in Qubere, and
          keeps a permanent record of the result.
        </p>
      </div>

      {mayScreen ? (
        <RestrictedPartyScreeningForm countries={countryOptions} />
      ) : (
        <div role="status" className="rounded-2xl bg-white border border-border p-6 text-sm text-ink">
          {writable
            ? "You do not hold compliance.restrictedParty.screen in this account, so you cannot run a screening here."
            : READ_ONLY_MESSAGE}
        </div>
      )}
    </div>
  );
}
