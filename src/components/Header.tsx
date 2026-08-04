"use client";

import { UserButton } from "@clerk/nextjs";
import { Building2 } from "lucide-react";

interface HeaderProps {
  tenantName?: string;
  userName?: string;
}

export function Header({ tenantName = "Acme Corporation", userName = "User" }: HeaderProps) {
  return (
    <header className="h-16 border-b border-[#E5E5EA] bg-[#F5F5F7]/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-[#86868B] text-sm font-medium">
          <Building2 className="w-4 h-4 text-[#0071E3]" />
          <span className="text-[#1D1D1F] font-semibold">{tenantName}</span>
          <span className="text-[#86868B]">/</span>
          <span className="text-[#86868B] text-xs px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] font-medium shadow-2xs">
            Account Isolated
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right hidden sm:block">
          <p className="text-xs font-semibold text-[#1D1D1F]">{userName}</p>
          <p className="text-[10px] text-[#86868B]">Authenticated Session</p>
        </div>
        <UserButton
          appearance={{
            elements: {
              avatarBox: "w-9 h-9 border border-[#E5E5EA] shadow-xs",
            },
          }}
        />
      </div>
    </header>
  );
}
