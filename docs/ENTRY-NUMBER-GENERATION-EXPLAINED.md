# Entry Number Generation: How It's Created

**Date**: 2026-08-16  
**Question**: How is the entry number (e.g., "NL-5100-MSW2QEA8-1D25C8") automatically generated when creating a new filing?

---

## 🎯 Answer

When you click **"New Filing"** and select country, procedure, and message, the entry number is **automatically generated** using a specific format.

### Example Entry Number

```
NL-5100-MSW2QEA8-1D25C8
│  │    │        │
│  │    │        └─ Random UUID suffix (6 chars)
│  │    └────────── Timestamp (Base36, uppercase)
│  └─────────────── Procedure Code
└────────────────── Country Code (ISO 3166-1 alpha-2)
```

---

## 📍 Where It Happens

**File**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 341-344)

**Endpoint**: `POST /api/filing` with `standalone: true`

---

## 🔧 Generation Logic

### Code Implementation

```typescript
// Generate a unique entry number for standalone filing
const timestamp = Date.now().toString(36).toUpperCase();
const randomSuffix = randomUUID().slice(0, 6).toUpperCase();
const standaloneEntryNumber = `${country}-${procedureCode}-${timestamp}-${randomSuffix}`;
```

**Breakdown**:

1. **Country**: `NL` - User-selected country code
2. **Procedure**: `5100` - User-selected procedure code
3. **Timestamp**: `MSW2QEA8` - Current timestamp in Base36 (uppercase)
4. **Random**: `1D25C8` - First 6 characters of UUID (uppercase)

---

## 📊 Step-by-Step Process

### User Action Flow

```
Step 1: User clicks "New Filing"
        ↓
Step 2: User selects:
        ├─ Country: NL
        ├─ Procedure: 5100
        └─ Message: IE015
        ↓
Step 3: Frontend sends POST request
        POST /api/filing
        Body: {
          standalone: true,
          country: "NL",
          procedureCode: "5100",
          messageName: "IE015"
        }
        ↓
Step 4: Backend generates entry number
        timestamp = Date.now() → 1723842000000
        timestamp36 = (1723842000000).toString(36) → "msw2qea8"
        timestamp36.toUpperCase() → "MSW2QEA8"
        
        randomUUID() → "1d25c8f3-4e7a-9b2c-..."
        randomSuffix = "1d25c8".toUpperCase() → "1D25C8"
        
        entryNumber = "NL-5100-MSW2QEA8-1D25C8"
        ↓
Step 5: Create CustomsFiling record
        INSERT INTO "CustomsFiling"
        (entryNumber, country, procedureCode, messageName, ...)
        ↓
Step 6: Return filing to frontend
        Response: { filing: { id, entryNumber, ... } }
        ↓
Step 7: Redirect to filing detail page
        Navigate to: /app/filing/{id}
        ↓
Step 8: Display entry number in header
        Shows: "Entry NL-5100-MSW2QEA8-1D25C8"
```

---

## 🔍 Code Deep Dive

### Full API Handler

**File**: [`route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 313-389)

```typescript
export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { standalone, country, procedureCode, messageName, filingType } = body;

  // ========================================================================
  // STANDALONE FILING - Direct creation without shipment
  // ========================================================================
  if (standalone) {
    // Validate required fields
    if (!country || !procedureCode || !messageName) {
      return NextResponse.json(
        { error: "country, procedureCode, and messageName are required" },
        { status: 400 }
      );
    }

    // Validate procedure config exists
    const procedureConfig = await db.filingProcedureConfig.findFirst({
      where: {
        country,
        procedureCode,
        messageName,
        isActive: true,
      },
      include: {
        transactionType: true,
      },
    });

    if (!procedureConfig) {
      return NextResponse.json(
        { error: `No active procedure configuration found for ${country}/${procedureCode}/${messageName}` },
        { status: 404 }
      );
    }

    // 🎯 GENERATE ENTRY NUMBER
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomSuffix = randomUUID().slice(0, 6).toUpperCase();
    const standaloneEntryNumber = `${country}-${procedureCode}-${timestamp}-${randomSuffix}`;

    // Create the standalone filing
    const filing = await db.customsFiling.create({
      data: {
        accountId: ctx.accountId,
        entryNumber: standaloneEntryNumber,  // ← Generated here
        country,
        procedureCode,
        messageName,
        transactionTypeId: procedureConfig.transactionTypeId,
        filingType: filingType || "Standard",
        filingStatus: "Draft",
        preparedByUserId: ctx.userId,
        // Standalone filings start with null values
        totalValue: null,
        totalDuties: null,
        totalTaxes: null,
        totalAmount: null,
        shipmentId: null,  // No shipment association
      },
    });

    // Create audit log
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.CREATE,
      entity: "filing",
      entityId: filing.id,
      metadata: {
        description: `Created standalone filing ${filing.entryNumber}`,
        country,
        procedureCode,
        messageName,
      },
    });

    return NextResponse.json({ filing });
  }
  
  // ... (shipment-based filing logic continues)
});
```

---

## 📐 Format Components

### 1. Country Code (2 chars)

**Source**: User selection  
**Format**: ISO 3166-1 alpha-2  
**Examples**:
- `NL` - Netherlands
- `IE` - Ireland
- `FR` - France
- `US` - United States
- `IN` - India

### 2. Procedure Code (Variable length)

**Source**: User selection  
**Format**: Country-specific procedure code  
**Examples**:
- `5100` - NCTS (Netherlands)
- `H1` - Import for Consumption (US)
- `E1` - Export (US)
- `4000` - Import (India)

### 3. Timestamp (Base36, ~8 chars)

**Source**: `Date.now().toString(36).toUpperCase()`  
**Why Base36**: Compact representation (0-9, A-Z)  
**Example**:
```javascript
const timestamp = Date.now();          // 1723842000000 (milliseconds since epoch)
const base36 = timestamp.toString(36); // "msw2qea8"
const uppercase = base36.toUpperCase(); // "MSW2QEA8"
```

**Benefit**: Encodes both date and time in 8 characters

### 4. Random Suffix (6 chars)

**Source**: `randomUUID().slice(0, 6).toUpperCase()`  
**Why UUID**: Cryptographically random, collision-resistant  
**Example**:
```javascript
const uuid = randomUUID();              // "1d25c8f3-4e7a-9b2c-8d4e-5f6a7b8c9d0e"
const suffix = uuid.slice(0, 6);        // "1d25c8"
const uppercase = suffix.toUpperCase(); // "1D25C8"
```

**Benefit**: Ensures uniqueness even if multiple filings created simultaneously

---

## 🆚 Comparison: Standalone vs Shipment-Based

### Standalone Filing (New Flow)

**Format**: `{country}-{procedure}-{timestamp36}-{random6}`  
**Example**: `NL-5100-MSW2QEA8-1D25C8`

**Generation** (lines 341-344):
```typescript
const timestamp = Date.now().toString(36).toUpperCase();
const randomSuffix = randomUUID().slice(0, 6).toUpperCase();
const standaloneEntryNumber = `${country}-${procedureCode}-${timestamp}-${randomSuffix}`;
```

### Shipment-Based Filing (Old Flow)

**Format**: `DFT-{shipmentNumber}-{random8}`  
**Example**: `DFT-SHP-2026-004872-A1B2C3D4`

**Generation** (lines 297-304):
```typescript
function generateInternalReference(shipmentNumber: string): string {
  return `DFT-${shipmentNumber}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
```

**Key Differences**:

| Aspect | Standalone | Shipment-Based |
|--------|-----------|----------------|
| **Prefix** | Country + Procedure | "DFT-" |
| **Includes** | Country, Procedure, Timestamp | Shipment Number |
| **Format** | `NL-5100-MSW2QEA8-1D25C8` | `DFT-SHP-2026-004872-A1B2C3D4` |
| **Length** | ~22 chars | ~30 chars |
| **Info** | ✅ Shows country/procedure | ✅ Links to shipment |

---

## 🎯 Why This Format?

### Design Goals

1. **Human-Readable**: Country and procedure visible at a glance
2. **Sortable**: Timestamp component allows chronological sorting
3. **Unique**: Random suffix prevents collisions
4. **Compact**: Base36 encoding keeps it short
5. **Informative**: Contains metadata (country, procedure)

### Example Scenarios

**Multi-Country View**:
```
Entry List:
  ├─ NL-5100-MSW2QEA8-1D25C8  ← Netherlands NCTS
  ├─ IE-4200-MSW2QF9A-2E36D9  ← Ireland Import
  ├─ FR-3100-MSW2QG1B-3F47EA  ← France Export
  └─ US-H1-MSW2QH2C-4G58FB    ← US Import
```

You can immediately see which country and procedure each filing belongs to!

---

## 🔐 Uniqueness Guarantees

### Collision Prevention

**Combination of**:
1. **Timestamp** (milliseconds precision)
2. **Random UUID** (cryptographically random)
3. **Database constraint** (`@@unique([accountId, entryNumber])`)

**Collision Probability**: Near zero for practical purposes

### Database Schema

```prisma
model CustomsFiling {
  id          String @id @default(cuid())
  accountId   String
  entryNumber String
  
  @@unique([accountId, entryNumber])  // ← Enforces uniqueness
}
```

**If collision occurs** (extremely rare):
- Database constraint violation
- API returns error
- Frontend can retry (automatic or manual)

---

## 📱 Frontend Flow

### New Filing Modal

**Component**: (Presumably in filing creation UI)

```typescript
// User selects country, procedure, message
const handleCreateFiling = async () => {
  const response = await fetch('/api/filing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      standalone: true,
      country: 'NL',
      procedureCode: '5100',
      messageName: 'IE015',
    }),
  });
  
  const { filing } = await response.json();
  
  // Redirect to filing detail page
  router.push(`/app/filing/${filing.id}`);
  
  // Entry number is now: filing.entryNumber
  // e.g., "NL-5100-MSW2QEA8-1D25C8"
};
```

### Display in UI

**Filing Detail Header**:
```tsx
<h1>Entry {filing.entryNumber}</h1>
// Shows: "Entry NL-5100-MSW2QEA8-1D25C8"

<p>{filing.country} · {filing.procedureCode} · {filing.messageName}</p>
// Shows: "NL · 5100 · IE015 · Standard"
```

---

## 🧪 Test Examples

### Example 1: Dutch NCTS

**Input**:
```json
{
  "standalone": true,
  "country": "NL",
  "procedureCode": "5100",
  "messageName": "IE015"
}
```

**Generated Entry Number**:
```
NL-5100-MSW2QEA8-1D25C8
```

### Example 2: Irish Import

**Input**:
```json
{
  "standalone": true,
  "country": "IE",
  "procedureCode": "4200",
  "messageName": "IE504"
}
```

**Generated Entry Number**:
```
IE-4200-MSW2QF9A-2E36D9
```

### Example 3: US Import

**Input**:
```json
{
  "standalone": true,
  "country": "US",
  "procedureCode": "H1",
  "messageName": "CUSTOMS_ENTRY"
}
```

**Generated Entry Number**:
```
US-H1-MSW2QG1B-3F47EA
```

---

## 📊 Summary

| Question | Answer |
|----------|--------|
| **When generated?** | When user creates standalone filing (selects country/procedure/message) |
| **Where generated?** | Backend API: `POST /api/filing` |
| **Format** | `{country}-{procedure}-{timestamp36}-{random6}` |
| **Example** | `NL-5100-MSW2QEA8-1D25C8` |
| **Components** | Country (2), Procedure (var), Timestamp (8), Random (6) |
| **Unique?** | Yes - timestamp + random UUID + DB constraint |
| **Readable?** | Yes - shows country and procedure at a glance |

---

## 🔗 Related Code

- **API Route**: [`src/app/api/filing/route.ts`](c:/WorkSpace/app-frontend/src/app/api/filing/route.ts) (lines 341-344)
- **Database Schema**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (CustomsFiling model)
- **Audit Log**: Created after filing generation (lines 375-387)

---

**Documentation Created**: 2026-08-16 23:00 IST
