"use client";

import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Building2, Globe, Bot } from "lucide-react";

interface HeaderProps {
  tenantName?: string;
  userName?: string;
}

export function Header({ tenantName = "Acme Corporation", userName = "User" }: HeaderProps) {
  const router = useRouter();

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
        <button
          onClick={() => router.push("/app/admin")}
          className="text-right hidden sm:block hover:opacity-80 transition-opacity cursor-pointer group"
          title="Click to view Account Profile & Language settings"
        >
          <p className="text-xs font-semibold text-[#1D1D1F] group-hover:text-[#0071E3] flex items-center justify-end space-x-1">
            <span>{userName}</span>
            <Globe className="w-3 h-3 text-[#0071E3] inline-block" />
          </p>
          <p className="text-[10px] text-[#86868B]">Account Profile & Language</p>
        </button>

        <UserButton
          appearance={{
            elements: {
              avatarBox: "w-9 h-9 border border-[#E5E5EA] shadow-xs cursor-pointer",
            },
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Action
              label="AI Agents Roster & Testing"
              labelIcon={<Bot className="w-4 h-4 text-[#0071E3]" />}
              onClick={() => router.push("/agents")}
            />
            <UserButton.Action
              label="Account Profile & Country/Language"
              labelIcon={<Globe className="w-4 h-4 text-[#0071E3]" />}
              onClick={() => router.push("/app/admin")}
            />
          </UserButton.MenuItems>
        </UserButton>
      </div>
    </header>
  );
}
