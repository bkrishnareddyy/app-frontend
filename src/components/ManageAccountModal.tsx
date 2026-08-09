"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountAdminItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface ManageAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: AccountAdminItem[];
}

export function ManageAccountModal({ isOpen, onClose, items }: ManageAccountModalProps) {
  const pathname = usePathname();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-[#E5E5EA] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-[#1D1D1F]">Manage Account</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="p-3 space-y-1">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center space-x-3 px-3 py-3 rounded-2xl transition-all",
                  isActive
                    ? "bg-[#0071E3]/10 text-[#0071E3]"
                    : "text-[#1D1D1F] hover:bg-[#F5F5F7]"
                )}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                    isActive ? "bg-[#0071E3]/10 text-[#0071E3]" : "bg-[#F5F5F7] text-[#86868B]"
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-[#86868B]">{item.description}</p>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
