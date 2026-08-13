import { db } from "../src/lib/db";

async function main() {
  console.log("Querying AssistantChatSession records...");
  const sessions = await db.assistantChatSession.findMany({
    include: {
      account: true,
    },
  });

  console.log(`Found ${sessions.length} sessions.`);
  for (const s of sessions) {
    console.log(`Session ID: ${s.id}`);
    console.log(`User ID: ${s.userId}`);
    console.log(`Account: ${s.account.name}`);
    console.log(`Title: ${s.title}`);
    console.log(`Messages:`, JSON.stringify(s.messages));
    console.log(`History:`, JSON.stringify(s.history));
    console.log("------------------------");
  }
}

main()
  .catch((err) => {
    console.error("Failed to query db:", err);
  })
  .finally(async () => {
    await db.$disconnect();
  });
