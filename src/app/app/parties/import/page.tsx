import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { canWrite, READ_ONLY_MESSAGE } from "@/lib/api/write-access";
import { holdsPermission } from "@/modules/party/partyActor";
import { ImportWizard } from "./ImportWizard";

export const dynamic = "force-dynamic";

export default async function PartyImportPage() {
  const context = await getAccountContext();
  if (!context) redirect("/sign-in");

  const writable = canWrite(context);
  const mayImport = writable && holdsPermission(context, "parties.import");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/parties" className="text-sm font-semibold text-brand">
          ← Parties
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mt-2">Import parties</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-3xl">
          Upload a file, read what it would do, then apply it. Nothing is written until you press
          Import. Each row is matched against the party master by the same deterministic rules used
          everywhere else — a row that matches exactly is skipped, and a row whose match is only
          possible or ambiguous is left for a person to resolve rather than guessed at.
        </p>
      </div>

      {mayImport ? (
        <ImportWizard />
      ) : (
        <div role="status" className="rounded-2xl bg-white border border-border p-6 text-sm text-ink">
          {writable
            ? "You do not hold parties.import in this account, so you cannot import parties here."
            : READ_ONLY_MESSAGE}
        </div>
      )}
    </div>
  );
}
