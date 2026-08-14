"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { usePolling } from "@/lib/hooks/usePolling";

interface NotificationItem {
  id: string;
  message: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

/** Where a notification's row should link, given what created it. */
function notificationHref(n: NotificationItem): string {
  if (n.entityType === "InboundEmail" || n.entityType === "ShipmentDocument") return "/app/documents";
  return "/app/documents";
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      // Silent -- a failed poll just tries again next interval.
    }
  }, []);

  usePolling(fetchNotifications, POLL_INTERVAL_MS);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setIsOpen((prev) => !prev);
  };

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      // Best-effort; next poll reconciles state either way.
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Best-effort; next poll reconciles state either way.
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="relative p-2 rounded-full hover:bg-surface-muted transition-colors cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-ink-muted" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen &&
        menuPosition &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-50 w-80 bg-white rounded-2xl border border-border shadow-2xl overflow-hidden"
            style={{ top: menuPosition.top, right: menuPosition.right }}
          >
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-bold text-ink">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs font-semibold text-brand hover:underline cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-ink-muted">No notifications yet.</div>
              ) : (
                notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={notificationHref(n)}
                    onClick={() => {
                      if (!n.read) markRead(n.id);
                      setIsOpen(false);
                    }}
                    className={`block p-3 border-b border-border last:border-b-0 hover:bg-surface-muted transition-colors ${
                      n.read ? "" : "bg-blue-50/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs text-ink font-medium">{n.message}</p>
                        <p className="text-[10px] text-ink-muted mt-0.5">{formatDate(n.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
