"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";

interface PipelineStatus {
  jobId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  stalled: boolean;
  currentStep: number;
  totalSteps: number;
  errorMessage?: string;
}

export function PipelineProgressTracker({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [hasRefreshed, setHasRefreshed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // A failed run is terminal: the queue only reclaims stalled runs, so without an
  // explicit re-queue the operator has no way to move the shipment forward.
  const retry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/pipeline-retry`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setRetryError(body?.error?.message ?? `Retry failed (HTTP ${res.status}).`);
        return;
      }
      setStatus(null);
      setHasRefreshed(false);
      // Restart polling: the effect stopped when the job reached FAILED.
      setRetryNonce((n) => n + 1);
      router.refresh();
    } catch {
      setRetryError("Retry could not be sent. Check your connection and try again.");
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/shipments/${shipmentId}/pipeline-status`);
        if (isCancelled) return;

        if (!res.ok) {
          return;
        }

        const data: PipelineStatus = await res.json();
        if (isCancelled) return;

        setStatus(data);

        // If pipeline completed, refresh data ONCE without page reload and stop polling
        if (data.status === "COMPLETED") {
          if (!hasRefreshed) {
            setHasRefreshed(true);
            router.refresh();
          }
          return;
        }

        if (data.status === "FAILED") {
          return;
        }

        // If still PENDING or PROCESSING, poll after 5 seconds
        if (data.status === "PENDING" || data.status === "PROCESSING") {
          timer = setTimeout(checkStatus, 5000);
        }
      } catch (err) {
        console.error("Error checking pipeline status", err);
      }
    };

    checkStatus();

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [shipmentId, hasRefreshed, router, retryNonce]);

  if (!status || status.status === "COMPLETED") {
    return null;
  }

  if (status.status === "FAILED") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-start space-x-3 text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold">
              Document processing failed at agent {status.currentStep} of {status.totalSteps}
            </h4>
            <p className="text-sm opacity-80">
              {status.errorMessage ??
                "The pipeline recorded a failure but did not store a reason."}
            </p>
            <p className="text-sm opacity-80">
              A failed run is not retried automatically. Re-queue it below, or quote job
              reference <span className="font-mono">{status.jobId}</span> when escalating.
            </p>
            {retryError !== null && (
              <p className="text-sm font-semibold text-red-700" role="alert">
                {retryError}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={retry}
            disabled={isRetrying}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] disabled:bg-[#86868B] text-white text-sm font-semibold shadow-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{isRetrying ? "Re-queueing\u2026" : "Retry processing"}</span>
          </button>
        </div>
      </div>
    );
  }

  // PENDING or PROCESSING
  const progressPercent = Math.min(100, Math.round(((status.currentStep - 1) / status.totalSteps) * 100));

  if (status.stalled) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center space-x-3 mb-6 text-amber-900">
        <AlertCircle className="w-5 h-5 text-amber-600" />
        <div>
          <h4 className="text-sm font-bold">Processing Stalled</h4>
          <p className="text-xs opacity-80">
            Agent {status.currentStep} of {status.totalSteps} has not reported progress for several
            minutes. The queue will retry it automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3 text-blue-900">
          <RefreshCw className="w-5 h-5 animate-spin text-[#0071E3]" />
          <div>
            <h4 className="text-sm font-bold">Autonomous AI Pipeline Running</h4>
            <p className="text-xs opacity-80">
              {status.status === "PENDING" ? "Waiting for available worker..." : `Executing Agent ${status.currentStep} of ${status.totalSteps}`}
            </p>
          </div>
        </div>
        <span className="text-sm font-bold text-[#0071E3]">{progressPercent}%</span>
      </div>
      <div className="w-full bg-blue-200/50 rounded-full h-2">
        <div
          className="bg-[#0071E3] h-2 rounded-full transition-all duration-500 ease-in-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
