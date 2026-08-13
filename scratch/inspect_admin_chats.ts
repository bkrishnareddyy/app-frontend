import { db } from "../src/lib/db";

async function main() {
  console.log("Checking all AssistantChatSession records in database...");
  const sessions = await db.assistantChatSession.findMany({
    include: {
      account: true,
    },
  });

  console.log(`Total sessions found in DB: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`- Session ID: ${s.id}, User ID: ${s.userId}, Account: ${s.account.name} (${s.accountId}), Title: "${s.title}"`);
    console.log(`  Messages count: ${Array.isArray(s.messages) ? s.messages.length : 0}`);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
