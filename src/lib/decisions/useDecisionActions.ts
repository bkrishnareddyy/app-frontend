"use client";

import { useState } from "react";
import { caughtMessage } from "@/lib/utils";

export type DecisionAction = "APPROVE" | "REJECT" | "RE_EVALUATE";

export function useDecisionActions(
  onStatusChange: (decisionId: string, newStatus: string) => void
) {
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const runDecisionAction = async (
    decisionId: string,
    action: DecisionAction,
    humanNotes?: string
  ): Promise<boolean> => {
    setActionLoadingId(decisionId);
    const newStatus =
      action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : "In Progress";

    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, action, humanNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      onStatusChange(decisionId, newStatus);
      return true;
    } catch (err) {
      alert(`Action failed: ${caughtMessage(err, String(err))}`);
      return false;
    } finally {
      setActionLoadingId(null);
    }
  };

  return { actionLoadingId, runDecisionAction };
}
