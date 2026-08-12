"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { copilotStarters } from "@/modules/copilot/copilotStarters";
import { MAX_QUESTION_CHARS } from "@/modules/copilot/copilotContract";
import { useCopilot } from "./CopilotProvider";
import { CopilotAnswerView } from "./CopilotAnswerView";

/**
 * The Copilot panel: a dismissible surface on the right of the current page.
 *
 * It does not navigate anywhere and does not replace the screen behind it. On
 * desktop it is a fixed-width column; below `sm` it becomes a full-height sheet,
 * which is the only shape that works at that width.
 *
 * It is deliberately *not* a modal. `useDialogFocus` traps Tab, which is right
 * for a dialog and wrong here: the whole premise is that the underlying workflow
 * stays usable, so a broker can read the panel and keep working the shipment. So
 * it is a labelled complementary region — focus moves to the composer on open
 * and returns to the launcher on close, and Escape closes it, but Tab is free to
 * leave.
 */
export function CopilotPanel() {
  const {
    enabled,
    isOpen,
    close,
    turns,
    pending,
    transportError,
    ask,
    reset,
    pageContext,
    conversationId,
  } = useCopilot();
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Focus in on open, back out on close. Captured before focusing so the
  // launcher gets it back rather than whatever the panel touched last.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    composerRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  // Keep the newest turn in view as answers arrive.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, pending]);

  // Checked as well as in the launcher: nothing else can open the panel today,
  // but a future keyboard shortcut or deep link must not resurrect it.
  if (!enabled || !isOpen) return null;

  const submit = () => {
    const question = draft.trim();
    if (!question || pending) return;
    setDraft("");
    void ask(question);
  };

  const starters = copilotStarters(pageContext.page);

  return (
    <aside
      aria-label="Qubere AI Copilot"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[400px] bg-white border-l border-border shadow-lg flex flex-col"
    >
      <header className="h-16 shrink-0 px-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 shrink-0 text-brand" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink truncate">Qubere AI Copilot</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              title="Start a new conversation"
              className="p-2 rounded-lg text-ink-muted hover:bg-surface-muted transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Start a new conversation</span>
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="p-2 rounded-lg text-ink-muted hover:bg-surface-muted transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Close the Copilot</span>
          </button>
        </div>
      </header>

      {pageContext.label && (
        <div className="px-4 py-2 shrink-0 border-b border-border bg-surface-muted/60">
          <p className="text-[11px] text-ink-muted truncate">
            Asking about <span className="font-semibold text-ink">{pageContext.label}</span>
          </p>
        </div>
      )}

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        // Answers arrive asynchronously, so the log is a live region. `polite`
        // rather than `assertive`: a screen reader user typing a follow-up
        // should not be interrupted mid-sentence.
        aria-live="polite"
        aria-atomic="false"
      >
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted leading-relaxed">
              Ask about products, parties, shipments, documents, exceptions and filing readiness in
              this account. Answers come from your Qubere records, and the Copilot says so when
              something is not recorded.
            </p>
            <div className="space-y-1.5">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void ask(starter)}
                  disabled={pending}
                  className="w-full text-left text-xs px-3 py-2 rounded-xl border border-border bg-surface-muted/60 hover:bg-surface-muted text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {starter}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-muted leading-relaxed">
              The Copilot reads and explains. It cannot classify, determine origin, approve, edit or
              file — those stay in their own Qubere workflows.
            </p>
          </div>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] text-xs leading-relaxed bg-brand text-white rounded-2xl rounded-br-sm px-3 py-2 whitespace-pre-wrap break-words">
                {turn.content}
              </p>
            </div>
          ) : (
            <div key={turn.id} className="border border-border rounded-2xl rounded-bl-sm px-3 py-3">
              {turn.answer ? (
                <CopilotAnswerView answer={turn.answer} conversationId={conversationId} />
              ) : (
                <p className="text-xs text-ink">{turn.content}</p>
              )}
            </div>
          )
        )}

        {pending && (
          <p className="flex items-center gap-2 text-xs text-ink-muted" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Checking your Qubere records…
          </p>
        )}

        {transportError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {transportError}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3 space-y-2">
        <label htmlFor="copilot-composer" className="sr-only">
          Ask the Qubere AI Copilot
        </label>
        <textarea
          id="copilot-composer"
          ref={composerRef}
          rows={2}
          value={draft}
          maxLength={MAX_QUESTION_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. `isComposing` is checked
            // so an IME candidate selection is not read as a send.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about this account's records…"
          className="w-full resize-none text-xs rounded-xl border border-border px-3 py-2 text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-ink-muted">Enter to send · Shift+Enter for a new line</p>
          <Button size="sm" onClick={submit} loading={pending} disabled={draft.trim() === ""}>
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
