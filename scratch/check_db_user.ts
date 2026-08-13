import { db } from "../src/lib/db";

async function main() {
  console.log("Querying database user with email 'admin@qubere.ai'...");
  const user = await db.user.findFirst({
    where: { email: "admin@qubere.ai" },
    include: {
      platformRoles: {
        include: { platformRole: true },
      },
      memberships: {
        include: {
          account: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    console.log("No user found with email 'admin@qubere.ai'");
    return;
  }

  console.log("User details:", JSON.stringify(user, null, 2));
}

main()
  .catch((err) => {
    console.error("Failed to query db:", err);
  })
  .finally(async () => {
    await db.$disconnect();
  });
