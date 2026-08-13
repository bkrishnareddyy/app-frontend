import { getAccountContext } from "@/lib/auth";
import { ChatClient } from "./ChatClient";

export default async function ChatPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    return null;
  }

  return (
    <ChatClient
      context={{
        firstName: ctx.firstName ?? null,
        accountName: ctx.accountName,
        accountId: ctx.accountId,
      }}
    />
  );
}
