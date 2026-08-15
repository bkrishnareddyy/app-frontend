import { db } from "@/lib/db";
import type { FilingMessageAction } from "./types";

export interface MessageContextInput {
  /** 
   * Transaction type (IMPORT, EXPORT, NCTS, etc.) - replaces US-centric entryType.
   * Required for new multi-country design.
   */
  transactionType: string | null | undefined;
  
  /** 
   * Country-specific procedure code (e.g., "5100" for NL NCTS, "4000" for IN Import).
   * Required for new multi-country design.
   */
  procedureCode: string | null | undefined;
  
  /** ISO 3166-1 alpha-2 country code (NL, IE, FR, IN, etc.) */
  country: string | null | undefined;
}

export interface ResolvedMessageContext {
  transactionType: string;
  country: string;
  procedure: string;
  messageName: string;
}

/**
 * Derives country/procedure/messageName from filing data and the new
 * multi-country configuration tables (FilingProcedureConfig, FilingActionMessageMapping).
 * 
 * Replaces the old US-centric approach that used entryType + FilingProcedureMapping
 * + FilingMessageCatalog.
 * 
 * No caller may hardcode any of these values -- this is the single resolution point.
 */
export async function resolveMessageContext(
  input: MessageContextInput,
  action: FilingMessageAction
): Promise<ResolvedMessageContext> {
  // Validate required inputs
  const country = input.country?.trim().toUpperCase();
  if (!country) {
    throw new Error(
      "Cannot resolve message context: country is not set. " +
        "The destination country is never inferred -- set it explicitly."
    );
  }

  const procedureCode = input.procedureCode?.trim();
  if (!procedureCode) {
    throw new Error(
      "Cannot resolve message context: procedureCode is not set. " +
        "Set the country-specific procedure code explicitly (e.g., '5100' for NL NCTS)."
    );
  }

  const transactionType = input.transactionType?.trim().toUpperCase();
  if (!transactionType) {
    throw new Error(
      "Cannot resolve message context: transactionType is not set. " +
        "Set the transaction type (IMPORT, EXPORT, NCTS, etc.) explicitly."
    );
  }

  // Verify the transaction type exists
  const txType = await db.filingTransactionType.findUnique({
    where: { code: transactionType, isActive: true },
  });
  if (!txType) {
    throw new Error(
      `Transaction type "${transactionType}" not found or inactive. ` +
        `Valid types: IMPORT, EXPORT, NCTS, TEMP_STORAGE, BONDED_WAREHOUSE, etc.`
    );
  }

  // Look up the action → messageName mapping
  const actionMapping = await db.filingActionMessageMapping.findUnique({
    where: {
      country_procedureCode_action: {
        country,
        procedureCode,
        action,
      },
      isActive: true,
    },
  });

  if (!actionMapping) {
    // BACKWARDS COMPATIBILITY: Handle old US filings that haven't been migrated yet
    if (country === "US") {
      console.warn(
        `[resolveMessageContext] No action mapping found for US filing with ` +
        `procedureCode="${procedureCode}", action="${action}". ` +
        `This is expected for old filings not yet migrated. Using fallback.`
      );
      
      // Return fallback for US CBP entries (old system)
      return {
        transactionType,
        country,
        procedure: procedureCode,
        messageName: "CBP_ENTRY_7501", // Generic US entry message (Form 7501)
      };
    }
    
    throw new Error(
      `No message mapping found for action "${action}", country "${country}", ` +
        `procedure "${procedureCode}". Add FilingActionMessageMapping configuration ` +
        `before filing to this destination.`
    );
  }

  // Verify the procedure + messageName combination exists
  const procedureConfig = await db.filingProcedureConfig.findUnique({
    where: {
      country_procedureCode_messageName: {
        country,
        procedureCode,
        messageName: actionMapping.messageName,
      },
      isActive: true,
    },
  });

  if (!procedureConfig) {
    // BACKWARDS COMPATIBILITY: Skip validation for old US filings
    if (country === "US") {
      console.warn(
        `[resolveMessageContext] No procedure config found for US filing with ` +
        `procedureCode="${procedureCode}", messageName="${actionMapping.messageName}". ` +
        `This is expected for old filings not yet migrated. Skipping validation.`
      );
      
      return {
        transactionType,
        country,
        procedure: procedureCode,
        messageName: actionMapping.messageName,
      };
    }
    
    throw new Error(
      `Procedure configuration not found for country "${country}", ` +
        `procedure "${procedureCode}", message "${actionMapping.messageName}". ` +
        `Add FilingProcedureConfig row before filing.`
    );
  }

  return {
    transactionType,
    country,
    procedure: procedureCode,
    messageName: actionMapping.messageName,
  };
}
