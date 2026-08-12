import { getAccountContext } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { copilotEnabled } from "@/modules/copilot/copilotConfig";
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
    // The Copilot provider wraps the shell so the launcher in the header and the
    // panel share one conversation, and so a detail page can register what it is
    // showing without the panel having to be mounted inside it. `enabled` is
    // read here, on the server where COPILOT_ENABLED lives; the ask route
    // enforces the same flag for itself.
    <CopilotProvider enabled={copilotEnabled()}>
      <div className="min-h-screen bg-surface-muted text-ink flex selection:bg-brand/20 selection:text-brand">
        {/* Sidebar Navigation */}
        <Sidebar
          currentAccountId={context.accountId}
          accountName={context.accountName}
          accountType={context.accountType}
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

        {/* Dismissed by default, and rendered last so it overlays without
            reflowing the page underneath it. */}
        <CopilotPanel />
      </div>
    </CopilotProvider>
  );
}
