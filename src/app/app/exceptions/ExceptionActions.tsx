"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EXCEPTION_STATES,
  exceptionStatusLabel,
  isRiskAcceptance,
  normalizeExceptionStatus,
  requiresResolutionReason,
} from "@/modules/exceptions/exceptionState";

interface ShipmentOption {
  id: string;
  shipmentNumber: string;
  importerName: string | null;
}

interface ExceptionActionsProps {
  exceptionId: string;
  version: number;
  status: string;
  hasShipment: boolean;
  canWrite: boolean;
  canWaive: boolean;
  waivePermission: string;
  readOnlyMessage: string;
}

export function ExceptionActions({
  exceptionId,
  version,
  status,
  hasShipment,
  canWrite,
  canWaive,
  waivePermission,
  readOnlyMessage,
}: ExceptionActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState(() => normalizeExceptionStatus(status) ?? "OPEN");
  const [reason, setReason] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [shipmentTotal, setShipmentTotal] = useState<number | null>(null);
  const [currentVersion, setCurrentVersion] = useState(version);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const needsReason = requiresResolutionReason(nextStatus);
  const statusChanged = nextStatus !== normalizeExceptionStatus(status);
  const attaching = !hasShipment && shipmentId !== "";
  const waiveBlocked = statusChanged && isRiskAcceptance(nextStatus) && !canWaive;

  useEffect(() => {
    if (!open || hasShipment) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ view: "summary", pageSize: "50" });
        if (shipmentSearch.trim()) params.set("q", shipmentSearch.trim());
        fetch(`/api/shipments?${params.toString()}`, { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load shipments"))))
          .then((data) => {
            setShipments(data.shipments ?? []);
            setShipmentTotal(typeof data.total === "number" ? data.total : null);
          })
          .catch((err: unknown) => {
            if (err instanceof Error && err.name === "AbortError") return;
            setShipments([]);
            setShipmentTotal(null);
          });
      },
      shipmentSearch ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, hasShipment, shipmentSearch]);

  if (!canWrite) {
    return <p className="text-sm text-ink-muted pt-1">{readOnlyMessage}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-brand hover:underline pt-1"
      >
        Update this exception
      </button>
    );
  }

  const submit = async () => {
    if (waiveBlocked) {
      setError(
        `Waiving an exception accepts the risk it describes. Your role does not hold ${waivePermission}.`
      );
      return;
    }
    if (needsReason && reason.trim() === "") {
      setError(`A stated reason is required to move this exception to ${exceptionStatusLabel(nextStatus)}.`);
      return;
    }
    if (!statusChanged && !attaching) {
      setError("Nothing has been changed yet.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: currentVersion,
          ...(statusChanged ? { status: nextStatus } : {}),
          ...(needsReason ? { resolutionReason: reason.trim() } : {}),
          ...(attaching ? { shipmentId } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? "Someone else changed this exception while you were working. Reload the page to see the current state."
            : data?.error?.message || data?.error || "The update failed."
        );
      }

      setCurrentVersion(data.exception?.version ?? currentVersion + 1);
      setSuccess(
        attaching
          ? "Saved. The exception is now attached to that shipment."
          : "Saved. The reason you gave is stored in the audit log."
      );
      setReason("");
      setShipmentId("");
      router.refresh();
    } catch (err: unknown) {
      // A failed write must never be dressed up as a save.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-3 mt-2 border-t border-border space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <label
            htmlFor={`status-${exceptionId}`}
            className="block text-xs font-semibold text-ink-muted mb-1"
          >
            Status
          </label>
          <select
            id={`status-${exceptionId}`}
            value={nextStatus}
            onChange={(e) => setNextStatus(normalizeExceptionStatus(e.target.value) ?? nextStatus)}
            className="h-10 px-3 rounded-xl border border-border text-sm bg-white"
          >
            {EXCEPTION_STATES.map((state) => (
              <option key={state} value={state}>
                {exceptionStatusLabel(state)}
              </option>
            ))}
          </select>
        </div>

        {!hasShipment && (
          <>
            <div>
              <label
                htmlFor={`shipment-search-${exceptionId}`}
                className="block text-xs font-semibold text-ink-muted mb-1"
              >
                Find a shipment
              </label>
              <input
                id={`shipment-search-${exceptionId}`}
                type="search"
                value={shipmentSearch}
                onChange={(e) => setShipmentSearch(e.target.value)}
                className="h-10 px-3 rounded-xl border border-border text-sm"
              />
            </div>
            <div>
              <label
                htmlFor={`shipment-${exceptionId}`}
                className="block text-xs font-semibold text-ink-muted mb-1"
              >
                Attach to shipment
              </label>
              <select
                id={`shipment-${exceptionId}`}
                value={shipmentId}
                onChange={(e) => setShipmentId(e.target.value)}
                className="h-10 px-3 rounded-xl border border-border text-sm bg-white max-w-xs"
              >
                <option value="">Leave unattached</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shipmentNumber}
                    {s.importerName ? ` · ${s.importerName}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {!hasShipment && shipmentTotal !== null && shipmentTotal > shipments.length && (
        <p role="status" className="text-sm text-ink-muted">
          Showing {shipments.length} of {shipmentTotal} shipments. Search to narrow the list.
        </p>
      )}

      {waiveBlocked && (
        <p role="status" className="text-sm text-amber-800">
          Waiving accepts the risk this exception describes. Your role does not hold{" "}
          {waivePermission}, so this change will be refused.
        </p>
      )}

      {needsReason && (
        <div>
          <label
            htmlFor={`reason-${exceptionId}`}
            className="block text-xs font-semibold text-ink-muted mb-1"
          >
            Why is this being closed? Stored in the audit log, because no column holds it.
          </label>
          <textarea
            id={`reason-${exceptionId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-border text-sm"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700">
          {success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="h-10 px-4 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setSuccess(null);
          }}
          className="text-sm font-semibold text-[#6E6E73]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
