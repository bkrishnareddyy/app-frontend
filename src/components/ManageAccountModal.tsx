"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountProfilePanel, type AccountSummary } from "@/app/app/admin/AccountProfilePanel";
import { UserManagementPanel } from "@/app/app/admin/users/UserManagementPanel";
import { type MemberItem } from "@/app/app/admin/users/UserManagementTable";
import { RolesPermissionsPanel } from "@/app/app/admin/roles/RolesPermissionsPanel";
import { SettingsAuditPanel } from "@/app/app/admin/settings/SettingsAuditPanel";
import { ClientsPanel } from "@/app/app/clients/ClientsPanel";
import type { RolesPermissionsData } from "@/lib/admin/rolesData";
import type { FormattedAuditLog } from "@/lib/admin/auditData";
import type { FormattedClient } from "@/lib/clients/clientsData";

export type PanelItemId = "account" | "users" | "roles" | "settings" | "clients";

interface AccountApiResponse {
  accountName: string;
  account: AccountSummary;
  userRole: string;
}

interface UsersApiResponse {
  accountName: string;
  members: MemberItem[];
  currentUserId: string;
  availableRoles: string[];
}

interface RolesApiResponse extends RolesPermissionsData {
  accountName: string;
}

interface SettingsApiResponse {
  accountName: string;
  auditLogs: FormattedAuditLog[];
}

interface ClientsApiResponse {
  accountName: string;
  clients: FormattedClient[];
}

type PanelApiResponse =
  | AccountApiResponse
  | UsersApiResponse
  | RolesApiResponse
  | SettingsApiResponse
  | ClientsApiResponse;

export interface ManageAccountPanelItem {
  id: PanelItemId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  endpoint: string;
}

export interface ManageAccountExternalItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface ManageAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountName: string;
  items: ManageAccountPanelItem[];
  externalItems?: ManageAccountExternalItem[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: PanelApiResponse };

function PanelSkeleton() {
  return (
    <div className="flex items-center justify-center h-full text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto space-y-3">
      <AlertCircle className="w-8 h-8 text-red-500" />
      <p className="text-sm text-ink font-semibold">Couldn&apos;t load this section</p>
      <p className="text-xs text-ink-muted">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 text-xs font-semibold text-brand bg-blue-50 hover:bg-blue-100 rounded-full transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}

export function ManageAccountModal({ isOpen, onClose, accountName, items, externalItems = [] }: ManageAccountModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [entries, setEntries] = useState<Record<string, LoadState>>({});
  const loadedIds = useRef<Set<string>>(new Set());

  // Reset the selected pane whenever the modal transitions to open.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSelectedIndex(0);
  }

  const fetchItem = useCallback(async (item: ManageAccountPanelItem) => {
    loadedIds.current.add(item.id);
    setEntries((prev) => ({ ...prev, [item.id]: { status: "loading" } }));

    try {
      const res = await fetch(item.endpoint, { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        loadedIds.current.delete(item.id);
        setEntries((prev) => ({
          ...prev,
          [item.id]: { status: "error", message: data.error || "Failed to load this section." },
        }));
        return;
      }

      setEntries((prev) => ({ ...prev, [item.id]: { status: "loaded", data } }));
    } catch {
      loadedIds.current.delete(item.id);
      setEntries((prev) => ({ ...prev, [item.id]: { status: "error", message: "Network error occurred." } }));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const item = items[selectedIndex];
    if (!item) return;
    if (!loadedIds.current.has(item.id)) {
      fetchItem(item);
    }
  }, [isOpen, selectedIndex, items, fetchItem]);

  if (!isOpen || typeof document === "undefined") return null;

  const selected = items[selectedIndex];
  const entry = selected ? entries[selected.id] : undefined;

  const renderPanel = () => {
    if (!selected) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-ink-muted">
          Nothing to manage here yet.
        </div>
      );
    }

    if (!entry || entry.status === "loading") return <PanelSkeleton />;
    if (entry.status === "error") {
      return <PanelError message={entry.message} onRetry={() => fetchItem(selected)} />;
    }

    const onSaved = () => fetchItem(selected);

    switch (selected.id) {
      case "account": {
        const data = entry.data as AccountApiResponse;
        return (
          <AccountProfilePanel
            accountName={data.accountName}
            account={data.account}
            userRole={data.userRole}
            onSaved={onSaved}
            compact
          />
        );
      }
      case "users": {
        const data = entry.data as UsersApiResponse;
        return (
          <UserManagementPanel
            accountName={data.accountName}
            members={data.members}
            currentUserId={data.currentUserId}
            availableRoles={data.availableRoles}
            onSaved={onSaved}
            compact
          />
        );
      }
      case "roles": {
        const data = entry.data as RolesApiResponse;
        return (
          <RolesPermissionsPanel
            accountName={data.accountName}
            coverage={data.coverage}
            roles={data.roles}
            permissionCatalogue={data.permissionCatalogue}
            compact
          />
        );
      }
      case "settings": {
        const data = entry.data as SettingsApiResponse;
        return <SettingsAuditPanel accountName={data.accountName} auditLogs={data.auditLogs} compact />;
      }
      case "clients": {
        const data = entry.data as ClientsApiResponse;
        return <ClientsPanel accountName={data.accountName} clients={data.clients} onSaved={onSaved} compact />;
      }
      default:
        return null;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-border shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex text-sm">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Left nav rail */}
        <div className="w-52 shrink-0 bg-[#FAFAFA] border-r border-border p-3 flex flex-col overflow-y-auto">
          <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2 truncate" title={accountName}>
            {accountName}
          </p>
          <nav className="space-y-0.5">
            {items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedIndex(idx)}
                  title={item.description}
                  className={cn(
                    "w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-left text-[13px] font-medium transition-all cursor-pointer",
                    isSelected
                      ? "bg-white text-brand shadow-2xs border border-border"
                      : "text-ink hover:bg-white/60"
                  )}
                >
                  <Icon className={cn("w-3.5 h-3.5 shrink-0", isSelected ? "text-brand" : "text-ink-muted")} />
                  <span className="truncate">{item.name}</span>
                </button>
              );
            })}
          </nav>

          {externalItems.length > 0 && (
            <>
              <div className="border-t border-border my-2" />
              <nav className="space-y-0.5">
                {externalItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={onClose}
                      title={item.description}
                      className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-left text-[13px] font-medium text-ink hover:bg-white/60 transition-all cursor-pointer"
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-ink-muted" />
                      <span className="truncate flex-1">{item.name}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 text-ink-muted" />
                    </Link>
                  );
                })}
              </nav>
            </>
          )}
        </div>

        {/* Right content pane */}
        <div className="flex-1 overflow-y-auto p-6">{renderPanel()}</div>
      </div>
    </div>,
    document.body
  );
}
