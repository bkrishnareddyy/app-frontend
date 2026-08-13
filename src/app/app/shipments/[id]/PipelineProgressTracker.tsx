"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

interface StepExecution {
  stepNumber: number;
  agentName: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
}

interface PipelineStatus {
  jobId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentStep: number;
  totalSteps: number;
  stalled?: boolean;
  errorMessage?: string;
  stepExecutions?: StepExecution[];
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
        if (!res.ok) return;

        const data: PipelineStatus = await res.json();
        if (isCancelled) return;

        setStatus(data);

        if (data.status === "COMPLETED") {
          if (!hasRefreshed) {
            setHasRefreshed(true);
            router.refresh();
          }
          return;
        }

        if (data.status === "FAILED") return;

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

  if (!status || status.status === "COMPLETED") return null;

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

  const progressPercent = Math.min(100, Math.round((status.currentStep / status.totalSteps) * 100));
  const steps = status.stepExecutions ?? [];
  const currentStepName =
    steps.find((s) => s.status === "REVIEW_REQUIRED" || (s.stepNumber === status.currentStep && s.status !== "SUCCESS"))
      ?.agentName ?? null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 text-blue-900">
          <RefreshCw className="w-5 h-5 animate-spin text-brand" />
          <div>
            <h4 className="text-sm font-bold">Autonomous AI Pipeline Running</h4>
            <p className="text-xs opacity-80">
              {status.status === "PENDING"
                ? "Waiting for available worker…"
                : currentStepName
                ? `Running: ${currentStepName}`
                : `Agent ${status.currentStep} of ${status.totalSteps}`}
              {status.stalled && " · stalled — will be reclaimed automatically"}
            </p>
          </div>
        </div>
        <span className="text-sm font-bold text-brand">{progressPercent}%</span>
      </div>

      <div className="w-full bg-blue-200/50 rounded-full h-1.5">
        <div
          className="bg-brand h-1.5 rounded-full transition-all duration-500 ease-in-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {steps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {steps
            .slice()
            .sort((a, b) => a.stepNumber - b.stepNumber)
            .map((step) => {
              const icon =
                step.status === "SUCCESS" ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                ) : step.status === "FAILED" ? (
                  <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                ) : (
                  <RefreshCw className="w-3 h-3 animate-spin text-brand shrink-0" />
                );
              return (
                <span
                  key={step.stepNumber}
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    step.status === "SUCCESS"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : step.status === "FAILED"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-blue-100 text-blue-800 border-blue-300"
                  }`}
                >
                  {icon}
                  {step.agentName}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}
