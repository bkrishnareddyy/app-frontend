# FilingMessage Table: What It Holds and When

**Date**: 2026-08-16  
**Question**: What does the FilingMessage table hold and when is it used?

---

## 📊 Table Overview

**Table**: `FilingMessage`  
**Purpose**: Dual-purpose table serving as both a **message queue** and **audit log** for all customs filing communications

### Core Concept

`FilingMessage` stores **every canonical message** sent TO or received FROM customs authorities:
- **OUTBOUND** = Messages sent to customs (declarations, amendments, cancellations)
- **INBOUND** = Responses received from customs (acceptances, rejections, releases)

---

## 🗄️ Table Structure

### Schema Definition

**File**: [`prisma/schema.prisma`](c:/WorkSpace/app-frontend/prisma/schema.prisma) (lines 4143-4175)

```prisma
model FilingMessage {
  id             String        @id @default(cuid())
  accountId      String
  account        Account       @relation(...)
  filingId       String
  filing         CustomsFiling @relation(...)
  
  // Message Identity
  messageId      String        @unique       // Unique message ID
  correlationId  String?                     // INBOUND: equals request messageId
  priorMessageId String?                     // AMENDMENT/CANCELLATION: message being superseded
  
  // Message Metadata
  messageName    String                      // e.g., "IE015", "IE504", "CUSTOMS_DECLARATION_RESPONSE"
  direction      String                      // "OUTBOUND" or "INBOUND"
  procedure      String                      // e.g., "5100", "H1", "E1"
  country        String                      // ISO 3166-1 alpha-2 (NL, IE, US, etc.)
  status         String?                     // INBOUND only: ACCEPTED, REJECTED, RELEASED, etc.
  
  // Message Payload
  envelope       Json                        // Full header + data (canonical format)
  
  // Queue Processing (OUTBOUND only)
  queueStatus    String        @default("PENDING")  // PENDING, CLAIMED, PROCESSED, FAILED
  lockedAt       DateTime?                          // When claimed by worker
  attempts       Int           @default(0)          // Retry count
  errorMessage   String?                            // Error if failed
  
  // Timestamps
  createdAt      DateTime      @default(now())
  processedAt    DateTime?
  
  @@index([accountId])
  @@index([filingId])
  @@index([correlationId])
  @@index([queueStatus, createdAt])
}
```

---

## 📝 What It Holds

### 1. Message Direction

| Direction | Meaning | Created By | Example |
|-----------|---------|------------|---------|
| **OUTBOUND** | Message TO customs | Filing Service → Publisher | Declaration, Amendment, Cancellation |
| **INBOUND** | Response FROM customs | Third Party → Consumer | Acceptance, Rejection, Release notification |

### 2. Message Content (envelope)

The `envelope` JSON field stores the complete canonical message:

```json
{
  "header": {
    "messageId": "msg_12345",
    "filingId": "filing_67890",
    "correlationId": null,           // OUTBOUND: null, INBOUND: request messageId
    "messageName": "IE015",
    "direction": "OUTBOUND",
    "customer": {
      "accountId": "acc_abc123",
      "accountName": "Acme Corp"
    },
    "procedure": "5100",
    "country": "NL",
    "authority": "Dutch Customs",
    "dateTime": "2026-08-16T22:45:00Z",
    "schemaVersion": "1.0.0",
    "senderSystem": "Qubere"
  },
  "data": {
    "declaration": {
      "ImportDeclaration": {
        "GoodsDeclaration": {
          "ReferenceNumber": "filing_67890",
          "DeclarationNumber": "NL-5100-MSW257CL-1177FC",
          "Procedure": "40",
          "InvoiceAmount": 50000,
          "GoodsShipment": { ... }
        }
      }
    }
  }
}
```

### 3. Queue Status (OUTBOUND Messages)

| Status | Meaning | Transition |
|--------|---------|------------|
| **PENDING** | Waiting to be sent | Created → Ready for worker |
| **CLAIMED** | Being processed by worker | Worker locked it |
| **PROCESSED** | Successfully sent | Worker completed |
| **FAILED** | Send failed (with errorMessage) | Worker error (retryable) |

### 4. Message Relationships

```
Request (OUTBOUND)
  messageId: "msg_001"
  correlationId: null
  direction: "OUTBOUND"
         ↓
      [Sent to Customs]
         ↓
Response (INBOUND)
  messageId: "msg_002"
  correlationId: "msg_001"  ← Links back to request
  direction: "INBOUND"
```

---

## ⏰ When It's Used

### 1. **Filing Transmission (OUTBOUND)**

**When**: User clicks "Transmit to Customs" button

**Flow**:
```
User → Transmit Button
       ↓
Filing Service: transmitFiling()
       ↓
Declaration Builder: buildCanonicalDeclaration()
       ↓
Publisher: publish()
       ↓
FilingMessage.create({
  direction: "OUTBOUND",
  queueStatus: "PENDING",
  envelope: { header, data }
})
```

**File**: [`src/lib/canonicalMessaging/publisher.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/publisher.ts) (line 22)

```typescript
export class PgCanonicalMessagePublisher {
  async publish(queueName: string, message: CanonicalMessage) {
    // Validate against schema
    await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
    await validateAgainstActiveSchema("FILING_REQUEST_DECLARATION", message.data.declaration);
    
    // Create OUTBOUND message
    await db.filingMessage.create({
      data: {
        accountId: message.header.customer.accountId,
        filingId: message.header.filingId,
        messageId: message.header.messageId,
        messageName: message.header.messageName,
        direction: "OUTBOUND",     // ← Sent TO customs
        procedure: message.header.procedure,
        country: message.header.country,
        envelope: message,
        queueStatus: "PENDING",    // ← Ready for worker
      },
    });
  }
}
```

### 2. **Worker Processing (OUTBOUND → External System)**

**When**: Background worker polls for pending messages

**Flow**:
```
Worker polls FilingMessage
       ↓
Find OUTBOUND + PENDING messages
       ↓
Claim with FOR UPDATE SKIP LOCKED
       ↓
Send to third-party (e.g., Dutch Customs API)
       ↓
Update queueStatus: "PROCESSED"
```

**Note**: Currently uses a dev stub (mock third party) - real integration TODO

### 3. **Response Reception (INBOUND)**

**When**: Customs authority sends response back

**Flow**:
```
Third Party receives response
       ↓
Third Party creates INBOUND message
       ↓
FilingMessage.create({
  direction: "INBOUND",
  correlationId: originalMessageId,
  envelope: { header, response data }
})
       ↓
Consumer: processOne()
       ↓
Validate against schema
       ↓
Handler: processInboundMessage()
       ↓
Update Filing status
       ↓
Update queueStatus: "PROCESSED"
```

**File**: [`src/lib/canonicalMessaging/consumer.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/consumer.ts) (line 28-56)

```typescript
export class PgCanonicalMessageConsumer {
  async processOne(handler) {
    // Claim one INBOUND message
    const claimed = await db.$queryRaw`
      UPDATE "FilingMessage"
      SET "queueStatus" = 'CLAIMED', "lockedAt" = NOW()
      WHERE id = (
        SELECT id
        FROM "FilingMessage"
        WHERE "direction" = 'INBOUND'       // ← From customs
          AND "queueStatus" = 'PENDING'
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, envelope, attempts;
    `;
    
    if (!claimed || claimed.length === 0) return false;
    
    const message = claimed[0].envelope;
    
    // Validate
    await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
    await validateAgainstActiveSchema("FILING_RESPONSE_DATA", message.data);
    
    // Process
    await handler(message);
    
    // Mark processed
    await db.filingMessage.update({
      where: { id: claimed[0].id },
      data: { 
        queueStatus: "PROCESSED",
        processedAt: new Date(),
        status: message.data.status  // ACCEPTED, REJECTED, etc.
      },
    });
  }
}
```

### 4. **Response Tab Display (Audit Log)**

**When**: User views the Response tab on Filing Detail page

**Flow**:
```
User → Filing Detail → Response Tab
       ↓
Load all FilingMessages for this filing
       ↓
Display timeline:
  - OUTBOUND messages (sent to customs)
  - INBOUND responses (received from customs)
```

**File**: [`src/app/app/filing/[id]/page.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/[id]/page.tsx)

```typescript
// Load messages for Response tab
const messages = await db.filingMessage.findMany({
  where: { filingId: params.id },
  orderBy: { createdAt: 'asc' },  // Chronological timeline
});
```

**UI Display**:
```
Response Tab:
  ┌─────────────────────────────────────┐
  │ 📤 OUTBOUND: IE015 Declaration      │
  │    Status: PROCESSED                │
  │    Sent: 2026-08-16 10:30 AM        │
  └─────────────────────────────────────┘
  
  ┌─────────────────────────────────────┐
  │ 📥 INBOUND: Response                │
  │    Status: ACCEPTED                 │
  │    MRN: 26NL123456789012345         │
  │    Received: 2026-08-16 10:32 AM    │
  └─────────────────────────────────────┘
```

---

## 🔄 Complete Lifecycle

### Example: Import Declaration Flow

```
Step 1: User Transmits
  ┌─────────────────────────────────────┐
  │ FilingMessage                       │
  │ direction: "OUTBOUND"               │
  │ messageName: "IE015"                │
  │ queueStatus: "PENDING"              │
  │ envelope: { declaration data }      │
  └─────────────────────────────────────┘

Step 2: Worker Claims and Sends
  ┌─────────────────────────────────────┐
  │ FilingMessage                       │
  │ queueStatus: "CLAIMED"              │
  │ lockedAt: 2026-08-16 10:30:00       │
  └─────────────────────────────────────┘
           ↓
    [Send to Dutch Customs]
           ↓
  ┌─────────────────────────────────────┐
  │ FilingMessage                       │
  │ queueStatus: "PROCESSED"            │
  │ processedAt: 2026-08-16 10:30:15    │
  └─────────────────────────────────────┘

Step 3: Customs Responds
  ┌─────────────────────────────────────┐
  │ FilingMessage (NEW ROW)             │
  │ direction: "INBOUND"                │
  │ correlationId: "msg_001" (↑ links)  │
  │ status: "ACCEPTED"                  │
  │ envelope: { response data }         │
  └─────────────────────────────────────┘

Step 4: Consumer Processes Response
  ┌─────────────────────────────────────┐
  │ FilingMessage                       │
  │ queueStatus: "PROCESSED"            │
  │ processedAt: 2026-08-16 10:32:10    │
  └─────────────────────────────────────┘
           ↓
    Update Filing.status = "Released"
           ↓
    Display in Response Tab
```

---

## 🎯 Key Use Cases

### 1. Message Queue (OUTBOUND)

**Purpose**: Durably persist outbound messages for async transmission

**Benefits**:
- Resilient to failures (can retry)
- Transactional (create message + update filing in single transaction)
- Queryable (can see all pending/failed messages)

### 2. Audit Log (BOTH directions)

**Purpose**: Permanent record of all communications with customs

**Benefits**:
- Compliance requirement (must keep records)
- Debug tool (what did we send? what did they respond?)
- Timeline view (see full conversation history)

### 3. Correlation Tracking

**Purpose**: Link requests with their responses

**Example**:
```sql
-- Find response for a request
SELECT r.* 
FROM "FilingMessage" r
WHERE r.correlationId = 'msg_001'  -- Original request messageId
  AND r.direction = 'INBOUND';
```

### 4. Retry Logic

**Purpose**: Handle transient failures

**Example**:
```typescript
// Worker retries failed messages
const retryable = await db.filingMessage.findMany({
  where: {
    direction: 'OUTBOUND',
    queueStatus: 'FAILED',
    attempts: { lt: 3 },  // Max 3 retries
  },
});
```

---

## 📊 Query Examples

### Get All Messages for a Filing

```sql
SELECT * FROM "FilingMessage"
WHERE "filingId" = 'filing_12345'
ORDER BY "createdAt" ASC;
```

### Get Pending OUTBOUND Messages (Queue)

```sql
SELECT * FROM "FilingMessage"
WHERE "direction" = 'OUTBOUND'
  AND "queueStatus" = 'PENDING'
ORDER BY "createdAt" ASC;
```

### Find Response for Request

```sql
SELECT * FROM "FilingMessage"
WHERE "correlationId" = 'msg_12345'  -- Request messageId
  AND "direction" = 'INBOUND';
```

### Get Failed Messages

```sql
SELECT * FROM "FilingMessage"
WHERE "queueStatus" = 'FAILED'
ORDER BY "createdAt" DESC;
```

---

## 🔗 Related Components

| Component | File | Purpose |
|-----------|------|---------|
| **Publisher** | [`publisher.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/publisher.ts) | Creates OUTBOUND messages |
| **Consumer** | [`consumer.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/consumer.ts) | Processes INBOUND messages |
| **Filing Service** | [`filing.service.ts`](c:/WorkSpace/app-frontend/src/modules/filings/filing.service.ts) | Orchestrates transmission |
| **Dev Stub** | [`devStub.ts`](c:/WorkSpace/app-frontend/src/lib/canonicalMessaging/devStub.ts) | Simulates third party |
| **Response Tab** | [`FilingDetailClient.tsx`](c:/WorkSpace/app-frontend/src/app/app/filing/[id]/FilingDetailClient.tsx) | Displays message timeline |

---

## Summary

| Aspect | Answer |
|--------|--------|
| **What it holds** | Every canonical message sent/received for customs filings |
| **When created (OUTBOUND)** | When user clicks "Transmit to Customs" |
| **When created (INBOUND)** | When customs authority sends response |
| **Dual purpose** | Message queue (OUTBOUND) + Audit log (BOTH) |
| **Key fields** | direction, queueStatus, envelope, correlationId |
| **Displayed in** | Response tab on Filing Detail page |

---

**Documentation Created**: 2026-08-16 22:50 IST
