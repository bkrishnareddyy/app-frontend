import { db } from "./src/lib/db";

async function main() {
  const emails = ["admin.acme@qubere.ai", "owner.acme@qubere.ai", "bob@qubere.ai"];
  for (const email of emails) {
    const user = await db.user.findFirst({
      where: { email },
      include: { memberships: { include: { account: true } } },
    });
    if (!user) {
      console.log(email, "-> NOT FOUND as a User row");
      continue;
    }
    console.log(email, "-> User", user.id, "memberships:", user.memberships.map(m => ({ account: m.account.name, type: m.account.type })));
  }

  const bob = await db.account.findFirst({ where: { name: { contains: "Bob" } } });
  console.log("Bob's Workspace account:", bob);
}

main().finally(() => db.$disconnect());
