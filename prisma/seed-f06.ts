import { db } from "../src/lib/db";
import tradeAgreements from "./seed-data/trade-agreements.json";
import adcvdOrders from "./seed-data/adcvd-orders.json";

export async function seedF06Data() {
  console.log("Seeding F06 TradeAgreements and AdcvdOrders...");

  for (const ta of tradeAgreements) {
    await db.tradeAgreement.upsert({
      where: { code: ta.code },
      update: {
        name: ta.name,
        description: ta.description,
        effectiveDate: new Date(ta.effectiveDate),
      },
      create: {
        code: ta.code,
        name: ta.name,
        description: ta.description,
        effectiveDate: new Date(ta.effectiveDate),
      },
    });
    console.log(`- Upserted TradeAgreement: ${ta.code} (${ta.name})`);
  }

  for (const order of adcvdOrders) {
    await db.adcvdOrder.upsert({
      where: { caseNumber: order.caseNumber },
      update: {
        title: order.title,
        petitioner: order.petitioner,
        respondentCountries: order.respondentCountries,
        htsCodesInScope: order.htsCodesInScope,
        scopeLanguage: order.scopeLanguage,
        effectiveDate: new Date(order.effectiveDate),
        suspensionAgreement: order.suspensionAgreement,
        status: order.status,
      },
      create: {
        caseNumber: order.caseNumber,
        title: order.title,
        petitioner: order.petitioner,
        respondentCountries: order.respondentCountries,
        htsCodesInScope: order.htsCodesInScope,
        scopeLanguage: order.scopeLanguage,
        effectiveDate: new Date(order.effectiveDate),
        suspensionAgreement: order.suspensionAgreement,
        status: order.status,
      },
    });
    console.log(`- Upserted AdcvdOrder: ${order.caseNumber} (${order.title})`);
  }

  console.log("F06 seed completed successfully.");
}

if (require.main === module) {
  seedF06Data()
    .catch((err) => {
      console.error("F06 seed failed:", err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
