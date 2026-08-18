# Save Draft Storage Location

**Date**: 2026-08-16  
**Question**: When we click "Save Draft", in which table does it store the declaration data?

---

## Answer

When you click **"Save Draft"** in the Declaration tab, the data is stored in:

### 📊 Database Table: `CustomsFiling`
### 📝 Column: `dutyBreakdown` (JSON field)
### 🔑 Nested Property: `declarationDraft`

---

## Storage Flow

### 1. User Clicks "Save Draft"

**Location**: Filing Detail page → Declaration tab  
**Button**: "Save Draft" in header

```tsx
<Button variant="outline" size="sm" onClick={handleSaveDeclarationDraft}>
  <Save className="w-4 h-4 mr-2" />
  Save Draft
</Button>
```

### 2. Frontend Handler

**File**: [`FilingDetailClient.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/[id]/FilingDetailClient.tsx) (lines 711-730)

```typescript
async function handleSaveDeclarationDraft() {
  setBusy("saveDraft");
  setError(null);
  setSuccess(null);
  try {
    const res = await fetch(`/api/filing/${filing.id}/declaration`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declarationData }),  // ← Declaration form data
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to save draft');
    setSuccess('Declaration draft saved successfully!');
    router.refresh();
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(null);
  }
}
```

### 3. API Endpoint

**File**: [`src/app/api/filing/[id]/declaration/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/[id]/declaration/route.ts)

**Method**: `PATCH /api/filing/[id]/declaration`

```typescript
export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  // Get filing
  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, dutyBreakdown: true, entryNumber: true },
  });

  // Store declaration data in dutyBreakdown with a special key
  const existingDutyData = (filing.dutyBreakdown as any) || {};
  const updatedDutyBreakdown = {
    ...existingDutyData,
    declarationDraft: body.declarationData,  // ← Stored here!
  };

  // Update database
  await db.customsFiling.update({
    where: { id },
    data: {
      dutyBreakdown: updatedDutyBreakdown as any,
    },
  });

  // Create audit log
  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.UPDATE,
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: {
      description: `Saved declaration draft for filing ${filing.entryNumber}`,
      fields: ['declarationData'],
    },
  });

  return NextResponse.json({ success: true });
});
```

### 4. Database Storage

**Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (line 909)

```prisma
model CustomsFiling {
  id            String   @id @default(cuid())
  entryNumber   String
  // ... other fields ...
  dutyBreakdown Json?    // ← Declaration draft stored here!
  // ... other fields ...
}
```

---

## Storage Structure

### Database Record Example

```json
{
  "id": "filing_12345",
  "entryNumber": "NL-5100-MSW257CL-1177FC",
  "country": "NL",
  "procedureCode": "5100",
  "messageName": "IE015",
  "dutyBreakdown": {
    // Original duty breakdown data (if exists)
    "fees": [...],
    
    // Declaration draft (nested here!)
    "declarationDraft": {
      "ImportDeclaration": {
        "GoodsDeclaration": {
          "ReferenceNumber": "filing_12345",
          "DeclarationNumber": "NL-5100-MSW257CL-1177FC",
          "Procedure": "40",
          "InvoiceAmount": 50000,
          "InvoiceCurrency": "USD",
          "GoodsShipment": {
            "Consignment": {
              "TransportMeans": {
                "ModeCode": "1"
              },
              "Carrier": {
                "Name": "Maersk"
              },
              "GoodsItem": [
                {
                  "SequenceNumber": 1,
                  "Description": "Electronics",
                  "Commodity": {
                    "CommodityCode": "851762",
                    "NationalTariffSuffix": "00"
                  },
                  "InvoiceLineValue": 50000
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

---

## Why This Approach?

### Current Implementation (Temporary Solution)

**Comments in code (lines 26-27, 53-54)**:
```typescript
// Declaration data is stored in dutyBreakdown as a temporary solution
// In production, you might want a dedicated declarationData JSON field
```

### Pros
✅ Quick implementation - uses existing JSON field  
✅ No schema migration needed  
✅ Works immediately

### Cons
⚠️ **Not ideal** - mixing duty breakdown data with declaration draft  
⚠️ **Confusing** - field name doesn't match content  
⚠️ **Future issue** - harder to query/index

---

## Recommended Future Improvement

### Add Dedicated Field

**Suggested Schema Update**:
```prisma
model CustomsFiling {
  id               String   @id @default(cuid())
  entryNumber      String
  // ... existing fields ...
  dutyBreakdown    Json?    // Keep for actual duty breakdown
  declarationData  Json?    // ← NEW: Dedicated field for declaration drafts
  // ... other fields ...
}
```

**Migration**:
```sql
ALTER TABLE "CustomsFiling" 
ADD COLUMN "declarationData" JSONB;

-- Migrate existing drafts
UPDATE "CustomsFiling"
SET "declarationData" = "dutyBreakdown"->'declarationDraft'
WHERE "dutyBreakdown" ? 'declarationDraft';

-- Clean up old location
UPDATE "CustomsFiling"
SET "dutyBreakdown" = "dutyBreakdown" - 'declarationDraft'
WHERE "dutyBreakdown" ? 'declarationDraft';
```

---

## Summary

| Question | Answer |
|----------|--------|
| **Which table?** | `CustomsFiling` |
| **Which column?** | `dutyBreakdown` (JSON) |
| **Nested key?** | `declarationDraft` |
| **Example path** | `CustomsFiling.dutyBreakdown.declarationDraft` |
| **Is this ideal?** | ⚠️ No - temporary solution |
| **Future plan?** | Add dedicated `declarationData` column |

---

## Related Files

- **Frontend**: [`FilingDetailClient.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/[id]/FilingDetailClient.tsx) (line 711)
- **API**: [`src/app/api/filing/[id]/declaration/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/[id]/declaration/route.ts)
- **Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (line 909)

---

**Documentation Created**: 2026-08-16 22:45 IST
