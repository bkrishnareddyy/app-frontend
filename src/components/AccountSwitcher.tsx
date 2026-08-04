"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, User } from "lucide-react";

interface AccountSwitcherProps {
  currentAccountId: string;
  currentAccountName: string;
  currentAccountType: string;
  currentRoleName: string;
  memberships: Array<{
    accountId: string;
    accountName: string;
    accountType: string;
    roleName: string;
  }>;
}

export function AccountSwitcher({
  currentAccountId,
  currentAccountName,
  currentAccountType,
  currentRoleName,
  memberships,
}: AccountSwitcherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loadingAccountId, setLoadingAccountId] = useState<string | null>(null);

  const handleSwitchAccount = async (targetAccountId: string) => {
    if (targetAccountId === currentAccountId) {
      setIsOpen(false);
      return;
    }

    setLoadingAccountId(targetAccountId);
    try {
      const res = await fetch("/api/auth/switch-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAccountId }),
      });

      if (res.ok) {
        setIsOpen(false);
        router.refresh();
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to switch account:", err);
    } finally {
      setLoadingAccountId(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2.5 bg-white border border-[#E5E5EA] rounded-2xl flex items-center justify-between hover:border-[#0071E3]/50 shadow-2xs transition-all text-left"
      >
        <div className="flex items-center space-x-3 overflow-hidden">
          <div
            className={`w-7 h-7 rounded-xl font-bold text-xs flex items-center justify-center shrink-0 ${
              currentAccountType === "ENTERPRISE"
                ? "bg-blue-50 text-[#0071E3] border border-blue-100"
                : "bg-purple-50 text-purple-600 border border-purple-100"
            }`}
          >
            {currentAccountName.slice(0, 2).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="text-xs font-bold text-[#1D1D1F] truncate">{currentAccountName}</p>
            <div className="flex items-center space-x-1.5 mt-0.5">
              <span className="text-[10px] text-[#86868B] font-mono uppercase">{currentAccountType}</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-50 text-[#0071E3] font-semibold border border-blue-100">
                {currentRoleName}
              </span>
            </div>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#86868B] shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 w-full mt-2 bg-white border border-[#E5E5EA] rounded-2xl shadow-xl z-50 p-2 space-y-1">
          <p className="px-2 py-1 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
            Your Accounts ({memberships.length})
          </p>
          {memberships.map((m) => {
            const isSelected = m.accountId === currentAccountId;
            return (
              <button
                key={m.accountId}
                onClick={() => handleSwitchAccount(m.accountId)}
                disabled={loadingAccountId === m.accountId}
                className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                  isSelected ? "bg-blue-50 text-[#0071E3] font-bold" : "text-[#1D1D1F] hover:bg-slate-50"
                }`}
              >
                <div className="truncate flex items-center space-x-2">
                  {m.accountType === "ENTERPRISE" ? (
                    <Building2 className="w-3.5 h-3.5 text-[#0071E3]" />
                  ) : (
                    <User className="w-3.5 h-3.5 text-purple-600" />
                  )}
                  <span className="truncate">{m.accountName}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
