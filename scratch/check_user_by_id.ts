import { db } from "../src/lib/db";

async function main() {
  const user = await db.user.findUnique({
    where: { id: "cmsj8haku0008fxk9v4mdm845" },
  });
  console.log("User for cmsj8haku0008fxk9v4mdm845:", user);
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await db.$disconnect();
  });
