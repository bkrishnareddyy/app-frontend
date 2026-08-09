"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const selected = items[selectedIndex];
  const SelectedIcon = selected?.icon;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-[#E5E5EA] shadow-2xl w-full max-w-3xl h-[540px] overflow-hidden flex">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Left nav rail */}
        <div className="w-64 shrink-0 bg-[#FAFAFA] border-r border-[#E5E5EA] p-5 flex flex-col">
          <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-[#86868B] mb-3">
            Manage Account
          </p>
          <nav className="space-y-0.5">
            {items.map((item, idx) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;
              return (
                <button
                  key={item.name}
                  onClick={() => setSelectedIndex(idx)}
                  className={cn(
                    "w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-xl text-left text-sm font-medium transition-all cursor-pointer",
                    isSelected
                      ? "bg-white text-[#0071E3] shadow-2xs border border-[#E5E5EA]"
                      : "text-[#1D1D1F] hover:bg-white/60"
                  )}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", isSelected || isActive ? "text-[#0071E3]" : "text-[#86868B]")} />
                  <span className="truncate">{item.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right detail pane */}
        <div className="flex-1 p-8 flex flex-col justify-center">
          {selected && SelectedIcon && (
            <div className="max-w-sm">
              <div className="w-12 h-12 rounded-2xl bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center mb-5">
                <SelectedIcon className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-[#1D1D1F] mb-2">{selected.name}</h2>
              <p className="text-sm text-[#86868B] mb-6">{selected.description}</p>
              <Link
                href={selected.href}
                onClick={onClose}
                className="inline-flex items-center px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                Open {selected.name}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
