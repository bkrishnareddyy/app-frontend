import { db } from "../src/lib/db";

async function main() {
  console.log("Querying database user with email 'rachit@qubere.ai'...");
  const user = await db.user.findFirst({
    where: { email: "rachit@qubere.ai" },
    include: {
      platformRoles: {
        include: { platformRole: true },
      },
      memberships: {
        include: {
          account: true,
          roles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: { permission: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    console.log("No user found with email 'rachit@qubere.ai'");
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
