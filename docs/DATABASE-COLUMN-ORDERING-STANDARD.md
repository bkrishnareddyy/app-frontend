# Database Column Ordering Standard

## Best Practice: Audit Columns Always Last

### Standard Column Order for All Tables

```prisma
model ExampleTable {
  // 1. Primary Key (always first)
  id              String   @id @default(cuid())
  
  // 2. Business/Domain Fields (logical grouping)
  country         String
  procedureCode   String
  messageName     String
  
  // 3. Data Fields
  configData      Json
  
  // 4. Metadata/Flags
  version         Int      @default(1)
  description     String?
  isActive        Boolean  @default(true)
  
  // 5. Audit Fields (ALWAYS LAST)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?
  
  // 6. Constraints & Indexes (after fields)
  @@unique([country, procedureCode, messageName])
  @@index([isActive])
}
```

## Rationale

### Why Audit Columns Last?

1. **Consistency**: All tables follow the same pattern
2. **Readability**: Business logic fields are together at the top
3. **Visual Scanning**: Developers can quickly find business fields
4. **Query Organization**: SELECT * orders columns predictably
5. **Migration Safety**: Adding business fields doesn't affect audit fields

### Column Group Order

```
1. id                    (Primary Key)
   ↓
2. Foreign Keys          (Relations)
   ↓
3. Business Fields       (Core domain data)
   ↓
4. Metadata/Flags        (version, isActive, description)
   ↓
5. Audit Fields          (createdAt, updatedAt, createdBy, updatedBy)
   ↓
6. Constraints           (@@unique, @@index)
```

## Examples from Codebase

### ✅ Correct: FilingUIConfig

```prisma
model FilingUIConfig {
  id              String   @id @default(cuid())
  
  // Business identifiers
  country         String
  procedureCode   String
  messageName     String
  messageType     String
  transactionType String   @default("import")
  
  // Data
  configData      Json
  
  // Metadata
  version         Int      @default(1)
  description     String?
  isActive        Boolean  @default(true)
  
  // Audit (LAST)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?

  @@unique([country, procedureCode, messageName, messageType, transactionType])
}
```

### ❌ Incorrect: Audit Fields in Middle

```prisma
model BadExample {
  id              String   @id @default(cuid())
  
  country         String
  createdAt       DateTime @default(now())  // ❌ Too early!
  procedureCode   String
  updatedAt       DateTime @updatedAt       // ❌ Too early!
  configData      Json
  version         Int
  
  // Should be here instead ↓
}
```

## Audit Field Definitions

### Standard Audit Fields

```prisma
// Creation tracking
createdAt       DateTime @default(now())   // Auto-set on insert
createdBy       String?                    // User ID who created (nullable for system)

// Update tracking
updatedAt       DateTime @updatedAt        // Auto-updated on every save
updatedBy       String?                    // User ID who last updated (nullable for system)
```

### Usage in API Layers

**When Creating**:
```typescript
await db.table.create({
  data: {
    // Business fields
    country: "NL",
    configData: {...},
    
    // Audit fields
    createdBy: userId,
    // createdAt auto-set
    // updatedBy can be omitted (same as createdBy initially)
  }
});
```

**When Updating**:
```typescript
await db.table.update({
  where: { id },
  data: {
    // Business fields
    configData: {...},
    
    // Audit fields
    updatedBy: userId,
    // updatedAt auto-updated by Prisma
  }
});
```

## Verification Checklist

When creating or modifying a table, verify:

- [ ] `id` is first field
- [ ] Foreign keys come before business fields
- [ ] Business fields are logically grouped
- [ ] Metadata/flags after business fields
- [ ] `createdAt` is second-to-last datetime field
- [ ] `updatedAt` is last datetime field
- [ ] `createdBy` after createdAt (if present)
- [ ] `updatedBy` is very last field (if present)
- [ ] `@@unique` and `@@index` after all fields

## Common Patterns

### Pattern 1: Simple Entity

```prisma
model SimpleEntity {
  id          String   @id @default(cuid())
  name        String
  description String?
  isActive    Boolean  @default(true)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### Pattern 2: Entity with Relations

```prisma
model EntityWithRelations {
  id          String   @id @default(cuid())
  
  // Foreign keys
  parentId    String
  parent      Parent   @relation(fields: [parentId], references: [id])
  
  // Business fields
  name        String
  description String?
  
  // Metadata
  status      String   @default("active")
  version     Int      @default(1)
  
  // Audit
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?
  updatedBy   String?
}
```

### Pattern 3: Configuration Entity

```prisma
model ConfigEntity {
  id              String   @id @default(cuid())
  
  // Identifiers
  tenantId        String
  configKey       String
  
  // Data
  configValue     Json
  
  // Metadata
  version         Int      @default(1)
  description     String?
  isActive        Boolean  @default(true)
  isSystem        Boolean  @default(false)
  
  // Audit (ALWAYS LAST)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?
  
  @@unique([tenantId, configKey])
  @@index([tenantId, isActive])
}
```

## Benefits

### 1. Predictable Schema

Developers know where to look:
- Top: Business logic
- Bottom: Audit trail

### 2. Better Diffs

When reviewing schema changes:
```diff
model FilingUIConfig {
  id              String   @id
  country         String
+ procedureCode   String    // ✓ Clear addition in business section
  configData      Json
  version         Int
  
  createdAt       DateTime  // ✓ Audit fields untouched
  updatedAt       DateTime
}
```

### 3. Cleaner Queries

```sql
SELECT 
  id,
  country,
  procedureCode,
  configData,
  version,
  -- Audit fields last
  createdAt,
  updatedAt
FROM FilingUIConfig;
```

### 4. Migration Safety

Adding fields in the middle doesn't shift audit columns:
```prisma
// Safe addition:
model Table {
  id       String
  field1   String
  field2   String
+ newField String    // ✓ Add before audit fields
  
  createdAt DateTime  // ✓ Stays in same position
  updatedAt DateTime
}
```

## Enforcement

### In Code Reviews

Check for:
- ❌ Audit fields in the middle of the schema
- ❌ `updatedAt` before `createdAt`
- ❌ Business fields after audit fields

### In PRs

Require:
- ✅ Audit fields always at the end
- ✅ Logical grouping of business fields
- ✅ Comments explaining field groups

### Linting (Optional)

Consider creating a custom ESLint rule:
```typescript
// Check Prisma schema files for column order
rules: {
  'prisma/audit-fields-last': 'error'
}
```

## Summary

**Golden Rule**: `createdAt`, `updatedAt`, `createdBy`, `updatedBy` are ALWAYS the last fields in every table.

**Order**:
1. id (primary key)
2. Foreign keys
3. Business fields
4. Metadata/flags
5. Audit fields ← LAST
6. Constraints

**Why**: Consistency, readability, maintainability, and migration safety.

---

**Status**: ✅ FilingUIConfig follows this standard correctly
