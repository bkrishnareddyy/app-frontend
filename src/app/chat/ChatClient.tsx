"use client";

import { useState, useRef, useEffect, useCallback, createContext, useContext, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Content } from "@google/genai";
import {
  Send, Loader2, Sparkles, Plus, Trash2,
  LayoutDashboard, ListChecks, FileText, FileCheck2, Globe,
  Files, Package, Landmark, MessageSquare, ChevronRight,
  ChevronsLeft, ChevronsRight, Moon, Sun, Paperclip, X,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";

// ── Theme ─────────────────────────────────────────────────────────────────────

interface Theme {
  pageBg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  ink: string;
  inkMuted: string;
  brand: string;
  brandHover: string;
  activeItem: string;
}

const LIGHT: Theme = {
  pageBg: "#F5F5F7",
  surface: "#ffffff",
  surfaceHover: "#F5F5F7",
  border: "#E5E5EA",
  ink: "#1D1D1F",
  inkMuted: "#86868B",
  brand: "#0071E3",
  brandHover: "#0077ED",
  activeItem: "rgba(0,113,227,0.08)",
};

const DARK: Theme = {
  pageBg: "#000000",
  surface: "#1C1C1E",
  surfaceHover: "#2C2C2E",
  border: "#3A3A3C",
  ink: "#F5F5F7",
  inkMuted: "#8E8E93",
  brand: "#0A84FF",
  brandHover: "#409CFF",
  activeItem: "rgba(10,132,255,0.15)",
};

const ThemeCtx = createContext<Theme>(LIGHT);
const useTh = () => useContext(ThemeCtx);

// ── Pending upload context ───────────────────────────────────────────────────
// Lets a shipment row rendered deep inside a tool card (ShipRow) trigger the
// real upload for whatever file is currently attached in the composer,
// without threading the callback through every intermediate component.

interface PendingUploadState {
  pendingFile: File | null;
  onAttach: (shipmentId: string, shipmentNumber: string) => void;
}

const PendingUploadCtx = createContext<PendingUploadState>({ pendingFile: null, onAttach: () => {} });
const usePendingUpload = () => useContext(PendingUploadCtx);

/** Pulls the id out of a `/app/shipments/{id}` URL — the only place these tool results carry it. */
function extractShipmentId(url?: string | null): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/app\/shipments\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** First real (tool-verified) shipment number found as a substring of the text, case-insensitive. */
function findKnownShipmentInText(text?: string | null, known?: Map<string, string>): { number: string; id: string } | null {
  if (!text || typeof text !== "string" || !known) return null;
  const upper = text.toUpperCase();
  for (const [number, id] of known) {
    if (number && upper.includes(number.toUpperCase())) return { number, id };
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatClientProps {
  context: {
    firstName: string | null;
    accountName: string;
    accountId: string;
  };
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
  /** Name of a file the user attached alongside this message, if any (display only). */
  attachedFileName?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: MessageDisplay[];
  history: Content[];
  /** false until the first turn completes and the session is written to the DB. */
  persisted: boolean;
}

interface DbChatSession {
  id: string;
  title: string;
  messages: unknown;
  history: unknown;
  updatedAt: string;
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Dashboard", href: "/app/dashboard", Icon: LayoutDashboard },
  { label: "Actions", href: "/app/actions", Icon: ListChecks },
  { label: "Shipments", href: "/app/shipments", Icon: FileText },
  { label: "Customs Filing", href: "/app/filing", Icon: FileCheck2 },
  { label: "Regulatory", href: "/app/regulatory", Icon: Globe },
];

const TOOLING_ITEMS = [
  { label: "Trade Docs", href: "/app/documents", Icon: Files },
  { label: "Products", href: "/app/products", Icon: Package },
  { label: "Parties", href: "/app/parties", Icon: Landmark },
];

// ── Sample prompts ────────────────────────────────────────────────────────────

const SAMPLE_GROUPS = [
  {
    label: "Shipments",
    prompts: [
      "Which shipments are at risk?",
      "Which shipments are not assigned?",
      "Critical shipments for today?",
      "What is the $ amount at risk?",
    ],
  },
  {
    label: "Catalog & Docs",
    prompts: [
      "Search products for electronics",
      "Look up parties named ABC",
      "Find commercial invoices",
    ],
  },
  { label: "Team & Create", prompts: ["Who's on my team?", "Create a shipment"] },
];

// Height of the active-chat top bar (10px padding + 28px icon + 10px padding
// + 1px border) — the right panel's header spacer matches it so the two
// horizontal lines land on the same pixel.
const TOPBAR_HEIGHT = 49;

// Shown as the empty-state input's placeholder; Tab fills it into the box.
const SUGGESTED_PROMPT = "What are my high risk shipments?";

const QUICK_CHIPS = [
  "At-risk shipments",
  "Value at risk",
  "Who's on my team?",
  "Unassigned shipments",
  "Create a shipment",
];

// ── DB-backed persistence ────────────────────────────────────────────────────
// Only the 10 most-recently-updated sessions per user/account are kept — the
// server prunes on write (src/app/api/assistant/chats/route.ts). A brand new
// "+ New chat" session isn't written until its first turn completes, so
// idle empty sessions never count against that cap.

async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch("/api/assistant/chats");
    if (!res.ok) return [];
    const data = (await res.json()) as { sessions: DbChatSession[] };
    if (!Array.isArray(data?.sessions)) return [];
    // Server returns newest-first; keep the internal array oldest-first so the
    // active tab (last element) and the reversed display list stay consistent.
    return data.sessions
      .slice()
      .reverse()
      .map((s) => ({
        id: s.id,
        title: s.title ?? "Chat",
        createdAt: s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now(),
        messages: Array.isArray(s.messages)
          ? (s.messages as MessageDisplay[]).map((m) => ({
              ...m,
              toolCalls: Array.isArray(m?.toolCalls) ? m.toolCalls : [],
            }))
          : [],
        history: Array.isArray(s.history) ? (s.history as Content[]) : [],
        persisted: true,
      }));
  } catch (err) {
    console.error("Failed to fetch chat sessions:", err);
    return [];
  }
}

async function createSessionInDb(data: { title: string; messages: MessageDisplay[]; history: Content[] }): Promise<DbChatSession | null> {
  const res = await fetch("/api/assistant/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  const { session } = (await res.json()) as { session: DbChatSession };
  return session;
}

async function updateSessionInDb(id: string, data: { title: string; messages: MessageDisplay[]; history: Content[] }): Promise<void> {
  await fetch(`/api/assistant/chats/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => { /* best-effort */ });
}

async function deleteSessionInDb(id: string): Promise<void> {
  await fetch(`/api/assistant/chats/${id}`, { method: "DELETE" }).catch(() => { /* best-effort */ });
}

function freshSession(): ChatSession {
  return { id: `local-${crypto.randomUUID()}`, title: "New chat", createdAt: Date.now(), messages: [], history: [], persisted: false };
}

function relativeTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

const nextId = () => `m-${crypto.randomUUID()}`;

// ── Markdown ──────────────────────────────────────────────────────────────────
// Small hand-rolled renderer covering just what the assistant is instructed
// to produce: bold/inline-code spans, bullet lists, and GFM pipe tables
// (see the FORMATTING section of orchestrator.ts's system prompt).

function mdLine(text: string, inkMuted: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} style={{ background: inkMuted + "22", borderRadius: 4, padding: "0 4px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}

function isTableSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** True for cells that are purely numeric (or numeric-looking, e.g. "$1,200", "85%") — right-aligned with tabular figures. */
function isNumericCell(cell: string): boolean {
  return /^[$]?-?[\d,]+(\.\d+)?%?$/.test(cell.trim()) && /\d/.test(cell);
}

function MdTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const th = useTh();
  return (
    <div style={{ overflowX: "auto", margin: "6px 0 12px", border: `1px solid ${th.border}`, borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                textAlign: isNumericCell(h) ? "right" : "left", padding: "8px 12px", fontSize: 10.5, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.05em", color: th.inkMuted, background: th.pageBg,
                borderBottom: `1px solid ${th.border}`, whiteSpace: "nowrap",
              }}>
                {mdLine(h, th.inkMuted)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop: `1px solid ${th.border}` }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: "8px 12px", color: th.ink, textAlign: isNumericCell(cell) ? "right" : "left",
                  fontVariantNumeric: "tabular-nums", verticalAlign: "top",
                }}>
                  {mdLine(cell, th.inkMuted)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MdText({ text }: { text: string }) {
  const th = useTh();
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && isTableSeparatorRow(lines[i + 1] ?? "")) {
      const headers = splitTableRow(lines[i]);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && isTableRow(lines[j])) { rows.push(splitTableRow(lines[j])); j++; }
      blocks.push(<MdTable key={i} headers={headers} rows={rows} />);
      i = j;
      continue;
    }
    const line = lines[i];
    const isBullet = /^[*\-]\s+/.test(line);
    const content = isBullet ? line.replace(/^[*\-]\s+/, "") : line;
    if (isBullet) {
      blocks.push(
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          <span style={{ color: th.inkMuted, flexShrink: 0, marginTop: 2 }}>•</span>
          <span>{mdLine(content, th.inkMuted)}</span>
        </div>
      );
    } else if (!line.trim()) {
      blocks.push(<div key={i} style={{ height: 8 }} />);
    } else {
      blocks.push(<div key={i} style={{ marginBottom: 2 }}>{mdLine(content, th.inkMuted)}</div>);
    }
    i++;
  }
  return <div style={{ color: th.ink, fontSize: 14, lineHeight: 1.6 }}>{blocks}</div>;
}

// ── Left nav sidebar ──────────────────────────────────────────────────────────

function LeftNav({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const th = useTh();
  const w = expanded ? 192 : 56;

  return (
    <nav style={{ width: w, minWidth: w, background: th.surface, borderRight: `1px solid ${th.border}`, transition: "width 0.2s ease" }}
      className="hidden lg:flex flex-col h-full py-3 items-center gap-1 overflow-hidden">

      {/* Logo */}
      <Link href="/app/dashboard" target="_blank" rel="noopener noreferrer" title="Back to Qubere"
        style={{ background: th.brand, borderRadius: 12, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", marginBottom: 12, flexShrink: 0, transition: "background 0.15s" }}
        className="hover:opacity-90">
        <Sparkles style={{ width: 16, height: 16 }} />
      </Link>

      <div style={{ width: "80%", height: 1, background: th.border, marginBottom: 4 }} />

      {/* Operations */}
      {NAV_ITEMS.map(({ label, href, Icon }) => (
        <Link key={href} href={href} target="_blank" rel="noopener noreferrer" title={label}
          style={{ width: expanded ? "calc(100% - 16px)" : 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, padding: expanded ? "0 10px" : "0", justifyContent: expanded ? "flex-start" : "center", color: th.inkMuted, transition: "background 0.15s, color 0.15s, width 0.2s" }}
          className="hover:text-inherit">
          <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
          {expanded && <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>{label}</span>}
        </Link>
      ))}

      <div style={{ width: "80%", height: 1, background: th.border, margin: "4px 0" }} />

      {/* Tooling */}
      {TOOLING_ITEMS.map(({ label, href, Icon }) => (
        <Link key={href} href={href} target="_blank" rel="noopener noreferrer" title={label}
          style={{ width: expanded ? "calc(100% - 16px)" : 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, padding: expanded ? "0 10px" : "0", justifyContent: expanded ? "flex-start" : "center", color: th.inkMuted, transition: "background 0.15s, color 0.15s, width 0.2s" }}
          className="hover:text-inherit">
          <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
          {expanded && <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>{label}</span>}
        </Link>
      ))}

      {/* Active indicator */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%" }}>
        <div style={{ background: `${th.brand}18`, borderRadius: 12, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", color: th.brand }}>
          <MessageSquare style={{ width: 16, height: 16 }} />
        </div>
        {/* Expand/collapse toggle */}
        <button type="button" onClick={onToggle} title={expanded ? "Collapse" : "Expand"}
          style={{ background: "none", border: "none", cursor: "pointer", color: th.inkMuted, padding: 6, borderRadius: 8, display: "flex" }}>
          {expanded ? <ChevronsLeft style={{ width: 16, height: 16 }} /> : <ChevronsRight style={{ width: 16, height: 16 }} />}
        </button>
      </div>
    </nav>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

function RightPanel({
  sessions, activeId, onNew, onSwitch, onDelete, onSampleClick, isDark, onToggleDark,
}: {
  sessions: ChatSession[];
  activeId: string;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onSampleClick: (p: string) => void;
  isDark: boolean;
  onToggleDark: () => void;
}) {
  const th = useTh();
  return (
    <aside style={{ width: 256, minWidth: 256, background: th.surface, borderLeft: `1px solid ${th.border}` }}
      className="hidden xl:flex flex-col h-full">

      {/* Header spacer — aligns this panel's first divider with the center
          top bar's bottom border (see TOPBAR_HEIGHT). */}
      <div style={{ height: TOPBAR_HEIGHT, boxSizing: "border-box", borderBottom: `1px solid ${th.border}`, flexShrink: 0 }} />

      {/* Dark mode toggle */}
      <div style={{ padding: 12, borderBottom: `1px solid ${th.border}` }}>
        <button type="button" onClick={onToggleDark}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 10, border: `1px solid ${th.border}`, background: "none", cursor: "pointer", color: th.ink, fontSize: 13, fontWeight: 500 }}>
          {isDark
            ? <Sun style={{ width: 14, height: 14, color: th.brand }} />
            : <Moon style={{ width: 14, height: 14, color: th.inkMuted }} />}
          {isDark ? "Light mode" : "Dark mode"}
        </button>
      </div>

      {/* Sample questions */}
      <div style={{ padding: "12px 8px", borderBottom: `1px solid ${th.border}` }}>
        <div style={{ padding: "0 4px 4px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted }}>Try asking</div>
        {SAMPLE_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: th.inkMuted, padding: "0 8px", marginBottom: 2 }}>{group.label}</div>
            {group.prompts.map((p) => (
              <button key={p} type="button" onClick={() => onSampleClick(p)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, background: "none", border: "none", cursor: "pointer", textAlign: "left", color: th.inkMuted, fontSize: 12 }}
                className="hover:!bg-[var(--hover)]">
                <ChevronRight style={{ width: 12, height: 12, flexShrink: 0, opacity: 0.5 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* New chat */}
      <div style={{ padding: 12, borderBottom: `1px solid ${th.border}` }}>
        <button type="button" onClick={onNew}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 10, background: th.brand, border: "none", cursor: "pointer", color: "#fff", fontSize: 13, fontWeight: 500 }}>
          <Plus style={{ width: 16, height: 16 }} />
          New chat
        </button>
      </div>

      {/* History — bottom, scrollable */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "12px 12px 4px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted }}>Recent</div>
        <div style={{ padding: "0 8px 8px" }}>
          {[...sessions].reverse().map((s) => {
            const isActive = s.id === activeId;
            return (
              <div key={s.id} role="button" tabIndex={0}
                onClick={() => onSwitch(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSwitch(s.id); }}
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "8px", borderRadius: 8,
                  background: isActive ? th.activeItem : "none", cursor: "pointer", textAlign: "left",
                }}
                className="group">
                <MessageSquare style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0, color: th.inkMuted }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: th.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                  <div style={{ fontSize: 10, color: th.inkMuted }}>{relativeTime(s.createdAt)}</div>
                </div>
                <button type="button" onClick={(e) => onDelete(s.id, e)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: th.inkMuted, padding: 2, borderRadius: 4, opacity: 0, flexShrink: 0 }}
                  className="group-hover:!opacity-100">
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ChatClient({ context }: ChatClientProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [navExpanded, setNavExpanded] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<Content[]>([]);
  // Real shipment numbers surfaced by tool results this session, mapped to their
  // id — the only source ever trusted to auto-resolve "attach to SHP-..." text.
  const knownShipmentsRef = useRef<Map<string, string>>(new Map());
  // True once the currently-attached file has been mentioned to the model —
  // prevents re-announcing the same [Attached file: ...] marker on every turn.
  const fileAnnouncedRef = useRef(false);

  const th = isDark ? DARK : LIGHT;

  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = activeSession?.messages ?? [];
  historyRef.current = activeSession?.history ?? [];
  const isEmpty = messages.length === 0;

  // Load sessions from the DB
  useEffect(() => {
    let cancelled = false;
    fetchSessions().then((loaded) => {
      if (cancelled) return;
      if (loaded.length > 0) { setSessions(loaded); setActiveId(loaded[loaded.length - 1].id); }
      else { const s = freshSession(); setSessions([s]); setActiveId(s.id); }
    });
    return () => { cancelled = true; };
  }, [context.accountId]);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const startNewChat = useCallback(() => {
    const s = freshSession();
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const switchSession = useCallback((id: string) => { setActiveId(id); setInput(""); }, []);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = sessions.find((s) => s.id === id);
    if (target?.persisted) deleteSessionInDb(id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) { const s = freshSession(); setActiveId(s.id); return [s]; }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  }, [activeId, sessions]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // If a file is attached and the user's own text names a shipment we've
    // already verified via a tool call this session, skip the back-and-forth
    // entirely and upload straight to it.
    if (pendingFile) {
      const match = findKnownShipmentInText(trimmed, knownShipmentsRef.current);
      if (match) {
        const file = pendingFile;
        setPendingFile(null);
        fileAnnouncedRef.current = false;
        setInput("");
        await performUpload(file, match.id, match.number, trimmed);
        return;
      }
    }

    setInput("");
    setSending(true);

    const uid = nextId();
    const aid = nextId();
    const sessionId = activeId;
    const wasPersisted = activeSession?.persisted ?? false;
    const priorMessages = activeSession?.messages ?? [];
    const title = priorMessages.length === 0 ? trimmed.slice(0, 50) : (activeSession?.title ?? "Chat");

    const announceFile = pendingFile !== null && !fileAnnouncedRef.current;
    if (announceFile) fileAnnouncedRef.current = true;
    const apiMessage = announceFile ? `[Attached file: "${pendingFile!.name}"] ${trimmed}` : trimmed;

    const userMsg: MessageDisplay = {
      id: uid, role: "user", text: trimmed, toolCalls: [],
      attachedFileName: announceFile ? pendingFile!.name : undefined,
    };
    // Tracked outside React state so the final turn can be persisted without
    // racing the async setSessions updates below.
    let asstMsg: MessageDisplay = { id: aid, role: "assistant", text: "", toolCalls: [] };
    let workingHistory: Content[] = activeSession?.history ?? [];

    setSessions((prev) => prev.map((s) =>
      s.id !== sessionId ? s : { ...s, title, messages: [...s.messages, userMsg, asstMsg] }
    ));

    const pushAsstUpdate = () => {
      setSessions((prev) => prev.map((s) =>
        s.id !== sessionId ? s : { ...s, messages: s.messages.map((m) => m.id === aid ? asstMsg : m) }
      ));
    };

    const rememberShipments = (ships: ShipmentRow[] | undefined) => {
      ships?.forEach((sp) => {
        const id = extractShipmentId(sp.url);
        if (id) knownShipmentsRef.current.set(sp.shipmentNumber, id);
      });
    };

    const apply = (ev: Record<string, unknown>) => {
      if (ev.type === "text") {
        asstMsg = { ...asstMsg, text: asstMsg.text + (ev.delta as string) };
      } else if (ev.type === "tool_call") {
        asstMsg = { ...asstMsg, toolCalls: [...asstMsg.toolCalls, { name: ev.name as string, status: "running" as const }] };
      } else if (ev.type === "tool_result") {
        const idx = [...asstMsg.toolCalls].reverse().findIndex((tc) => tc.name === (ev.name as string) && tc.status === "running");
        if (idx !== -1) {
          const real = asstMsg.toolCalls.length - 1 - idx;
          const tcs = [...asstMsg.toolCalls];
          tcs[real] = { ...tcs[real], status: "done", result: ev.result };
          asstMsg = { ...asstMsg, toolCalls: tcs };
        }
        const name = ev.name as string;
        const result = ev.result as Record<string, unknown>;
        if (name === "list_shipments" || name === "get_value_at_risk") {
          rememberShipments(result?.shipments as ShipmentRow[] | undefined);
        } else if (name === "create_shipment" && result?.success) {
          const id = extractShipmentId(result.url as string);
          if (id) knownShipmentsRef.current.set(result.shipmentNumber as string, id);
        }
      } else if (ev.type === "history") {
        workingHistory = ev.turns as Content[];
      } else if (ev.type === "error") {
        asstMsg = { ...asstMsg, text: asstMsg.text || `Error: ${ev.message}` };
      } else {
        return;
      }
      pushAsstUpdate();
    };

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: apiMessage, history: historyRef.current }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? `${res.status}`); }
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) { if (line.trim()) apply(JSON.parse(line)); }
      }
      if (buf.trim()) apply(JSON.parse(buf));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      asstMsg = { ...asstMsg, text: asstMsg.text || `Something went wrong: ${msg}` };
      pushAsstUpdate();
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }

    const finalMessages = [...priorMessages, userMsg, asstMsg];
    if (!wasPersisted) {
      const created = await createSessionInDb({ title, messages: finalMessages, history: workingHistory });
      if (created) {
        setSessions((prev) => prev.map((s) =>
          s.id !== sessionId ? s : { ...s, id: created.id, persisted: true, createdAt: new Date(created.updatedAt).getTime() }
        ));
        setActiveId((prev) => (prev === sessionId ? created.id : prev));
      }
    } else {
      await updateSessionInDb(sessionId, { title, messages: finalMessages, history: workingHistory });
    }
  }

  // ── Document upload ──────────────────────────────────────────────────────
  // Bypasses the Gemini tool-calling loop entirely: the model only ever helps
  // pick the shipment in text (see the FILE ATTACHMENTS section of the system
  // prompt). The actual multipart upload, and the poll that follows it, are
  // driven straight from the client against the real upload/processing routes.

  const PROCESSING_TERMINAL = new Set(["SUCCEEDED", "NEEDS_REVIEW", "FAILED"]);
  const PROCESSING_POLL_MS = 3000;
  const PROCESSING_MAX_POLLS = 40; // ~2 minutes

  async function performUpload(file: File, shipmentId: string, shipmentNumber: string, userText?: string) {
    const sessionId = activeId;
    const wasPersisted = activeSession?.persisted ?? false;
    const priorMessages = activeSession?.messages ?? [];
    const title = priorMessages.length === 0 ? `Upload: ${file.name}`.slice(0, 50) : (activeSession?.title ?? "Chat");
    const finalHistory = activeSession?.history ?? [];

    const uid = nextId();
    const aid = nextId();
    const userMsg: MessageDisplay = {
      id: uid, role: "user", text: userText ?? `Attach to ${shipmentNumber}`, toolCalls: [], attachedFileName: file.name,
    };
    let asstMsg: MessageDisplay = {
      id: aid, role: "assistant", text: "",
      toolCalls: [{ name: "upload_document", status: "running", result: { phase: "uploading", fileName: file.name, shipmentNumber } }],
    };

    setSessions((prev) => prev.map((s) =>
      s.id !== sessionId ? s : { ...s, title, messages: [...s.messages, userMsg, asstMsg] }
    ));
    const pushUpdate = () => {
      setSessions((prev) => prev.map((s) =>
        s.id !== sessionId ? s : { ...s, messages: s.messages.map((m) => m.id === aid ? asstMsg : m) }
      ));
    };
    const persistTurn = async () => {
      const finalMessages = [...priorMessages, userMsg, asstMsg];
      if (!wasPersisted) {
        const created = await createSessionInDb({ title, messages: finalMessages, history: finalHistory });
        if (created) {
          setSessions((prev) => prev.map((s) =>
            s.id !== sessionId ? s : { ...s, id: created.id, persisted: true, createdAt: new Date(created.updatedAt).getTime() }
          ));
          setActiveId((prev) => (prev === sessionId ? created.id : prev));
        }
      } else {
        await updateSessionInDb(sessionId, { title, messages: finalMessages, history: finalHistory });
      }
    };
    const fail = async (error: string) => {
      asstMsg = { ...asstMsg, toolCalls: [{ name: "upload_document", status: "done", result: { phase: "failed", fileName: file.name, shipmentNumber, error } }] };
      pushUpdate();
      await persistTurn();
    };

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("shipmentId", shipmentId);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { await fail(data?.message ?? data?.error ?? `Upload failed (${res.status})`); return; }

      const documentId = data.documentId as string;
      const docType = data.docType as string | null;

      asstMsg = { ...asstMsg, toolCalls: [{ name: "upload_document", status: "running", result: { phase: "processing", fileName: file.name, shipmentNumber, documentId, docType } }] };
      pushUpdate();

      let finalRun: { status: string; error?: { message?: string } | null } | null = null;
      for (let attempt = 0; attempt < PROCESSING_MAX_POLLS; attempt++) {
        await new Promise((r) => setTimeout(r, PROCESSING_POLL_MS));
        const pr = await fetch(`/api/documents/${documentId}/processing`);
        if (!pr.ok) continue;
        const pdata = await pr.json();
        const latest = (pdata.runs as { status: string; error?: { message?: string } | null }[] | undefined)?.[0];
        if (latest && PROCESSING_TERMINAL.has(latest.status)) { finalRun = latest; break; }
      }

      const shipmentUrl = `/app/shipments/${shipmentId}`;

      if (!finalRun) {
        asstMsg = {
          ...asstMsg,
          text: `Still processing "${file.name}" — this is taking longer than usual. Check the shipment in the app for the latest status.`,
          toolCalls: [{ name: "upload_document", status: "done", result: { phase: "timeout", fileName: file.name, shipmentNumber, documentId, docType, url: shipmentUrl } }],
        };
        pushUpdate();
        await persistTurn();
        return;
      }

      if (finalRun.status === "FAILED") {
        await fail(finalRun.error?.message ?? "Processing failed.");
        return;
      }

      // SUCCEEDED or NEEDS_REVIEW — pull the real extracted fields so the
      // summary states an actual count, never a guessed one.
      let fieldCount: number | null = null;
      try {
        const er = await fetch(`/api/documents/${documentId}/extractions`);
        if (er.ok) {
          const edata = await er.json();
          fieldCount = Array.isArray(edata.extractionFields) ? edata.extractionFields.length : null;
        }
      } catch { /* best-effort — omit the count rather than guess */ }

      const succeeded = finalRun.status === "SUCCEEDED";
      asstMsg = {
        ...asstMsg,
        text: succeeded
          ? `Processed "${file.name}" and attached it to ${shipmentNumber}.`
          : `Processed "${file.name}" and attached it to ${shipmentNumber} — flagged for review.`,
        toolCalls: [{
          name: "upload_document", status: "done",
          result: {
            phase: succeeded ? "succeeded" : "needs_review",
            fileName: file.name, shipmentNumber, documentId, docType, fieldCount, url: shipmentUrl,
          },
        }],
      };
      pushUpdate();
      await persistTurn();
    } catch (err) {
      await fail(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function handleAttachToShipment(shipmentId: string, shipmentNumber: string) {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    fileAnnouncedRef.current = false;
    void performUpload(file, shipmentId, shipmentNumber);
  }

  function handleFilePicked(file: File) {
    setPendingFile(file);
    fileAnnouncedRef.current = false;
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); return; }
    if (e.key === "Tab" && isEmpty && !input.trim()) { e.preventDefault(); setInput(SUGGESTED_PROMPT); }
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFilePicked(file);
  }

  return (
    <ThemeCtx.Provider value={th}>
    <PendingUploadCtx.Provider value={{ pendingFile, onAttach: handleAttachToShipment }}>
      <div style={{ display: "flex", height: "100vh", background: th.pageBg, overflow: "hidden" }}>

        {/* Left nav */}
        <LeftNav expanded={navExpanded} onToggle={() => setNavExpanded((v) => !v)} />

        {/* Center */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePicked(f); e.target.value = ""; }}
          />

          {dragActive && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center",
              background: isDark ? "rgba(10,132,255,0.12)" : "rgba(0,113,227,0.06)",
              border: `2px dashed ${th.brand}`, borderRadius: 12, margin: 8, pointerEvents: "none",
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: th.brand, fontSize: 14, fontWeight: 600 }}>
                <Paperclip style={{ width: 24, height: 24 }} />
                Drop file to attach
              </div>
            </div>
          )}

          {isEmpty ? (
            /* ── Empty: centered input ───────────────────────────────────── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
              <div style={{ width: "100%", maxWidth: 640 }}>
                {/* Greeting */}
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <h1 style={{ fontSize: 24, fontWeight: 600, color: th.ink, margin: 0 }}>
                    {context.firstName ? `Hi ${context.firstName} 👋` : "Ask Qubere"}
                  </h1>
                  <p style={{ fontSize: 14, color: th.inkMuted, margin: "6px 0 0" }}>
                    Ask about shipments, docs, products, or create new ones.
                  </p>
                </div>

                {/* Centered input card — no border, shadow only, so it floats on the page */}
                <div style={{ background: th.surface, borderRadius: 16, boxShadow: isDark ? "0 12px 40px rgba(0,0,0,0.5)" : "0 12px 32px rgba(0,0,0,0.10)", overflow: "hidden", marginBottom: 16 }}>
                  {pendingFile && <PendingFileChip file={pendingFile} onRemove={() => { setPendingFile(null); fileAnnouncedRef.current = false; }} />}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={pendingFile ? "Which shipment should this attach to?" : `${SUGGESTED_PROMPT}  (Tab to use)`}
                    rows={3}
                    style={{ width: "100%", resize: "none", padding: "16px 20px 8px", fontSize: 14, color: th.ink, background: "transparent", border: "none", outline: "none", fontFamily: "inherit" }}
                    disabled={sending}
                    autoFocus
                  />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach a document"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: th.inkMuted }}>
                        <Paperclip style={{ width: 16, height: 16 }} />
                      </button>
                      <span style={{ fontSize: 12, color: th.inkMuted }}>{context.accountName}</span>
                    </div>
                    <button type="button" onClick={() => sendMessage(input)}
                      disabled={sending || !input.trim()}
                      style={{ width: 32, height: 32, borderRadius: "50%", background: input.trim() ? th.brand : th.inkMuted + "44", border: "none", cursor: input.trim() ? "pointer" : "default", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}>
                      {sending ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <Send style={{ width: 14, height: 14 }} />}
                    </button>
                  </div>
                </div>

                {/* Quick chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                  {QUICK_CHIPS.map((p) => (
                    <button key={p} type="button" onClick={() => sendMessage(p)}
                      style={{ fontSize: 12, padding: "6px 14px", borderRadius: 999, background: th.surface, border: `1px solid ${th.border}`, color: th.ink, cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s, color 0.15s" }}>
                      {p}
                    </button>
                  ))}
                </div>

                <p style={{ textAlign: "center", fontSize: 12, color: th.inkMuted }}>Qubere can make mistakes. Please double-check responses.</p>
              </div>
            </div>
          ) : (
            /* ── Active chat ─────────────────────────────────────────────── */
            <>
              {/* Top bar */}
              <div style={{ height: TOPBAR_HEIGHT, boxSizing: "border-box", borderBottom: `1px solid ${th.border}`, background: th.surface, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: `${th.brand}18`, color: th.brand, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sparkles style={{ width: 14, height: 14 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: th.ink, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeSession?.title ?? "Ask Qubere"}</div>
                  <div style={{ fontSize: 11, color: th.inkMuted }}>{context.accountName}</div>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px" }}>
                <div style={{ maxWidth: 640, margin: "0 auto" }}>
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} onQuickReply={sendMessage} />
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Bottom input — sits on the page background (not a bordered
                  strip) so the card below appears to float, shadow only. */}
              <div style={{ background: th.pageBg, padding: "12px 16px 16px", flexShrink: 0 }}>
                <div style={{ maxWidth: 640, margin: "0 auto" }}>
                  <div style={{ background: th.surface, borderRadius: 16, boxShadow: isDark ? "0 12px 40px rgba(0,0,0,0.5)" : "0 12px 32px rgba(0,0,0,0.10)", overflow: "hidden" }}>
                    {pendingFile && <PendingFileChip file={pendingFile} onRemove={() => { setPendingFile(null); fileAnnouncedRef.current = false; }} />}
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKey}
                      placeholder={pendingFile ? "Which shipment should this attach to?" : "Write a message…"}
                      rows={1}
                      style={{ width: "100%", resize: "none", padding: "14px 20px 8px", fontSize: 14, color: th.ink, background: "transparent", border: "none", outline: "none", maxHeight: 160, fontFamily: "inherit" }}
                      disabled={sending}
                    />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach a document"
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: th.inkMuted }}>
                          <Paperclip style={{ width: 15, height: 15 }} />
                        </button>
                        <span style={{ fontSize: 11, color: th.inkMuted }}>Enter to send · Shift+Enter for new line</span>
                      </div>
                      <button type="button" onClick={() => sendMessage(input)}
                        disabled={sending || !input.trim()}
                        style={{ width: 32, height: 32, borderRadius: "50%", background: input.trim() ? th.brand : th.inkMuted + "44", border: "none", cursor: input.trim() ? "pointer" : "default", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}>
                        {sending ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <Send style={{ width: 14, height: 14 }} />}
                      </button>
                    </div>
                  </div>
                  <p style={{ textAlign: "center", fontSize: 11, color: th.inkMuted, marginTop: 8 }}>Qubere can make mistakes. Please double-check responses.</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        <RightPanel
          sessions={sessions}
          activeId={activeId}
          onNew={startNewChat}
          onSwitch={switchSession}
          onDelete={deleteSession}
          onSampleClick={sendMessage}
          isDark={isDark}
          onToggleDark={() => setIsDark((v) => !v)}
        />
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </PendingUploadCtx.Provider>
    </ThemeCtx.Provider>
  );
}

/** Filename/size pill shown above the composer while a file is attached, pending shipment resolution. */
function PendingFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const th = useTh();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 16px 0", padding: "6px 10px", borderRadius: 10, background: `${th.brand}12`, border: `1px solid ${th.brand}33` }}>
      <Paperclip style={{ width: 13, height: 13, color: th.brand, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: th.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
      <span style={{ fontSize: 11, color: th.inkMuted, flexShrink: 0 }}>{formatBytes(file.size)}</span>
      <button type="button" onClick={onRemove} title="Remove attachment"
        style={{ marginLeft: "auto", flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: th.inkMuted, padding: 2, display: "flex" }}>
        <X style={{ width: 13, height: 13 }} />
      </button>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message, onQuickReply }: { message: MessageDisplay; onQuickReply: (t: string) => void }) {
  const th = useTh();

  if (message.role === "user") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginBottom: 24 }}>
        {message.attachedFileName && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, padding: "5px 10px", borderRadius: 999, background: `${th.brand}18`, color: th.brand, fontSize: 12, fontWeight: 500 }}>
            <Paperclip style={{ width: 12, height: 12 }} />
            {message.attachedFileName}
          </div>
        )}
        <div style={{ background: th.brand, color: "#fff", borderRadius: "18px 18px 4px 18px", padding: "10px 16px", maxWidth: 480, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {message.text}
        </div>
      </div>
    );
  }

  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const isConfirmPending =
    message.text &&
    /shall i proceed|ready to create|confirm.*shipment|want me to create|go ahead/i.test(message.text) &&
    toolCalls.every((tc) => tc?.name !== "create_shipment");

  return (
    <div style={{ marginBottom: 24 }}>
      {toolCalls.map((tc, i) => <ToolCard key={i} tc={tc} />)}
      {message.text && <MdText text={message.text} />}
      {!message.text && toolCalls.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: th.inkMuted }}>
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Thinking…
        </div>
      )}
      {isConfirmPending && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => onQuickReply("Yes, create it")}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 999, background: th.brand, border: "none", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            Yes, create it
          </button>
          <button type="button" onClick={() => onQuickReply("Cancel")}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 999, background: "none", border: `1px solid ${th.border}`, color: th.ink, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tool cards ────────────────────────────────────────────────────────────────

type ShipmentRow = { shipmentNumber: string; importerName: string; assignedBroker: string | null; readinessScore: number | null; url: string };

/** Small, deliberately unobtrusive link at the bottom of a tool card — lets the
 * user jump into the app to verify or act on the data without competing with
 * the per-row links above it. */
function ViewInAppLink({ href, label }: { href: string; label: string }) {
  const th = useTh();
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer"
      style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: th.inkMuted, textDecoration: "none", opacity: 0.8 }}>
      View {label} in app →
    </Link>
  );
}

function ToolCard({ tc }: { tc: ToolCallDisplay }) {
  const th = useTh();

  // Handled separately: it has running sub-phases (uploading, processing) and
  // a done state with several outcomes, none of which fit the generic branches below.
  if (tc.name === "upload_document") {
    return <UploadDocumentCard tc={tc} />;
  }

  if (tc.status === "running") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: th.inkMuted, marginBottom: 8 }}>
        <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
        {toolLabel(tc.name)}…
      </div>
    );
  }

  const r = tc.result as Record<string, unknown>;

  if (tc.name === "list_shipments") {
    const ships = (r?.shipments as ShipmentRow[]) ?? [];
    const count = (r?.count as number) ?? 0;
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 12 }}>{count} shipment{count !== 1 ? "s" : ""}</p>
        {ships.length === 0 ? <p style={{ fontSize: 14, color: th.inkMuted }}>None found.</p>
          : <div>{ships.map((s) => <ShipRow key={s.shipmentNumber} s={s} />)}</div>}
        <ViewInAppLink href="/app/shipments" label="shipments" />
      </Card>
    );
  }

  if (tc.name === "get_value_at_risk") {
    const ships = (r?.shipments as ShipmentRow[]) ?? [];
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 4 }}>Value at risk</p>
        <p style={{ fontSize: 24, fontWeight: 700, color: th.ink, marginBottom: 12 }}>${Number(r?.totalValueAtRisk ?? 0).toLocaleString()}</p>
        <div>{ships.map((s) => <ShipRow key={s.shipmentNumber} s={s} />)}</div>
        <ViewInAppLink href="/app/shipments" label="shipments" />
      </Card>
    );
  }

  if (tc.name === "get_team_members") {
    const members = (r?.members as { userId: string; name: string; email: string }[]) ?? [];
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 12 }}>{r?.count as number ?? 0} team member{(r?.count as number) !== 1 ? "s" : ""}</p>
        <div>
          {members.map((m) => (
            <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: th.ink }}>{m.name}</span>
              <span style={{ fontSize: 12, color: th.inkMuted }}>{m.email}</span>
            </div>
          ))}
        </div>
        <ViewInAppLink href="/app/admin/users" label="team" />
      </Card>
    );
  }

  if (tc.name === "create_shipment") {
    if (!r?.success) return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: "#fca5a5" } as React.CSSProperties}>
        <Badge variant="danger">Failed to create</Badge>
        <p style={{ fontSize: 14, color: th.ink, marginTop: 8 }}>{(r?.error as string) ?? "Could not create the shipment."}</p>
      </Card>
    );
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: "#6ee7b7" } as React.CSSProperties}>
        <Badge variant="success">Shipment created</Badge>
        <p style={{ fontSize: 14, fontWeight: 600, color: th.ink, marginTop: 8 }}>{r.shipmentNumber as string}</p>
        <ViewInAppLink href={r.url as string} label="shipment" />
      </Card>
    );
  }

  if (tc.name === "search_products") {
    const products = (r?.products as { id: string; name: string; sku: string | null; status: string; url: string }[]) ?? [];
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 12 }}>
          {r?.total as number ?? 0} product{(r?.total as number) !== 1 ? "s" : ""}
        </p>
        {products.length === 0 ? <p style={{ fontSize: 14, color: th.inkMuted }}>No products found.</p>
          : products.map((p) => (
            <Link key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 8, border: `1px solid ${th.border}`, padding: "8px 12px", marginBottom: 8, textDecoration: "none" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: th.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                {p.sku && <div style={{ fontSize: 11, color: th.inkMuted }}>SKU {p.sku}</div>}
              </div>
              <Badge variant={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status}</Badge>
            </Link>
          ))}
        <ViewInAppLink href="/app/products" label="products" />
      </Card>
    );
  }

  if (tc.name === "search_parties") {
    const parties = (r?.parties as { id: string; name: string; code: string | null; roles: string[]; status: string; url: string }[]) ?? [];
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 12 }}>
          {r?.total as number ?? 0} part{(r?.total as number) !== 1 ? "ies" : "y"}
        </p>
        {parties.length === 0 ? <p style={{ fontSize: 14, color: th.inkMuted }}>No parties found.</p>
          : parties.map((p) => (
            <Link key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 8, border: `1px solid ${th.border}`, padding: "8px 12px", marginBottom: 8, textDecoration: "none" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: th.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                {p.code && <div style={{ fontSize: 11, color: th.inkMuted }}>{p.code}</div>}
              </div>
              <div style={{ display: "flex", gap: 4 }}>{(p.roles ?? []).slice(0, 2).map((role) => <Badge key={role} variant="neutral">{role}</Badge>)}</div>
            </Link>
          ))}
        <ViewInAppLink href="/app/parties" label="parties" />
      </Card>
    );
  }

  if (tc.name === "search_documents") {
    const docs = (r?.documents as { id: string; fileName: string; docType: string | null; status: string; shipmentNumber: string | null }[]) ?? [];
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: th.inkMuted, marginBottom: 12 }}>
          {r?.total as number ?? 0} document{(r?.total as number) !== 1 ? "s" : ""}
        </p>
        {docs.length === 0 ? <p style={{ fontSize: 14, color: th.inkMuted }}>No documents found.</p>
          : docs.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 8, border: `1px solid ${th.border}`, padding: "8px 12px", marginBottom: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: th.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fileName}</div>
                <div style={{ fontSize: 11, color: th.inkMuted }}>{d.docType ?? "Unknown type"}{d.shipmentNumber ? ` · ${d.shipmentNumber}` : ""}</div>
              </div>
              <Badge variant={d.status === "PROCESSED" ? "success" : "neutral"}>{d.status}</Badge>
            </div>
          ))}
        <ViewInAppLink href="/app/documents" label="documents" />
      </Card>
    );
  }

  return null;
}

interface UploadResult {
  phase?: string;
  fileName?: string;
  shipmentNumber?: string;
  documentId?: string;
  docType?: string | null;
  fieldCount?: number | null;
  error?: string;
  url?: string;
}

function UploadDocumentCard({ tc }: { tc: ToolCallDisplay }) {
  const th = useTh();
  const r = tc.result as UploadResult | undefined;
  const phase = r?.phase;

  if (tc.status === "running") {
    const label = phase === "processing" ? `Processing "${r?.fileName}"…` : `Uploading "${r?.fileName}"…`;
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite", color: th.brand, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: th.ink }}>{label}</span>
        </div>
        {r?.shipmentNumber && <div style={{ fontSize: 11, color: th.inkMuted, marginTop: 4 }}>Target: {r.shipmentNumber}</div>}
      </Card>
    );
  }

  if (phase === "failed") {
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: "#fca5a5" } as React.CSSProperties}>
        <Badge variant="danger">Upload failed</Badge>
        <p style={{ fontSize: 13, color: th.ink, marginTop: 8 }}>{r?.error ?? "Something went wrong."}</p>
      </Card>
    );
  }

  if (phase === "timeout") {
    return (
      <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: th.border } as React.CSSProperties}>
        <Badge variant="warning">Still processing</Badge>
        <p style={{ fontSize: 13, color: th.ink, marginTop: 8 }}>&quot;{r?.fileName}&quot; is taking longer than usual to process.</p>
        {r?.url && <ViewInAppLink href={r.url} label="shipment" />}
      </Card>
    );
  }

  const succeeded = phase === "succeeded";
  return (
    <Card className="p-4 mb-3" style={{ background: th.surface, borderColor: succeeded ? "#6ee7b7" : th.border } as React.CSSProperties}>
      <Badge variant={succeeded ? "success" : "warning"}>{succeeded ? "Processed" : "Needs review"}</Badge>
      <p style={{ fontSize: 14, fontWeight: 600, color: th.ink, marginTop: 8 }}>{r?.fileName}</p>
      <p style={{ fontSize: 12, color: th.inkMuted, marginTop: 2 }}>
        {r?.docType ? `${r.docType} · ` : ""}Attached to {r?.shipmentNumber}
        {typeof r?.fieldCount === "number" ? ` · ${r.fieldCount} field${r.fieldCount === 1 ? "" : "s"} extracted` : ""}
      </p>
      {r?.url && <ViewInAppLink href={r.url} label="shipment" />}
    </Card>
  );
}

function ShipRow({ s }: { s: ShipmentRow }) {
  const th = useTh();
  const { pendingFile, onAttach } = usePendingUpload();
  const shipmentId = extractShipmentId(s.url);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <Link href={s.url} target="_blank" rel="noopener noreferrer"
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 8, border: `1px solid ${th.border}`, padding: "8px 12px", textDecoration: "none" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: th.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.shipmentNumber}</div>
          <div style={{ fontSize: 11, color: th.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.importerName}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {s.assignedBroker
            ? <span style={{ fontSize: 12, color: th.inkMuted }}>{s.assignedBroker}</span>
            : <Badge variant="warning">Unassigned</Badge>}
          {typeof s.readinessScore === "number" && (
            <Badge variant={s.readinessScore < 85 ? "danger" : "success"}>{s.readinessScore}</Badge>
          )}
        </div>
      </Link>
      {pendingFile && shipmentId && (
        <button type="button" onClick={() => onAttach(shipmentId, s.shipmentNumber)}
          title={`Attach ${pendingFile.name} to ${s.shipmentNumber}`}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "8px 10px", borderRadius: 8, border: `1px solid ${th.brand}`, background: `${th.brand}12`, color: th.brand, cursor: "pointer" }}>
          <Paperclip style={{ width: 12, height: 12 }} />
          Attach
        </button>
      )}
    </div>
  );
}

function toolLabel(name: string): string {
  return ({
    list_shipments: "Looking up shipments",
    get_value_at_risk: "Calculating value at risk",
    get_team_members: "Looking up your team",
    create_shipment: "Creating shipment",
    search_products: "Searching products",
    search_parties: "Looking up parties",
    search_documents: "Searching documents",
    upload_document: "Uploading document",
  } as Record<string, string>)[name] ?? "Working";
}
