import { getAccountContext } from "@/lib/auth";
import { AccountProfilePanel } from "./AccountProfilePanel";

export default async function AdminAccountPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  return (
    <AccountProfilePanel
      accountName={context.accountName}
      account={{
        id: context.account.id,
        name: context.account.name,
        type: context.account.type,
        status: context.account.status,
        createdAt: context.account.createdAt.toISOString(),
      }}
      userRole={context.roleNames.join(", ")}
    />
  );
}
