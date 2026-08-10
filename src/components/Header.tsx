"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
import { Building2, Globe, Bot, Settings2, Building, Users, ShieldCheck, Contact2, Shield, LogOut, UserCog } from "lucide-react";
import { ManageAccountModal } from "./ManageAccountModal";
import { useLanguage } from "@/lib/i18n/LanguageContext";

interface HeaderProps {
  tenantName?: string;
  userName?: string;
  isPlatformAdmin?: boolean;
}

export function Header({ tenantName = "Acme Corporation", userName = "User", isPlatformAdmin = false }: HeaderProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isManageAccountOpen, setIsManageAccountOpen] = useState(false);

  const manageAccountItems = [
    { name: t.nav.accountProfile, href: "/app/admin", icon: Building, description: "Company details & preferences" },
    { name: t.nav.userManagement, href: "/app/admin/users", icon: Users, description: "Members, roles & invitations" },
    { name: t.nav.rolesPermissions, href: "/app/admin/roles", icon: ShieldCheck, description: "Role definitions & permission grants" },
    { name: t.nav.settingsAudit, href: "/app/admin/settings", icon: Settings2, description: "Configuration & audit log" },
    { name: t.nav.clients, href: "/app/clients", icon: Contact2, description: "Manage your customer portfolio" },
    ...(isPlatformAdmin
      ? [{ name: "Qubere Console", href: "/platform-admin", icon: Shield, description: "Platform admin tools" }]
      : []),
  ];

  const menuActions = [
    { label: "Manage Account", icon: Settings2, onClick: () => setIsManageAccountOpen(true) },
    { label: "Profile & Security", icon: UserCog, onClick: () => openUserProfile() },
    { label: "Country / Language", icon: Globe, onClick: () => router.push("/app/admin") },
    { label: "AI Agents Roster & Testing", icon: Bot, onClick: () => router.push("/agents") },
  ];

  return (
    <header className="h-16 shrink-0 border-b border-[#E5E5EA] bg-[#F5F5F7]/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 z-30">
      <div className="flex items-center min-w-0">
        <div className="flex items-center space-x-2 text-[#86868B] text-sm font-medium min-w-0">
          <Building2 className="w-4 h-4 shrink-0 text-[#0071E3]" />
          <span className="text-[#1D1D1F] font-semibold truncate" title={tenantName}>
            {tenantName}
          </span>
          <span className="text-[#86868B] shrink-0">/</span>
          <span className="text-[#86868B] text-xs px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] font-medium shadow-2xs shrink-0 whitespace-nowrap">
            Account Isolated
          </span>
        </div>
      </div>

      <div className="relative flex items-center shrink-0">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="flex items-center space-x-2.5 pl-1 pr-2.5 py-1 rounded-full hover:bg-white/70 transition-colors cursor-pointer"
        >
          {user?.imageUrl ? (
            <img
              src={user.imageUrl}
              alt=""
              className="w-8 h-8 rounded-full border border-[#E5E5EA] shadow-xs object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="w-8 h-8 rounded-full border border-[#E5E5EA] shadow-xs bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center text-xs font-bold"
            >
              {userName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-xs font-semibold text-[#1D1D1F] hidden sm:inline">{userName}</span>
          <span className="sr-only sm:hidden">{userName}</span>
        </button>

        {isMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-[#E5E5EA] rounded-2xl shadow-lg z-20 overflow-hidden">
              <div className="p-4 border-b border-[#E5E5EA] flex items-center space-x-3">
                {user?.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    alt={userName}
                    className="w-10 h-10 rounded-full border border-[#E5E5EA] object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full border border-[#E5E5EA] bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center text-sm font-bold">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1D1D1F] truncate">{userName}</p>
                  <p className="text-xs text-[#86868B] truncate">
                    {user?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </div>

              <div className="p-1.5">
                {menuActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => {
                      setIsMenuOpen(false);
                      action.onClick();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] transition-colors cursor-pointer"
                  >
                    <action.icon className="w-4 h-4 text-[#0071E3]" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              <div className="p-1.5 border-t border-[#E5E5EA]">
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    signOut(() => router.push("/"));
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ManageAccountModal
        isOpen={isManageAccountOpen}
        onClose={() => setIsManageAccountOpen(false)}
        items={manageAccountItems}
      />
    </header>
  );
}
