import { getAccountContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
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
    <div className="min-h-screen bg-surface-muted text-ink flex selection:bg-brand/20 selection:text-brand">
      {/* Sidebar Navigation */}
      <Sidebar
        currentAccountId={context.accountId}
        accountName={context.accountName}
        accountType={context.accountType}
        dataMode={context.dataMode}
        roleNames={context.roleNames}
        isPlatformAdmin={context.isPlatformAdmin}
        memberships={context.memberships}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          tenantName={context.accountName}
          userName={displayName}
          isPlatformAdmin={context.isPlatformAdmin}
          roleNames={context.roleNames}
        />
        <main className="flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
