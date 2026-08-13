import { db } from "../src/lib/db";

async function main() {
  const adminUserId = "cmsjsm4ea0001l804eczfy2ff";
  console.log(`Checking chat sessions for Admin user: ${adminUserId}...`);
  const sessions = await db.assistantChatSession.findMany({
    where: { userId: adminUserId },
    include: { account: true },
  });

  console.log(`Found ${sessions.length} sessions for admin.`);
  for (const s of sessions) {
    console.log(`\n========================================`);
    console.log(`Session ID: ${s.id}`);
    console.log(`Title: "${s.title}"`);
    console.log(`Account: ${s.account.name}`);
    console.log(`Messages:\n`, JSON.stringify(s.messages, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
