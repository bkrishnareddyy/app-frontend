import { getAccountContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChatClient } from "./ChatClient";

export default async function ChatPage() {
  const ctx = await getAccountContext();
  if (!ctx) {
    redirect("/sign-in");
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

