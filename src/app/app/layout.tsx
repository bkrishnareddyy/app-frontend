import { getAccountContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { DataModeBanner } from "@/components/DataModeBanner";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getAccountContext();

  if (!context) {
    redirect("/sign-in");
  }

  const displayName =
    context.firstName || context.lastName
      ? `${context.firstName ?? ""} ${context.lastName ?? ""}`.trim()
      : context.email;

  return (
    <div className="h-screen overflow-hidden bg-[#F5F5F7] text-[#1D1D1F] flex selection:bg-[#0071E3]/20 selection:text-[#0071E3]">
      {/* Sidebar Navigation */}
      <Sidebar
        currentAccountId={context.accountId}
        accountName={context.accountName}
        accountType={context.accountType}
        roleNames={context.roleNames}
        isPlatformAdmin={context.isPlatformAdmin}
        permissions={context.permissions}
        memberships={context.memberships}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <DataModeBanner dataMode={context.dataMode} />
        <Header tenantName={context.accountName} userName={displayName} />
        {/* min-h-0 lets this be the only scroll region; without it the shell grows and the window scrolls too. */}
        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
