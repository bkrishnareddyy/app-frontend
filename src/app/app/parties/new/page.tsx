import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { holdsPermission } from "@/modules/party/partyActor";
import { NewPartyForm } from "./NewPartyForm";

export const dynamic = "force-dynamic";

export default async function NewPartyPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const writable = canWrite(context);
  const mayCreate = writable && holdsPermission(context, "parties.create");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/parties" className="text-sm font-semibold text-brand">
          ← Parties
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mt-2">Add a party</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-3xl">
          This records who the party says it is. A legal name is required; everything else —
          identifiers, a registration, an address, a role — can be added here or afterwards from the
          party&apos;s own page. Nothing here is a screening result and nothing here verifies
          anything against evidence.
        </p>
      </div>

      {mayCreate ? (
        <NewPartyForm />
      ) : (
        <div role="status" className="rounded-2xl bg-white border border-border p-6 text-sm text-ink">
          {writable
            ? "You do not hold parties.create in this account, so you cannot add a party here."
            : READ_ONLY_MESSAGE}
        </div>
      )}
    </div>
  );
}
