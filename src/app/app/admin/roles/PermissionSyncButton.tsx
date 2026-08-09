"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SyncResult {
  permissionsCreated: string[];
  grantsAdded: { roleName: string; permission: string }[];
  rolesMissing: string[];
}

export function PermissionSyncButton({ canSync }: { canSync: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  if (!canSync) {
    return (
      <p className="text-sm text-[#6E6E73]">
        Only an account owner can create the permission catalogue.
      </p>
    );
  }

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/permissions/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "The catalogue could not be synced.");
        return;
      }
      setResult(data.result as SyncResult);
      router.refresh();
    } catch {
      setError("The catalogue could not be synced. The request did not complete.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white text-sm font-semibold rounded-xl"
      >
        {running ? "Creating permissions…" : "Create missing permissions and grants"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div role="status" className="text-sm text-[#1D1D1F] space-y-1">
          <p>
            {result.permissionsCreated.length === 0
              ? "No permissions needed creating."
              : `Created ${result.permissionsCreated.length}: ${result.permissionsCreated.join(", ")}.`}
          </p>
          <p>
            {result.grantsAdded.length === 0
              ? "No role grants needed adding."
              : `Granted ${result.grantsAdded.length}: ${result.grantsAdded
                  .map((g) => `${g.roleName} → ${g.permission}`)
                  .join(", ")}.`}
          </p>
          {result.rolesMissing.length > 0 && (
            <p className="text-amber-800">
              These roles are named in the catalogue but do not exist, so nothing was
              granted to them: {result.rolesMissing.join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
