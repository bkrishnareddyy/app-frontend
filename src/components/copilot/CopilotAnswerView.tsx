"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, FileCheck2 } from "lucide-react";
import { Badge } from "@/components/ui";
import type { CopilotAction, CopilotAnswer, CopilotStatus } from "@/modules/copilot/copilotContract";
import { CopilotText } from "./CopilotText";

/**
 * One assistant turn, rendered from the validated answer.
 *
 * Everything shown here has been through the grounding ledger: entity labels are
 * the ones the services returned, evidence ids are rows that exist, and every
 * href was built by the server from an action type and a checked id. The panel
 * renders what it is given and constructs no routes of its own.
 */

const STATUS_META: Record<
  CopilotStatus,
  { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral"; show: boolean }
> = {
  // The happy path carries no badge: labelling every answer "ANSWERED" is noise.
  ANSWERED: { label: "Answered", variant: "success", show: false },
  PARTIAL: { label: "Partial answer", variant: "warning", show: true },
  NEEDS_CLARIFICATION: { label: "Needs detail", variant: "info", show: true },
  NOT_FOUND: { label: "Not found", variant: "neutral", show: true },
  NOT_AUTHORIZED: { label: "No access", variant: "danger", show: true },
  INSUFFICIENT_DATA: { label: "Not recorded", variant: "warning", show: true },
  ERROR: { label: "Unavailable", variant: "danger", show: true },
};

function ActionButton({
  action,
  conversationId,
}: {
  action: CopilotAction;
  conversationId: string | null;
}) {
  const router = useRouter();

  const follow = () => {
    // Audit the click, then navigate. Fire-and-forget: a failed audit write must
    // not strand the user on the panel, and the href is already validated — this
    // call records that a suggestion was acted on, it does not authorise it.
    void fetch("/api/copilot/navigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: action.type,
        entityId: action.entityId,
        ...(conversationId ? { conversationId } : {}),
      }),
    }).catch(() => undefined);

    router.push(action.href);
  };

  return (
    <button
      type="button"
      onClick={follow}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-brand bg-brand/10 hover:bg-brand/15 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {action.label}
      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
    </button>
  );
}

export function CopilotAnswerView({
  answer,
  conversationId,
}: {
  answer: CopilotAnswer;
  conversationId: string | null;
}) {
  const status = STATUS_META[answer.status];

  return (
    <div className="space-y-3">
      {status.show && (
        <Badge variant={status.variant}>{status.label}</Badge>
      )}

      <CopilotText text={answer.answer} />

      {answer.warnings.length > 0 && (
        <ul className="space-y-1.5" aria-label="Things to be aware of">
          {answer.warnings.map((warning, index) => (
            <li
              key={index}
              className="flex gap-2 items-start text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {answer.evidence.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Evidence</p>
          <ul className="space-y-1">
            {answer.evidence.map((item) => (
              <li
                key={item.evidenceId}
                className="flex gap-2 items-start text-[11px] text-ink-muted bg-surface-muted border border-border rounded-lg px-2.5 py-1.5"
              >
                <FileCheck2 className="w-3.5 h-3.5 shrink-0 mt-px text-brand" aria-hidden="true" />
                <span>
                  <span className="text-ink font-medium">{item.label}</span>
                  {item.detail && <span> — {item.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.suggestedActions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {answer.suggestedActions.map((action) => (
            <ActionButton
              key={`${action.type}:${action.entityId}`}
              action={action}
              conversationId={conversationId}
            />
          ))}
        </div>
      )}

      {answer.steps.length > 0 && (
        <p className="text-[10px] text-ink-muted">
          {/* What was consulted, never why. The model's reasoning is discarded
              server-side and has nothing to render here. */}
          Checked: {answer.steps.join(" · ")}
        </p>
      )}
    </div>
  );
}
