# Why Filings Appear on Dashboard Before Saving Declaration

**Date**: 2026-08-16  
**Issue**: Filing appears on dashboard immediately after clicking "New Filing" and selecting country/procedure/message, even without saving the Declaration form.

---

## 🎯 Answer: This Is By Design!

The filing record is created **immediately** when you complete the "New Filing" wizard, **not** when you save the declaration form.

### Two Separate Steps

```
Step 1: Create Filing (happens immediately)
  User clicks "New Filing"
    → Selects Country, Procedure, Message
    → Clicks "Create"
    → 💾 Filing record CREATED in database
    → Status: "Draft"
    → Redirects to filing detail page
    → ✅ Shows on dashboard immediately

Step 2: Fill Declaration (happens later)
  User on Declaration tab
    → Fills in form fields
    → Clicks "Save Draft"
    → 💾 Declaration data saved to filing.dutyBreakdown.declarationDraft
    → Filing already exists from Step 1
```

---

## 📊 What Gets Created When

### When You Click "New Filing" → Select Options → Create

**Immediately Created**:
- ✅ CustomsFiling record in database
- ✅ Entry number generated (e.g., `NL-5100-MSW2QEA8-1D25C8`)
- ✅ Filing status set to "Draft"
- ✅ Country, procedure, message stored
- ✅ Appears on dashboard
- ✅ Audit log entry created

**NOT Yet Created**:
- ❌ Declaration form data (empty/null)
- ❌ Line items (none)
- ❌ Party information (none)
- ❌ Documents (none)

### When You Fill Declaration Tab → Click "Save Draft"

**What Gets Saved**:
- ✅ Declaration form data → `filing.dutyBreakdown.declarationDraft`
- ✅ All field values from the form
- ✅ Filing record UPDATED (not created)

---

## 🔍 Code Evidence

### Filing Creation (Immediate)

**File**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 348-373)

```typescript
// This runs when you click "Create" in the New Filing wizard
const filing = await db.customsFiling.create({
  data: {
    accountId: ctx.accountId,
    entryNumber: standaloneEntryNumber,      // Generated here
    country,                                 // From your selection
    procedureCode,                           // From your selection
    messageName,                             // From your selection
    filingStatus: "Draft",                   // ← Set to Draft immediately
    preparedByUserId: ctx.userId,
    // 👇 All values are NULL initially
    totalValue: null,
    totalDuties: null,
    totalTaxes: null,
    totalAmount: null,
    shipmentId: null,
  },
});

// Audit log created immediately
await createAuditLog({
  action: AuditAction.CREATE,
  entity: "filing",
  entityId: filing.id,
  metadata: {
    description: `Created standalone filing ${filing.entryNumber}`,
  },
});

return NextResponse.json({ filing });  // ← Returns to frontend immediately
```

### Declaration Save (Later)

**File**: [`src/app/api/filing/[id]/declaration/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/[id]/declaration/route.ts) (lines 61-66)

```typescript
// This runs when you click "Save Draft" in Declaration tab
await db.customsFiling.update({  // ← UPDATES existing filing
  where: { id },
  data: {
    dutyBreakdown: {
      ...existingDutyData,
      declarationDraft: body.declarationData,  // ← Saves declaration here
    },
  },
});
```

---

## 🎨 Visual Flow

```
User Journey:
┌────────────────────────────────┐
│ 1. Click "New Filing" Button   │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ 2. Select Country: NL          │
│    Select Procedure: 5100      │
│    Select Message: IE015       │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ 3. Click "Create"              │
└────────────┬───────────────────┘
             │
             │ 📡 POST /api/filing
             │
┌────────────▼───────────────────┐
│ 💾 DATABASE INSERT             │
│ CustomsFiling created:         │
│ - entryNumber: NL-5100-...     │
│ - status: "Draft"              │
│ - country: "NL"                │
│ - totalValue: null             │
│ - declarationData: null        │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ ✅ Filing appears on dashboard │  ← YOU ARE HERE (Before filling form)
│    Entry NL-5100-MSW2QEA8...   │
│    Status: Draft               │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ 4. Redirect to filing detail   │
│    /app/filing/{id}            │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ 5. Declaration Tab (Empty)     │
│    User fills in form fields   │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐
│ 6. Click "Save Draft"          │
└────────────┬───────────────────┘
             │
             │ 📡 PATCH /api/filing/{id}/declaration
             │
┌────────────▼───────────────────┐
│ 💾 DATABASE UPDATE             │
│ filing.dutyBreakdown updated:  │
│ - declarationDraft: {...}      │
└────────────────────────────────┘
```

---

## 🤔 Why This Design?

### Benefits of Creating Filing Immediately

1. **Progressive Saving**
   - User can save work at any point
   - No risk of losing filing record
   - Can leave and come back later

2. **Audit Trail**
   - Tracks when filing was initiated
   - Shows who started it (preparedByUserId)
   - Complete history from creation

3. **Unique Entry Number**
   - Generated once, never changes
   - Available immediately for reference
   - Can be shared with team before completion

4. **Draft Management**
   - Filings visible in dashboard from start
   - Easy to find incomplete work
   - Status progression: Draft → In Progress → Submitted

5. **Multi-Step Workflow**
   - Filing creation is Step 1
   - Declaration form is Step 2
   - Transmission is Step 3
   - Each step can be done separately

---

## 📋 Dashboard Display

### What You See Immediately

```
Dashboard - Filings List:
┌────────────────────────────────────────────────┐
│ Entry NL-5100-MSW2QEA8-1D25C8        [Draft]  │
│ NL · 5100 · IE015 · Standard                  │
│ Created: 2 minutes ago                         │
│ Total Value: —                                 │  ← Null (not filled yet)
│ Total Duties: —                                │  ← Null (not filled yet)
└────────────────────────────────────────────────┘
```

**Why values show "—"**:
- `totalValue: null` in database
- `totalDuties: null` in database
- `totalTaxes: null` in database

These will be populated when:
- For standalone filings: User fills declaration form
- For shipment-based filings: System calculates from line items

---

## 🔄 Status Lifecycle

```
Draft (Initial)
  ↓ User fills declaration form
Draft (Still Draft - just has data now)
  ↓ User clicks "Transmit to Customs"
Submitted
  ↓ Customs responds
Accepted / Rejected / Released
```

**Key Point**: Filling the declaration form does NOT change the status from "Draft". Status only changes on transmission.

---

## 🎯 Expected Behavior

### This Is Correct ✅

```
Sequence:
1. Click "New Filing" → Select options → Create
   ✅ Filing appears on dashboard immediately
   ✅ Status: "Draft"
   ✅ Values: null/empty

2. Fill Declaration tab → Click "Save Draft"
   ✅ Filing STILL on dashboard (same record)
   ✅ Status: STILL "Draft"
   ✅ Declaration data now saved

3. Click "Transmit to Customs"
   ✅ Status changes to "Submitted"
   ✅ FilingSnapshot created
   ✅ FilingMessage created
```

---

## 🚫 What Would Be Wrong

### If Filing Only Appeared After Saving Declaration ❌

**Problems**:
- User creates filing → gets entry number
- User closes browser before saving declaration
- Entry number exists in their mind but not in database
- Confusion: "Where is my filing?"
- Lose audit trail of when creation started
- Can't track incomplete drafts

### Current Design Avoids This ✅

- Filing record exists from moment of creation
- Entry number persistent and queryable
- Can find draft even if never saved declaration
- Complete audit trail
- Progressive saving possible

---

## 💡 How to Delete a Draft

If you created a filing by mistake and want to remove it from dashboard:

**Option 1: Mark as Inactive/Cancelled**
```
1. Open filing
2. Click action menu
3. Select "Cancel Filing"
```

**Option 2: Delete (if implemented)**
```
API: DELETE /api/filing/{id}
(May not be implemented - check with team)
```

**Option 3: Hide Drafts in Dashboard**
```
Dashboard filters:
- Show only "Submitted" filings
- Hide "Draft" status
```

---

## 📊 Database State

### Right After "New Filing" Creation

```sql
SELECT * FROM "CustomsFiling" WHERE id = 'filing_abc123';
```

Result:
```
id: filing_abc123
entryNumber: NL-5100-MSW2QEA8-1D25C8
country: NL
procedureCode: 5100
messageName: IE015
filingStatus: Draft
totalValue: NULL          ← Empty
totalDuties: NULL         ← Empty
totalTaxes: NULL          ← Empty
totalAmount: NULL         ← Empty
dutyBreakdown: NULL       ← No declaration data yet
createdAt: 2026-08-16T22:30:00Z
updatedAt: 2026-08-16T22:30:00Z
```

### After Clicking "Save Draft" in Declaration Tab

```sql
SELECT * FROM "CustomsFiling" WHERE id = 'filing_abc123';
```

Result:
```
id: filing_abc123
entryNumber: NL-5100-MSW2QEA8-1D25C8
country: NL
procedureCode: 5100
messageName: IE015
filingStatus: Draft       ← STILL Draft
totalValue: NULL          ← Still empty (standalone filings)
totalDuties: NULL         ← Still empty
totalTaxes: NULL          ← Still empty
totalAmount: NULL         ← Still empty
dutyBreakdown: {          ← Declaration data NOW here
  "declarationDraft": {
    "ImportDeclaration": { ... }
  }
}
createdAt: 2026-08-16T22:30:00Z
updatedAt: 2026-08-16T22:45:00Z  ← Updated timestamp
```

---

## 🎓 Summary

| Question | Answer |
|----------|--------|
| **When does filing appear on dashboard?** | Immediately after clicking "Create" in New Filing wizard |
| **Before saving declaration?** | Yes - that's by design |
| **Why?** | Filing record created on "Create", declaration data saved separately |
| **Is this a bug?** | No - this is expected behavior |
| **How to prevent?** | Don't click "Create" until ready to start filling |
| **How to remove unwanted draft?** | Cancel filing or hide Draft status in dashboard |

---

## 🔗 Related Files

- **Filing Creation**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (line 348)
- **Declaration Save**: [`src/app/api/filing/[id]/declaration/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/[id]/declaration/route.ts)
- **Dashboard Query**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) GET endpoint

---

**Documentation Created**: 2026-08-16 23:05 IST
