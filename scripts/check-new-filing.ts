import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const filing = await db.customsFiling.findFirst({
    where: { localReferenceNumber: "LRN_IMP_003" },
    select: { 
      id: true, 
      localReferenceNumber: true, 
      dutyBreakdown: true, 
      shipmentId: true 
    },
  });

  console.log("\n📄 Filing Check:");
  console.log("   Filing ID:", filing?.id);
  console.log("   LRN:", filing?.localReferenceNumber);
  console.log("   Standalone:", filing?.shipmentId === null);
  console.log("   Has dutyBreakdown:", !!filing?.dutyBreakdown);

  if (filing?.dutyBreakdown) {
    const data = filing.dutyBreakdown as any;
    console.log("   Has declarationDraft:", !!data?.declarationDraft);
    
    if (data?.declarationDraft) {
      console.log("\n📦 Declaration Structure:");
      console.log(JSON.stringify(data.declarationDraft, null, 2));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
