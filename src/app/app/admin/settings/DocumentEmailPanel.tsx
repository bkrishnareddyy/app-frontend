"use client";

import { useState } from "react";
import { Mail, Copy, Check, Trash2, Plus } from "lucide-react";
import { PanelHeading } from "@/components/PanelHeading";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";

export interface TeamMemberOption {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface InboundSenderRouteRow {
  id: string;
  displaySenderEmail: string;
  status: string;
  createdAt: string;
  defaultAssignedToUser: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
}

interface DocumentEmailPanelProps {
  publicDocumentAddress: string;
  initialRoutes: InboundSenderRouteRow[];
  teamMembers: TeamMemberOption[];
  compact?: boolean;
}

function memberLabel(m: { email: string; firstName: string | null; lastName: string | null }): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return name ? `${name} (${m.email})` : m.email;
}

function statusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "warning";
  if (status === "REVOKED") return "danger";
  return "neutral";
}

export function DocumentEmailPanel({
  publicDocumentAddress,
  initialRoutes,
  teamMembers,
  compact,
}: DocumentEmailPanelProps) {
  const [routes, setRoutes] = useState(initialRoutes);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicDocumentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; the address is still
      // selectable as plain text, so this is not a hard failure.
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/inbound-senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), defaultAssignedToUserId: assigneeId || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to add sender.");
        return;
      }
      const assignee = teamMembers.find((m) => m.userId === assigneeId) ?? null;
      setRoutes((prev) => [
        {
          id: body.route.id,
          displaySenderEmail: body.route.displaySenderEmail,
          status: body.route.status,
          createdAt: body.route.createdAt,
          defaultAssignedToUser: assignee
            ? { id: assignee.userId, email: assignee.email, firstName: assignee.firstName, lastName: assignee.lastName }
            : null,
        },
        ...prev,
      ]);
      setEmail("");
      setAssigneeId("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    const res = await fetch(`/api/settings/inbound-senders/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRoutes((prev) => prev.map((r) => (r.id === id ? { ...r, status: "REVOKED" } : r)));
    }
  }

  return (
    <div className={compact ? "space-y-5" : "space-y-8 max-w-5xl mx-auto"}>
      <PanelHeading
        icon={Mail}
        badge="Document Ingestion"
        title="Document Email"
        subtitle="Route emailed trade documents into this organization's Trade Documents inbox."
        compact={compact}
      />

      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-3">
        <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Inbound address</span>
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono font-bold text-ink bg-surface-muted px-3 py-2 rounded-xl border border-border">
            {publicDocumentAddress}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-bold text-ink hover:bg-surface-muted transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          Documents emailed here are accepted only from addresses explicitly authorized below.
        </p>
      </div>

      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-ink">Authorized senders</h2>
        </div>

        <form onSubmit={handleAdd} className="p-4 border-b border-border bg-surface-muted/30 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Sender email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.com"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm"
            />
          </div>
          <div className="min-w-[220px]">
            <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">Default assignee</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm bg-white"
            >
              <option value="">Unassigned</option>
              {teamMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add sender
          </button>
        </form>
        {error && <div className="px-4 pt-3 text-xs text-red-600 font-medium">{error}</div>}

        {routes.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">No authorized senders yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {routes.map((route) => (
              <div key={route.id} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink font-mono">{route.displaySenderEmail}</span>
                    <Badge variant={statusVariant(route.status)}>{route.status}</Badge>
                  </div>
                  <p className="text-xs text-ink-muted">
                    Routes to{" "}
                    {route.defaultAssignedToUser ? memberLabel(route.defaultAssignedToUser) : "no default assignee"}
                    {" · "}Added {formatDate(route.createdAt)}
                  </p>
                </div>
                {route.status === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(route.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
