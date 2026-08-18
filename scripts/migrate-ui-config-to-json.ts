/**
 * Migration script: Convert old FilingUIConfig (one row per field) to new structure (one row with JSON)
 * 
 * Run this BEFORE pushing the new schema to preserve existing data
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateUIConfigs() {
  console.log('Starting migration of FilingUIConfig data...\n');

  try {
    // Step 1: Fetch all existing configs
    const oldConfigs = await prisma.filingUIConfig.findMany({
      orderBy: [
        { country: 'asc' },
        { procedureCode: 'asc' },
        { messageName: 'asc' },
        { messageType: 'asc' },
        { transactionType: 'asc' },
      ]
    });

    console.log(`Found ${oldConfigs.length} existing field configurations`);

    // Step 2: Group by configuration key
    const groupedConfigs = new Map<string, any[]>();
    
    for (const config of oldConfigs) {
      const key = `${config.country}|${config.procedureCode}|${config.messageName}|${config.messageType}|${config.transactionType}`;
      
      if (!groupedConfigs.has(key)) {
        groupedConfigs.set(key, []);
      }
      
      groupedConfigs.get(key)!.push(config);
    }

    console.log(`\nGrouped into ${groupedConfigs.size} unique configurations:\n`);

    // Step 3: Create backup table SQL
    const backupSQL = `
-- Backup existing data
CREATE TABLE IF NOT EXISTS "FilingUIConfig_backup_${Date.now()}" AS 
SELECT * FROM "FilingUIConfig";
    `;

    console.log('Backup SQL (run this in your database first):');
    console.log(backupSQL);
    console.log('\n---\n');

    // Step 4: Generate new records structure
    const newRecords: any[] = [];

    for (const [key, fields] of groupedConfigs.entries()) {
      const [country, procedureCode, messageName, messageType, transactionType] = key.split('|');
      
      const firstField = fields[0];
      
      // Transform field configs to JSON structure
      const fieldConfigs = fields.map(f => ({
        fieldPath: f.fieldPath,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType,
        section: f.section,
        displayOrder: f.displayOrder,
        gridColumn: f.gridColumn,
        isRequired: f.isRequired,
        isReadOnly: f.isReadOnly,
        isVisible: f.isVisible,
        validationRules: f.validationRules,
        placeholder: f.placeholder,
        helpText: f.helpText,
        masterDataSource: f.masterDataSource,
        masterDataFilter: f.masterDataFilter,
        isMultiSelect: f.isMultiSelect,
        isArrayField: f.isArrayField,
        arrayParentPath: f.arrayParentPath,
      }));

      newRecords.push({
        country,
        procedureCode,
        messageName,
        messageType,
        transactionType,
        configData: {
          fields: fieldConfigs,
          totalFields: fieldConfigs.length,
          sections: [...new Set(fields.map(f => f.section))],
        },
        version: 1,
        description: `Migrated from ${fields.length} individual field records`,
        isActive: true,
        createdAt: firstField.createdAt,
        updatedAt: new Date(),
        createdBy: firstField.createdBy,
        updatedBy: 'migration-script',
      });

      console.log(`✓ ${country} / ${procedureCode} / ${messageName} (${messageType}, ${transactionType}): ${fields.length} fields`);
    }

    console.log(`\n\nTotal new records to create: ${newRecords.length}`);
    console.log('\n---\n');

    // Step 5: Generate SQL for new records
    console.log('Migration SQL (run after schema change):');
    console.log('\n-- First, truncate the table');
    console.log('TRUNCATE TABLE "FilingUIConfig";');
    console.log('\n-- Then insert new records:\n');

    for (const record of newRecords) {
      const sql = `
INSERT INTO "FilingUIConfig" (
  id, country, "procedureCode", "messageName", "messageType", "transactionType",
  "configData", version, description, "isActive",
  "createdAt", "updatedAt", "createdBy", "updatedBy"
) VALUES (
  gen_random_uuid()::text,
  '${record.country}',
  '${record.procedureCode}',
  '${record.messageName}',
  '${record.messageType}',
  '${record.transactionType}',
  '${JSON.stringify(record.configData).replace(/'/g, "''")}'::jsonb,
  ${record.version},
  '${record.description?.replace(/'/g, "''")}',
  ${record.isActive},
  '${record.createdAt.toISOString()}',
  '${record.updatedAt.toISOString()}',
  ${record.createdBy ? `'${record.createdBy}'` : 'NULL'},
  '${record.updatedBy}'
);
`;
      console.log(sql);
    }

    console.log('\n---\n');
    console.log('Migration plan complete!');
    console.log('\nSteps to execute:');
    console.log('1. Run backup SQL in your database');
    console.log('2. Run: npx prisma db push --accept-data-loss');
    console.log('3. Run migration SQL in your database');
    console.log('4. Verify data looks correct');
    console.log('5. Drop backup table if satisfied');

  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateUIConfigs();
