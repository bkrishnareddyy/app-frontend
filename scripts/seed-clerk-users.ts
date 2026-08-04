import { createClerkClient } from "@clerk/backend";
import * as dotenv from "dotenv";

dotenv.config();

const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!clerkSecretKey || clerkSecretKey.startsWith("sk_test_mock")) {
  console.error("Error: Valid CLERK_SECRET_KEY is required in .env file.");
  process.exit(1);
}

const clerkClient = createClerkClient({ secretKey: clerkSecretKey });

const defaultPassword = "QuberePass2026!";

const usersToCreate = [
  { email: "admin@qubere.ai", firstName: "Platform", lastName: "Admin" },
  { email: "owner.acme@qubere.ai", firstName: "Alice", lastName: "AcmeOwner" },
  { email: "admin.acme@qubere.ai", firstName: "Bob", lastName: "AcmeAdmin" },
  { email: "member.acme@qubere.ai", firstName: "Charlie", lastName: "AcmeMember" },
  { email: "viewer.acme@qubere.ai", firstName: "David", lastName: "AcmeViewer" },
  { email: "owner.global@qubere.ai", firstName: "Elena", lastName: "GlobalOwner" },
  { email: "multirole@qubere.ai", firstName: "Frank", lastName: "MultiAccountUser" },
  { email: "rachit@qubere.ai", firstName: "Rachit", lastName: "Lohani" },
  { email: "sarah@qubere.ai", firstName: "Sarah", lastName: "Jones" },
  { email: "mike@qubere.ai", firstName: "Mike", lastName: "Brown" },
];

async function seedClerkUsers() {
  console.log(`Creating ${usersToCreate.length} users in Clerk with default password "${defaultPassword}"...`);

  for (const u of usersToCreate) {
    try {
      // Check if user already exists in Clerk
      const existing = await clerkClient.users.getUserList({ emailAddress: [u.email] });
      if (existing.data.length > 0) {
        console.log(`User ${u.email} already exists in Clerk (ID: ${existing.data[0].id}).`);
      } else {
        const newUser = await clerkClient.users.createUser({
          emailAddress: [u.email],
          password: defaultPassword,
          firstName: u.firstName,
          lastName: u.lastName,
          skipPasswordChecks: true,
          skipPasswordRequirement: false,
        });
        console.log(`Created user ${u.email} in Clerk (ID: ${newUser.id}).`);
      }
    } catch (err: any) {
      console.error(`Failed to create ${u.email} in Clerk:`, err?.errors?.[0]?.message || err.message);
    }
  }

  console.log("\nClerk user creation completed!");
}

seedClerkUsers();
