/**
 * Schema-to-UI-Config Generator
 * 
 * This script helps generate UI configuration entries from a canonical JSON schema file.
 * When the canonical schema is extended with new fields, run this script to generate
 * the corresponding UI configuration that can be imported into the database.
 * 
 * Usage:
 *   npx tsx scripts/generate-ui-config-from-schema.ts [schema-path] [country] [procedureCode] [messageName] [messageType]
 * 
 * Example:
 *   npx tsx scripts/generate-ui-config-from-schema.ts schemas/customs-filing/filing-request-declaration/1.0.1.json NL H1 IE501 request
 * 
 * Output:
 *   Generates a JSON file with UI configuration entries that can be reviewed and imported.
 */

import * as fs from 'fs';
import * as path from 'path';

interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  $defs?: Record<string, any>;
}

interface UIConfigEntry {
  country: string;
  procedureCode: string;
  messageName: string;
  messageType: string;
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  section: string;
  displayOrder: number;
  gridColumn: number;
  isRequired: boolean;
  placeholder?: string;
  helpText?: string;
  masterDataSource?: string;
}

// Field type inference from JSON schema type
function inferFieldType(propertySchema: any): string {
  if (propertySchema.type === 'boolean') return 'checkbox';
  if (propertySchema.type === 'number' || propertySchema.type === 'integer') return 'number';
  if (propertySchema.format === 'date') return 'date';
  if (propertySchema.format === 'date-time') return 'datetime';
  if (propertySchema.enum) return 'dropdown';
  if (propertySchema.type === 'array') return 'text'; // Will need manual review
  return 'text';
}

// Convert field name to human-readable label
function toFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/_/g, ' ')
    .trim();
}

// Determine section from field path
function determineSection(fieldPath: string): string {
  if (fieldPath.includes('importer') || fieldPath.includes('exporter') || fieldPath.includes('filer')) {
    return 'parties';
  }
  if (fieldPath.includes('transport')) return 'transport';
  if (fieldPath.includes('lineItems')) return 'lineItems';
  if (fieldPath.includes('valuation')) return 'valuation';
  if (fieldPath.includes('totals')) return 'totals';
  if (fieldPath.includes('compliance')) return 'compliance';
  if (fieldPath.includes('evidence')) return 'evidence';
  if (fieldPath === 'declarationId' || fieldPath === 'entryType') return 'header';
  if (fieldPath === 'currency' || fieldPath === 'incoterm') return 'commercial';
  return 'general';
}

// Check if field should use master data lookup
function getMasterDataSource(fieldName: string, propertySchema: any): string | undefined {
  const lowerName = fieldName.toLowerCase();
  
  if (lowerName.includes('country')) return 'Country';
  if (lowerName.includes('currency')) return 'Currency';
  if (lowerName.includes('incoterm')) return 'Incoterm';
  if (lowerName.includes('mode') && propertySchema.type === 'string') return 'TransportMode';
  if (lowerName.includes('hscode') || lowerName === 'hsCode6') return 'HSCode';
  if (lowerName.includes('uom') || lowerName === 'unitOfMeasure') return 'UOM';
  if (lowerName.includes('valuation') && lowerName.includes('method')) return 'ValuationMethod';
  
  return undefined;
}

// Parse JSON schema and generate UI config
function generateUIConfig(
  schema: JSONSchema,
  country: string,
  procedureCode: string,
  messageName: string,
  messageType: string
): UIConfigEntry[] {
  const configs: UIConfigEntry[] = [];
  let displayOrder = 0;

  function processProperty(
    fieldPath: string,
    propertySchema: any,
    isRequired: boolean,
    parentPath: string = ''
  ) {
    const fullPath = parentPath ? `${parentPath}.${fieldPath}` : fieldPath;
    
    // Handle object properties (nested)
    if (propertySchema.type === 'object' && propertySchema.properties) {
      const nestedRequired = propertySchema.required || [];
      Object.entries(propertySchema.properties).forEach(([nestedKey, nestedSchema]) => {
        processProperty(nestedKey, nestedSchema, nestedRequired.includes(nestedKey), fullPath);
      });
      return;
    }

    // Handle array items
    if (propertySchema.type === 'array' && propertySchema.items) {
      if (propertySchema.items.type === 'object' && propertySchema.items.properties) {
        const itemRequired = propertySchema.items.required || [];
        Object.entries(propertySchema.items.properties).forEach(([itemKey, itemSchema]) => {
          processProperty(itemKey, itemSchema, itemRequired.includes(itemKey), `${fullPath}[]`);
        });
      }
      return;
    }

    // Handle $ref (definitions)
    if (propertySchema.$ref) {
      const refPath = propertySchema.$ref.replace('#/$defs/', '');
      if (schema.$defs && schema.$defs[refPath]) {
        const defSchema = schema.$defs[refPath];
        if (defSchema.type === 'object' && defSchema.properties) {
          const defRequired = defSchema.required || [];
          Object.entries(defSchema.properties).forEach(([defKey, defSchema]) => {
            processProperty(defKey, defSchema, defRequired.includes(defKey), fullPath);
          });
        }
      }
      return;
    }

    // Create UI config entry
    const fieldType = inferFieldType(propertySchema);
    const masterDataSource = fieldType === 'dropdown' || fieldType === 'text' 
      ? getMasterDataSource(fieldPath, propertySchema) 
      : undefined;

    configs.push({
      country,
      procedureCode,
      messageName,
      messageType,
      fieldPath: fullPath,
      fieldLabel: toFieldLabel(fieldPath),
      fieldType: masterDataSource ? (masterDataSource === 'HSCode' ? 'lookup' : 'dropdown') : fieldType,
      section: determineSection(fullPath),
      displayOrder: displayOrder++,
      gridColumn: fieldType === 'textarea' ? 12 : fieldType === 'checkbox' ? 12 : 6,
      isRequired,
      placeholder: propertySchema.description || undefined,
      helpText: propertySchema.description || undefined,
      masterDataSource,
    });
  }

  // Process root level properties
  const requiredFields = schema.required || [];
  if (schema.properties) {
    Object.entries(schema.properties).forEach(([key, propertySchema]) => {
      processProperty(key, propertySchema, requiredFields.includes(key));
    });
  }

  // Sort by section and display order
  configs.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.displayOrder - b.displayOrder;
  });

  // Renumber display orders within sections
  let currentSection = '';
  let sectionOrder = 0;
  configs.forEach(config => {
    if (config.section !== currentSection) {
      currentSection = config.section;
      sectionOrder = 0;
    }
    config.displayOrder = sectionOrder++;
  });

  return configs;
}

// Main function
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 5) {
    console.error('Usage: npx tsx scripts/generate-ui-config-from-schema.ts <schema-path> <country> <procedureCode> <messageName> <messageType>');
    console.error('Example: npx tsx scripts/generate-ui-config-from-schema.ts schemas/customs-filing/filing-request-declaration/1.0.1.json NL H1 IE501 request');
    process.exit(1);
  }

  const [schemaPath, country, procedureCode, messageName, messageType] = args;

  // Validate messageType
  if (messageType !== 'request' && messageType !== 'response') {
    console.error('Error: messageType must be "request" or "response"');
    process.exit(1);
  }

  // Read schema file
  if (!fs.existsSync(schemaPath)) {
    console.error(`Error: Schema file not found: ${schemaPath}`);
    process.exit(1);
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const schema: JSONSchema = JSON.parse(schemaContent);

  // Generate UI config
  console.log(`\n🔧 Generating UI configuration from schema...`);
  console.log(`   Schema: ${schemaPath}`);
  console.log(`   Target: ${country}/${procedureCode}/${messageName} (${messageType})\n`);

  const configs = generateUIConfig(schema, country, procedureCode, messageName, messageType);

  // Output results
  const outputFilename = `ui-config-${country}-${procedureCode}-${messageName}-${messageType}.json`;
  const outputPath = path.join(process.cwd(), 'scripts', 'generated', outputFilename);

  // Create generated directory if it doesn't exist
  const generatedDir = path.join(process.cwd(), 'scripts', 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(configs, null, 2));

  console.log(`✅ Generated ${configs.length} UI configuration entries`);
  console.log(`📄 Output saved to: ${outputPath}\n`);
  console.log(`Next steps:`);
  console.log(`1. Review the generated configuration file`);
  console.log(`2. Adjust field types, sections, and master data sources as needed`);
  console.log(`3. Import into database using the Filing Configuration UI`);
  console.log(`4. Or create a seed script from this output\n`);

  // Print summary by section
  const sectionSummary = configs.reduce((acc, config) => {
    acc[config.section] = (acc[config.section] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Summary by section:`);
  Object.entries(sectionSummary).forEach(([section, count]) => {
    console.log(`   ${section}: ${count} fields`);
  });
}

main();
