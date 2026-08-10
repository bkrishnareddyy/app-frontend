"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";

interface PipelineStatus {
  jobId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentStep: number;
  totalSteps: number;
  errorMessage?: string;
}

export function PipelineProgressTracker({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [hasRefreshed, setHasRefreshed] = useState(false);

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
  }, [shipmentId, hasRefreshed, router]);

  if (!status || status.status === "COMPLETED") {
    return null;
  }

  if (status.status === "FAILED") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3 text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <div>
            <h4 className="text-sm font-bold">Processing Exception</h4>
            <p className="text-xs opacity-80">{status.errorMessage || "An error occurred during AI processing."}</p>
          </div>
        </div>
      </div>
    );
  }

  // PENDING or PROCESSING
  const progressPercent = Math.min(100, Math.round(((status.currentStep - 1) / status.totalSteps) * 100));

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
