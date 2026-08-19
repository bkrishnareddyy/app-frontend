import { db } from "../src/lib/db";

async function main() {
  const accounts = await db.account.findMany({ where: { dataMode: "DEMO" } });
  for (const a of accounts) {
    const shipments = await db.shipment.count({ where: { accountId: a.id } });
    const filings = await db.customsFiling.count({ where: { accountId: a.id } });
    const members = await db.accountMembership.findMany({ where: { accountId: a.id }, include: { user: true } });
    console.log(a.name, "|", a.slug, "|", a.type, "| shipments:", shipments, "| filings:", filings, "| users:", members.map(m => m.user.email).join(","));
  }
  console.log("---total accounts---", await db.account.count());
}
main().finally(() => db.$disconnect());
