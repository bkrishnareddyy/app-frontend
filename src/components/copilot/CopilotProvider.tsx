"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GLOBAL_PAGE_CONTEXT,
  type CopilotAnswer,
  type CopilotHistoryTurn,
  type CopilotPageContext,
} from "@/modules/copilot/copilotContract";

/**
 * Conversation state for the Copilot panel.
 *
 * The conversation lives here, in the open tab, and not in a new database table.
 * That is a deliberate choice for the first release: a Copilot turn is a reading
 * of records that are themselves durable and audited, so the transcript adds
 * little that the audit trail does not already have, and storing it would mean a
 * second copy of the account's data with its own retention question. Each turn
 * replays the prior ones, and the server re-bounds and re-validates them.
 *
 * The provider also owns page context. Detail pages register what the user is
 * looking at via `useRegisterCopilotContext`; the panel sends it as a hint, and
 * the server resolves it against the account before believing any of it.
 */

interface CopilotTurn {
  id: string;
  role: "user" | "assistant";
  /** Prose for both roles. Assistant turns also carry the structured answer. */
  content: string;
  answer?: CopilotAnswer;
}

interface CopilotState {
  /**
   * Whether the deployment has the Copilot switched on. The launcher and panel
   * read it to render nothing; the server checks the same flag independently,
   * because a hidden button is not a switch.
   */
  enabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  turns: CopilotTurn[];
  pending: boolean;
  /** Set when the request itself failed, as distinct from an ERROR answer. */
  transportError: string | null;
  ask: (question: string) => Promise<void>;
  reset: () => void;
  pageContext: CopilotPageContext;
  setPageContext: (context: CopilotPageContext | null) => void;
  /** Correlation label for this conversation, echoed on navigation audit. */
  conversationId: string;
}

const CopilotContext = createContext<CopilotState | null>(null);

/** History sent to the server. Bounded again there; this is just courtesy. */
const CLIENT_HISTORY_LIMIT = 12;

function turnId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function CopilotProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [pageContext, setPageContextState] = useState<CopilotPageContext>(GLOBAL_PAGE_CONTEXT);

  // One id per conversation, so audit entries for the same conversation can be
  // read together. It is a correlation label; the server never trusts it.
  const [conversationId, setConversationId] = useState<string>(turnId);

  // Guards a double submit: Enter arriving twice, or a click landing while the
  // previous request is still open. `pending` cannot do this job — a state
  // update is not visible to the handler that just fired.
  const inFlight = useRef(false);

  const setPageContext = useCallback((next: CopilotPageContext | null) => {
    setPageContextState(next ?? GLOBAL_PAGE_CONTEXT);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || inFlight.current) return;

      inFlight.current = true;
      setPending(true);
      setTransportError(null);

      const history: CopilotHistoryTurn[] = turns
        .slice(-CLIENT_HISTORY_LIMIT)
        .map((turn) => ({ role: turn.role, content: turn.content }));

      setTurns((current) => [...current, { id: turnId(), role: "user", content: trimmed }]);

      try {
        const response = await fetch("/api/copilot/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            conversationId,
            context: pageContext,
            history,
          }),
        });

        // 429 carries a real answer envelope explaining the quota, so it falls
        // through to the normal path and lands in the conversation. Every other
        // failure status has no envelope to render.
        if (!response.ok && response.status !== 429) {
          setTransportError(
            response.status === 401
              ? "Your session has expired. Sign in again to continue."
              : "The Copilot could not be reached. The Qubere screens are unaffected."
          );
          return;
        }

        const payload: { answer?: CopilotAnswer } = await response.json();
        const answer = payload.answer;
        if (!answer) {
          setTransportError("The Copilot returned an unreadable response.");
          return;
        }

        setTurns((current) => [
          ...current,
          { id: turnId(), role: "assistant", content: answer.answer, answer },
        ]);
      } catch {
        setTransportError(
          "The Copilot could not be reached. Check your connection and try again."
        );
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [turns, pageContext, conversationId]
  );

  const reset = useCallback(() => {
    setTurns([]);
    setTransportError(null);
    // A new conversation, not a cleared one: the audit trail for what was asked
    // before stays attached to the id it was asked under.
    setConversationId(turnId());
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);

  const value = useMemo<CopilotState>(
    () => ({
      enabled,
      isOpen,
      open,
      close,
      toggle,
      turns,
      pending,
      transportError,
      ask,
      reset,
      pageContext,
      setPageContext,
      conversationId,
    }),
    [
      enabled,
      isOpen,
      open,
      close,
      toggle,
      turns,
      pending,
      transportError,
      ask,
      reset,
      pageContext,
      setPageContext,
      conversationId,
    ]
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot(): CopilotState {
  const state = useContext(CopilotContext);
  if (!state) throw new Error("useCopilot must be used inside CopilotProvider");
  return state;
}

/**
 * Registers what the current page is about, and clears it on unmount so a
 * stale context cannot follow the user to the next screen.
 *
 * Only the type and the id matter. The label is display-only — the server sends
 * the model the name the database holds, never the one the page passed.
 */
export function useRegisterCopilotContext(context: CopilotPageContext): void {
  const { setPageContext } = useCopilot();
  const { page, entityType, entityId, label } = context;

  useEffect(() => {
    setPageContext({ page, entityType, entityId, label });
    return () => setPageContext(null);
  }, [setPageContext, page, entityType, entityId, label]);
}
