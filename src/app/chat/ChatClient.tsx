"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Content } from "@google/genai";
import { Send, Loader2, Sparkles, Plus } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";

interface ChatClientProps {
  context: { firstName: string | null; accountName: string };
}

interface ToolCallDisplay {
  name: string;
  status: "running" | "done";
  result?: unknown;
}

interface MessageDisplay {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCallDisplay[];
}

interface ShipmentSummary {
  shipmentNumber: string;
  importerName: string;
  assignedBroker: string | null;
  readinessScore: number | null;
  url: string;
}

const EXAMPLE_PROMPTS = [
  { label: "Shipments at risk", text: "Which shipments are at risk?" },
  { label: "Unassigned shipments", text: "Which shipments are not assigned to anyone?" },
  { label: "Critical today", text: "Which are the critical shipments for today?" },
  { label: "Value at risk", text: "What is the $ amount at risk?" },
  { label: "My team", text: "Who's on my team?" },
  { label: "Create a shipment", text: "Create a shipment" },
];

let messageIdCounter = 0;
function nextId() {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}`;
}

// Minimal markdown: **bold**, `code`, bullet lists
function mdLine(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="bg-surface-muted rounded px-1 font-mono text-xs">{p.slice(1, -1)}</code>;
    return p;
  });
}

function MdText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm text-ink leading-relaxed space-y-0.5">
      {lines.map((line, i) => {
        const isBullet = /^[*\-]\s+/.test(line);
        const content = isBullet ? line.replace(/^[*\-]\s+/, "") : line;
        if (isBullet) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-ink-muted shrink-0 mt-0.5">•</span>
              <span>{mdLine(content)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <div key={i}>{mdLine(content)}</div>;
      })}
    </div>
  );
}

export function ChatClient({ context }: ChatClientProps) {
  const [messages, setMessages] = useState<MessageDisplay[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const historyRef = useRef<Content[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: trimmed, toolCalls: [] }]);

    const assistantId = nextId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "", toolCalls: [] }]);

    const applyEvent = (event: Record<string, unknown>) => {
      if (event.type === "text") {
        const delta = event.delta as string;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
      } else if (event.type === "tool_call") {
        const name = event.name as string;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, toolCalls: [...m.toolCalls, { name, status: "running" as const }] } : m
          )
        );
      } else if (event.type === "tool_result") {
        const name = event.name as string;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const lastRunning = [...m.toolCalls].reverse().findIndex((tc) => tc.name === name && tc.status === "running");
            if (lastRunning === -1) return m;
            const realIdx = m.toolCalls.length - 1 - lastRunning;
            const toolCalls = [...m.toolCalls];
            toolCalls[realIdx] = { ...toolCalls[realIdx], status: "done", result: event.result };
            return { ...m, toolCalls };
          })
        );
      } else if (event.type === "history") {
        historyRef.current = event.turns as Content[];
      } else if (event.type === "error") {
        const message = event.message as string;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: m.text || `Something went wrong: ${message}` } : m))
        );
      }
    };

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: historyRef.current }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) applyEvent(JSON.parse(line));
        }
      }
      if (buffer.trim()) applyEvent(JSON.parse(buffer));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: m.text || `Something went wrong: ${message}` } : m))
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-screen bg-surface-muted">
      {/* Header */}
      <header className="border-b border-border bg-white px-6 py-3.5 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink text-sm leading-none">Ask Qubere</div>
          <div className="text-xs text-ink-muted mt-0.5 truncate">{context.accountName}</div>
        </div>
      </header>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* Empty state — centered like ChatGPT / Claude */
          <div className="flex flex-col items-center justify-center h-full px-6 pb-24 gap-8">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-semibold text-ink">
                {context.firstName ? `Hi ${context.firstName}` : "Ask Qubere"}
              </h1>
              <p className="text-ink-muted text-sm">
                Ask about shipments, your team, or create a new one.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => sendMessage(p.text)}
                  className="flex items-center gap-2 text-left text-xs px-3 py-2.5 rounded-xl border border-border bg-white hover:bg-surface-muted text-ink transition-colors group"
                >
                  {p.label === "Create a shipment" && (
                    <Plus className="w-3.5 h-3.5 text-brand shrink-0" />
                  )}
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 space-y-6 max-w-3xl mx-auto">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onQuickReply={sendMessage} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-white px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Ask Qubere… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 max-h-40"
            disabled={sending}
          />
          <Button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim()}
            loading={sending}
            className="shrink-0 mb-0.5"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-center text-xs text-ink-muted mt-2">
          Qubere can make mistakes. Verify critical information.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onQuickReply,
}: {
  message: MessageDisplay;
  onQuickReply: (text: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-brand text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-lg text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  const isConfirmationPending =
    message.text &&
    /shall i proceed|ready to create|confirm.*shipment|want me to create|go ahead/i.test(message.text) &&
    message.toolCalls.every((tc) => tc.name !== "create_shipment");

  return (
    <div className="space-y-3">
      {message.toolCalls.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      {message.text && <MdText text={message.text} />}
      {!message.text && message.toolCalls.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
        </div>
      )}
      {/* Quick-reply buttons when the assistant is asking for shipment confirmation */}
      {isConfirmationPending && (
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onQuickReply("Yes, create it")}
            className="text-xs px-3 py-1.5 rounded-full bg-brand text-white hover:bg-brand/90 transition-colors"
          >
            Yes, create it
          </button>
          <button
            type="button"
            onClick={() => onQuickReply("Cancel")}
            className="text-xs px-3 py-1.5 rounded-full border border-border bg-white text-ink hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  if (toolCall.status === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {toolLabel(toolCall.name)}…
      </div>
    );
  }

  const result = toolCall.result as Record<string, unknown>;

  if (toolCall.name === "list_shipments") {
    const shipments = (result?.shipments as ShipmentSummary[]) ?? [];
    const count = (result?.count as number) ?? 0;
    return (
      <Card className="p-4">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          {count} shipment{count === 1 ? "" : "s"}
        </div>
        {shipments.length === 0 ? (
          <div className="text-sm text-ink-muted">None found.</div>
        ) : (
          <div className="space-y-2">
            {shipments.map((s) => (
              <ShipmentRow key={s.shipmentNumber} shipment={s} />
            ))}
          </div>
        )}
      </Card>
    );
  }

  if (toolCall.name === "get_value_at_risk") {
    const shipments = (result?.shipments as ShipmentSummary[]) ?? [];
    return (
      <Card className="p-4">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">Value at risk</div>
        <div className="text-2xl font-bold text-ink mb-3">
          ${Number(result?.totalValueAtRisk ?? 0).toLocaleString()}
        </div>
        <div className="space-y-2">
          {shipments.map((s) => (
            <ShipmentRow key={s.shipmentNumber} shipment={s} />
          ))}
        </div>
      </Card>
    );
  }

  if (toolCall.name === "get_team_members") {
    const members = (result?.members as { userId: string; name: string; email: string }[]) ?? [];
    const count = (result?.count as number) ?? 0;
    return (
      <Card className="p-4">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          {count} team member{count === 1 ? "" : "s"}
        </div>
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm">
              <span className="text-ink font-medium">{m.name}</span>
              <span className="text-ink-muted text-xs">{m.email}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (toolCall.name === "create_shipment") {
    if (!result?.success) {
      return (
        <Card className="p-4 border-red-200 bg-red-50/30">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="danger">Failed to create</Badge>
          </div>
          <div className="text-sm text-ink">{(result?.error as string) ?? "Could not create the shipment."}</div>
        </Card>
      );
    }
    return (
      <Card className="p-4 border-emerald-200 bg-emerald-50/30">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="success">Shipment created</Badge>
        </div>
        <Link
          href={result.url as string}
          className="text-sm font-semibold text-brand hover:underline"
        >
          {result.shipmentNumber as string} — open in app →
        </Link>
      </Card>
    );
  }

  return null;
}

function ShipmentRow({ shipment }: { shipment: ShipmentSummary }) {
  return (
    <Link
      href={shipment.url}
      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:bg-surface-muted transition-colors text-sm"
    >
      <div className="min-w-0">
        <div className="font-medium text-ink truncate">{shipment.shipmentNumber}</div>
        <div className="text-xs text-ink-muted truncate">{shipment.importerName}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {shipment.assignedBroker ? (
          <span className="text-xs text-ink-muted">{shipment.assignedBroker}</span>
        ) : (
          <Badge variant="warning">Unassigned</Badge>
        )}
        {typeof shipment.readinessScore === "number" && (
          <Badge variant={shipment.readinessScore < 85 ? "danger" : "success"}>
            {shipment.readinessScore}
          </Badge>
        )}
      </div>
    </Link>
  );
}

function toolLabel(name: string): string {
  switch (name) {
    case "list_shipments": return "Looking up shipments";
    case "get_value_at_risk": return "Calculating value at risk";
    case "get_team_members": return "Looking up your team";
    case "create_shipment": return "Creating shipment";
    default: return "Working";
  }
}
