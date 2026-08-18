/**
 * Seed script for UI Configuration (Netherlands Import procedures)
 * 
 * Generates UI field configurations for NL Import filing procedures (H1, H4, H7)
 * based on the canonical schema v1.0.1 for both request and response messages.
 * 
 * This script creates comprehensive UI configurations that define:
 * - Field types (text, number, date, dropdown, lookup, etc.)
 * - Field layout (sections, display order, grid columns)
 * - Validation rules (required, read-only)
 * - Master data sources for dropdowns/lookups
 * 
 * Run with: npx tsx scripts/seed-ui-config-nl-import.ts
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Configuration for NL Import procedures
const PROCEDURES = [
  { code: 'H1', messageName: 'IE501', description: 'Standard Import Declaration' },
  { code: 'H4', messageName: 'IE503', description: 'Simplified Import Declaration' },
  { code: 'H7', messageName: 'IE504', description: 'Low Value Consignment' },
];

const COUNTRY = 'NL';

interface UIFieldConfig {
  fieldPath: string;
  fieldLabel: string;
  fieldType: 'text' | 'number' | 'date' | 'datetime' | 'checkbox' | 'textarea' | 'dropdown' | 'lookup';
  section: string;
  displayOrder: number;
  gridColumn?: number;
  isRequired?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  helpText?: string;
  masterDataSource?: string;
  isMultiSelect?: boolean;
  isArrayField?: boolean;
}

// Define field configurations for REQUEST message type
const REQUEST_FIELDS: UIFieldConfig[] = [
  // Root level fields
  { fieldPath: 'declarationId', fieldLabel: 'Declaration ID', fieldType: 'text', section: 'header', displayOrder: 1, gridColumn: 6, isRequired: true, placeholder: 'Unique declaration identifier' },
  { fieldPath: 'entryType', fieldLabel: 'Entry Type', fieldType: 'text', section: 'header', displayOrder: 2, gridColumn: 6, isRequired: true, placeholder: 'Declaration/regime classification code' },

  // Importer party
  { fieldPath: 'importer.name', fieldLabel: 'Importer Name', fieldType: 'text', section: 'parties', displayOrder: 10, gridColumn: 4, placeholder: 'Legal name of importer' },
  { fieldPath: 'importer.country', fieldLabel: 'Importer Country', fieldType: 'lookup', section: 'parties', displayOrder: 11, gridColumn: 4, masterDataSource: 'Country', placeholder: 'ISO 2-letter code' },
  { fieldPath: 'importer.taxId', fieldLabel: 'Importer Tax ID / EORI', fieldType: 'text', section: 'parties', displayOrder: 12, gridColumn: 4, placeholder: 'Tax identifier or EORI number' },

  // Exporter party
  { fieldPath: 'exporter.name', fieldLabel: 'Exporter Name', fieldType: 'text', section: 'parties', displayOrder: 20, gridColumn: 4, placeholder: 'Legal name of exporter' },
  { fieldPath: 'exporter.country', fieldLabel: 'Exporter Country', fieldType: 'lookup', section: 'parties', displayOrder: 21, gridColumn: 4, masterDataSource: 'Country', placeholder: 'ISO 2-letter code' },
  { fieldPath: 'exporter.taxId', fieldLabel: 'Exporter Tax ID', fieldType: 'text', section: 'parties', displayOrder: 22, gridColumn: 4, placeholder: 'Tax identifier' },

  // Filer party
  { fieldPath: 'filer.name', fieldLabel: 'Filer Name (Declarant)', fieldType: 'text', section: 'parties', displayOrder: 30, gridColumn: 4, placeholder: 'Legal name of declarant' },
  { fieldPath: 'filer.country', fieldLabel: 'Filer Country', fieldType: 'lookup', section: 'parties', displayOrder: 31, gridColumn: 4, masterDataSource: 'Country', placeholder: 'ISO 2-letter code' },
  { fieldPath: 'filer.taxId', fieldLabel: 'Filer Tax ID / EORI', fieldType: 'text', section: 'parties', displayOrder: 32, gridColumn: 4, placeholder: 'Tax identifier or EORI number' },

  // Transport
  { fieldPath: 'transport.mode', fieldLabel: 'Transport Mode', fieldType: 'dropdown', section: 'transport', displayOrder: 40, gridColumn: 3, masterDataSource: 'TransportMode', placeholder: 'Road, Sea, Air, Rail' },
  { fieldPath: 'transport.carrierName', fieldLabel: 'Carrier Name', fieldType: 'text', section: 'transport', displayOrder: 41, gridColumn: 3, placeholder: 'Transport company' },
  { fieldPath: 'transport.vessel', fieldLabel: 'Vessel / Vehicle', fieldType: 'text', section: 'transport', displayOrder: 42, gridColumn: 3, placeholder: 'Vessel name or vehicle ID' },
  { fieldPath: 'transport.portOfEntry', fieldLabel: 'Port of Entry', fieldType: 'text', section: 'transport', displayOrder: 43, gridColumn: 3, placeholder: 'Port or border crossing' },
  { fieldPath: 'transport.arrivalDate', fieldLabel: 'Arrival Date', fieldType: 'datetime', section: 'transport', displayOrder: 44, gridColumn: 3 },

  // Commercial details
  { fieldPath: 'currency', fieldLabel: 'Currency', fieldType: 'lookup', section: 'commercial', displayOrder: 50, gridColumn: 6, isRequired: true, masterDataSource: 'Currency', placeholder: '3-letter code (e.g., EUR)' },
  { fieldPath: 'incoterm', fieldLabel: 'Incoterm', fieldType: 'dropdown', section: 'commercial', displayOrder: 51, gridColumn: 6, masterDataSource: 'Incoterm', placeholder: 'e.g., CIF, FOB, DAP' },

  // Line items (array fields)
  { fieldPath: 'lineItems[].lineNumber', fieldLabel: 'Line Number', fieldType: 'number', section: 'lineItems', displayOrder: 60, gridColumn: 2, isRequired: true, isArrayField: true },
  { fieldPath: 'lineItems[].description', fieldLabel: 'Description', fieldType: 'text', section: 'lineItems', displayOrder: 61, gridColumn: 4, isRequired: true, isArrayField: true },
  { fieldPath: 'lineItems[].hsCode6', fieldLabel: 'HS Code (6-digit)', fieldType: 'lookup', section: 'lineItems', displayOrder: 62, gridColumn: 3, isRequired: true, masterDataSource: 'HSCode', isArrayField: true },
  { fieldPath: 'lineItems[].nationalTariffSuffix', fieldLabel: 'National Tariff Suffix', fieldType: 'text', section: 'lineItems', displayOrder: 63, gridColumn: 3, isArrayField: true },
  { fieldPath: 'lineItems[].originCountry', fieldLabel: 'Origin Country', fieldType: 'lookup', section: 'lineItems', displayOrder: 64, gridColumn: 3, isRequired: true, masterDataSource: 'Country', isArrayField: true },
  { fieldPath: 'lineItems[].quantity.value', fieldLabel: 'Quantity', fieldType: 'number', section: 'lineItems', displayOrder: 65, gridColumn: 3, isRequired: true, isArrayField: true },
  { fieldPath: 'lineItems[].quantity.uom', fieldLabel: 'UOM', fieldType: 'lookup', section: 'lineItems', displayOrder: 66, gridColumn: 3, isRequired: true, masterDataSource: 'UOM', isArrayField: true },
  { fieldPath: 'lineItems[].unitPrice', fieldLabel: 'Unit Price', fieldType: 'number', section: 'lineItems', displayOrder: 67, gridColumn: 3, isRequired: true, isArrayField: true },
  { fieldPath: 'lineItems[].totalValue', fieldLabel: 'Total Value', fieldType: 'number', section: 'lineItems', displayOrder: 68, gridColumn: 3, isRequired: true, isArrayField: true },
  { fieldPath: 'lineItems[].eccnCode', fieldLabel: 'ECCN Code', fieldType: 'text', section: 'lineItems', displayOrder: 69, gridColumn: 3, isArrayField: true, helpText: 'Export Control Classification Number' },

  // Valuation
  { fieldPath: 'valuation.method', fieldLabel: 'Valuation Method', fieldType: 'dropdown', section: 'valuation', displayOrder: 70, gridColumn: 6, isRequired: true, masterDataSource: 'ValuationMethod', placeholder: 'e.g., Transaction Value' },
  { fieldPath: 'valuation.totalValue', fieldLabel: 'Total Value', fieldType: 'number', section: 'valuation', displayOrder: 71, gridColumn: 6, isRequired: true },

  // Totals
  { fieldPath: 'totals.customsValue', fieldLabel: 'Customs Value', fieldType: 'number', section: 'totals', displayOrder: 80, gridColumn: 4, isRequired: true },
  { fieldPath: 'totals.dutyAmount', fieldLabel: 'Duty Amount', fieldType: 'number', section: 'totals', displayOrder: 81, gridColumn: 4 },
  { fieldPath: 'totals.feesAmount', fieldLabel: 'Fees Amount', fieldType: 'number', section: 'totals', displayOrder: 82, gridColumn: 4 },

  // Compliance
  { fieldPath: 'compliance.screeningCleared', fieldLabel: 'Sanctions/Denied-Party Screening Cleared', fieldType: 'checkbox', section: 'compliance', displayOrder: 90, gridColumn: 12 },
  { fieldPath: 'compliance.licensesRequired', fieldLabel: 'Licenses Required', fieldType: 'text', section: 'compliance', displayOrder: 91, gridColumn: 12, isMultiSelect: true, helpText: 'Comma-separated license codes. Leave empty if no special licenses required.' },

  // Evidence
  { fieldPath: 'evidence.classificationRationale', fieldLabel: 'Classification Rationale', fieldType: 'textarea', section: 'evidence', displayOrder: 100, gridColumn: 12, helpText: 'Explain the basis for tariff classification' },
  { fieldPath: 'evidence.originCriterion', fieldLabel: 'Origin Criterion', fieldType: 'text', section: 'evidence', displayOrder: 101, gridColumn: 6, helpText: 'Basis for country of origin determination' },
  { fieldPath: 'evidence.sourceDocumentIds', fieldLabel: 'Source Document IDs', fieldType: 'text', section: 'evidence', displayOrder: 102, gridColumn: 6, isMultiSelect: true, helpText: 'Comma-separated document reference IDs' },
];

// Define field configurations for RESPONSE message type
const RESPONSE_FIELDS: UIFieldConfig[] = [
  // Response header fields
  { fieldPath: 'responseId', fieldLabel: 'Response ID', fieldType: 'text', section: 'header', displayOrder: 1, gridColumn: 6, isReadOnly: true },
  { fieldPath: 'declarationId', fieldLabel: 'Declaration ID', fieldType: 'text', section: 'header', displayOrder: 2, gridColumn: 6, isReadOnly: true },
  { fieldPath: 'status', fieldLabel: 'Status', fieldType: 'text', section: 'header', displayOrder: 3, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'statusDate', fieldLabel: 'Status Date', fieldType: 'datetime', section: 'header', displayOrder: 4, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'authorityReference', fieldLabel: 'Authority Reference (MRN)', fieldType: 'text', section: 'header', displayOrder: 5, gridColumn: 4, isReadOnly: true, helpText: 'Movement Reference Number assigned by customs' },

  // Assessment results
  { fieldPath: 'assessment.totalDuty', fieldLabel: 'Total Duty', fieldType: 'number', section: 'assessment', displayOrder: 10, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'assessment.totalVAT', fieldLabel: 'Total VAT', fieldType: 'number', section: 'assessment', displayOrder: 11, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'assessment.totalFees', fieldLabel: 'Total Fees', fieldType: 'number', section: 'assessment', displayOrder: 12, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'assessment.currency', fieldLabel: 'Currency', fieldType: 'text', section: 'assessment', displayOrder: 13, gridColumn: 3, isReadOnly: true },
  { fieldPath: 'assessment.paymentDueDate', fieldLabel: 'Payment Due Date', fieldType: 'date', section: 'assessment', displayOrder: 14, gridColumn: 3, isReadOnly: true },

  // Release information
  { fieldPath: 'release.status', fieldLabel: 'Release Status', fieldType: 'text', section: 'release', displayOrder: 20, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'release.releaseDate', fieldLabel: 'Release Date', fieldType: 'datetime', section: 'release', displayOrder: 21, gridColumn: 4, isReadOnly: true },
  { fieldPath: 'release.conditions', fieldLabel: 'Release Conditions', fieldType: 'textarea', section: 'release', displayOrder: 22, gridColumn: 12, isReadOnly: true },

  // Errors/warnings
  { fieldPath: 'errors[].code', fieldLabel: 'Error Code', fieldType: 'text', section: 'errors', displayOrder: 30, gridColumn: 3, isReadOnly: true, isArrayField: true },
  { fieldPath: 'errors[].description', fieldLabel: 'Error Description', fieldType: 'textarea', section: 'errors', displayOrder: 31, gridColumn: 9, isReadOnly: true, isArrayField: true },

  // Notes/remarks
  { fieldPath: 'remarks', fieldLabel: 'Authority Remarks', fieldType: 'textarea', section: 'notes', displayOrder: 40, gridColumn: 12, isReadOnly: true },
];

async function seedUIConfiguration() {
  console.log('🌱 Seeding UI Configuration for Netherlands Import procedures...\n');

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const procedure of PROCEDURES) {
    console.log(`📋 Processing procedure ${procedure.code} (${procedure.messageName})...`);

    // Seed REQUEST fields
    console.log(`   Creating ${REQUEST_FIELDS.length} REQUEST field configs...`);
    for (const field of REQUEST_FIELDS) {
      const existing = await db.filingUIConfig.findUnique({
        where: {
          country_procedureCode_messageName_messageType_fieldPath: {
            country: COUNTRY,
            procedureCode: procedure.code,
            messageName: procedure.messageName,
            messageType: 'request',
            fieldPath: field.fieldPath,
          },
        },
      });

      if (existing) {
        totalSkipped++;
        continue;
      }

      await db.filingUIConfig.create({
        data: {
          country: COUNTRY,
          procedureCode: procedure.code,
          messageName: procedure.messageName,
          messageType: 'request',
          fieldPath: field.fieldPath,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          section: field.section,
          displayOrder: field.displayOrder,
          gridColumn: field.gridColumn || 12,
          isRequired: field.isRequired || false,
          isReadOnly: field.isReadOnly || false,
          isVisible: true,
          placeholder: field.placeholder || null,
          helpText: field.helpText || null,
          masterDataSource: field.masterDataSource || null,
          isMultiSelect: field.isMultiSelect || false,
          isArrayField: field.isArrayField || false,
        },
      });
      totalCreated++;
    }

    // Seed RESPONSE fields
    console.log(`   Creating ${RESPONSE_FIELDS.length} RESPONSE field configs...`);
    for (const field of RESPONSE_FIELDS) {
      const existing = await db.filingUIConfig.findUnique({
        where: {
          country_procedureCode_messageName_messageType_fieldPath: {
            country: COUNTRY,
            procedureCode: procedure.code,
            messageName: procedure.messageName,
            messageType: 'response',
            fieldPath: field.fieldPath,
          },
        },
      });

      if (existing) {
        totalSkipped++;
        continue;
      }

      await db.filingUIConfig.create({
        data: {
          country: COUNTRY,
          procedureCode: procedure.code,
          messageName: procedure.messageName,
          messageType: 'response',
          fieldPath: field.fieldPath,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          section: field.section,
          displayOrder: field.displayOrder,
          gridColumn: field.gridColumn || 12,
          isRequired: field.isRequired || false,
          isReadOnly: field.isReadOnly || false,
          isVisible: true,
          placeholder: field.placeholder || null,
          helpText: field.helpText || null,
          masterDataSource: field.masterDataSource || null,
          isMultiSelect: field.isMultiSelect || false,
          isArrayField: field.isArrayField || false,
        },
      });
      totalCreated++;
    }

    console.log(`   ✓ Completed ${procedure.code}\n`);
  }

  console.log(`\n✅ UI Configuration seeding complete!`);
  console.log(`   Created: ${totalCreated} field configs`);
  console.log(`   Skipped: ${totalSkipped} (already exist)`);
}

async function seedMasterDataSources() {
  console.log('\n🗂️  Seeding Master Data Sources...\n');

  const sources = [
    { sourceName: 'Country', sourceType: 'static', staticOptions: [
      { value: 'NL', label: 'Netherlands' },
      { value: 'CN', label: 'China' },
      { value: 'US', label: 'United States' },
      { value: 'DE', label: 'Germany' },
      { value: 'FR', label: 'France' },
      { value: 'GB', label: 'United Kingdom' },
      { value: 'IN', label: 'India' },
      { value: 'JP', label: 'Japan' },
    ] as any },
    { sourceName: 'Currency', sourceType: 'static', staticOptions: [
      { value: 'EUR', label: 'Euro (EUR)' },
      { value: 'USD', label: 'US Dollar (USD)' },
      { value: 'GBP', label: 'British Pound (GBP)' },
      { value: 'CNY', label: 'Chinese Yuan (CNY)' },
      { value: 'JPY', label: 'Japanese Yen (JPY)' },
      { value: 'INR', label: 'Indian Rupee (INR)' },
    ] as any },
    { sourceName: 'TransportMode', sourceType: 'static', staticOptions: [
      { value: 'ROAD', label: 'Road' },
      { value: 'SEA', label: 'Sea' },
      { value: 'AIR', label: 'Air' },
      { value: 'RAIL', label: 'Rail' },
      { value: 'MULTIMODAL', label: 'Multimodal' },
    ] as any },
    { sourceName: 'Incoterm', sourceType: 'static', staticOptions: [
      { value: 'CIF', label: 'CIF - Cost, Insurance and Freight' },
      { value: 'FOB', label: 'FOB - Free On Board' },
      { value: 'DAP', label: 'DAP - Delivered At Place' },
      { value: 'DDP', label: 'DDP - Delivered Duty Paid' },
      { value: 'EXW', label: 'EXW - Ex Works' },
      { value: 'FCA', label: 'FCA - Free Carrier' },
    ] as any },
    { sourceName: 'ValuationMethod', sourceType: 'static', staticOptions: [
      { value: 'TRANSACTION_VALUE', label: 'Transaction Value (Method 1)' },
      { value: 'IDENTICAL_GOODS', label: 'Identical Goods (Method 2)' },
      { value: 'SIMILAR_GOODS', label: 'Similar Goods (Method 3)' },
      { value: 'DEDUCTIVE', label: 'Deductive (Method 4)' },
      { value: 'COMPUTED', label: 'Computed (Method 5)' },
      { value: 'FALLBACK', label: 'Fallback (Method 6)' },
    ] as any },
    { sourceName: 'UOM', sourceType: 'static', staticOptions: [
      { value: 'KG', label: 'Kilograms (KG)' },
      { value: 'LB', label: 'Pounds (LB)' },
      { value: 'PCS', label: 'Pieces (PCS)' },
      { value: 'M', label: 'Meters (M)' },
      { value: 'L', label: 'Liters (L)' },
      { value: 'CBM', label: 'Cubic Meters (CBM)' },
    ] as any },
    { sourceName: 'HSCode', sourceType: 'api', apiEndpoint: '/api/master-data/hs-code', apiMethod: 'GET' },
  ];

  let created = 0;
  let skipped = 0;

  for (const source of sources) {
    const existing = await db.filingMasterDataSource.findUnique({
      where: { sourceName: source.sourceName },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await db.filingMasterDataSource.create({
      data: {
        sourceName: source.sourceName,
        sourceType: source.sourceType as any,
        staticOptions: source.staticOptions || null,
        apiEndpoint: source.apiEndpoint || null,
        apiMethod: source.apiMethod || 'GET',
        isActive: true,
      },
    });
    created++;
    console.log(`   ✓ Created ${source.sourceName}`);
  }

  console.log(`\n✅ Master Data Sources seeding complete!`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped} (already exist)`);
}

async function main() {
  try {
    await seedMasterDataSources();
    await seedUIConfiguration();
    console.log('\n🎉 All seeding tasks completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  } finally {
    await db.$disconnect();
  }
}

main();
