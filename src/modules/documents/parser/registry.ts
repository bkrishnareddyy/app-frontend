/**
 * Resolves the configured document parser provider.
 *
 * This is the single place a `DocumentParserProvider` is constructed, so the
 * production-safety rule — a mock provider must never serve production traffic —
 * is enforced once rather than trusted to every call site.
 */

import { DocumentParserError, type DocumentParserProvider } from "./contracts";
import { selectedProviderId, type ParserProviderId } from "./config";
import { IbmHostedDoclingProvider } from "./ibm/ibmHostedDoclingProvider";
import { MockDoclingProvider } from "./mock/mockDoclingProvider";
import { isProductionEnvironment } from "@/lib/environment";

/**
 * Returns the configured provider, or throws PARSER_NOT_CONFIGURED.
 *
 * Deliberately throws rather than returning null: a caller that forgets a null
 * check would otherwise skip parsing silently, and a document that was never
 * parsed would sit in the console looking merely slow.
 */
export function getDocumentParserProvider(): DocumentParserProvider {
  const id: ParserProviderId = selectedProviderId();

  if (id === "ibm-docling") {
    return new IbmHostedDoclingProvider();
  }

  if (id === "mock") {
    if (isProductionEnvironment()) {
      throw new DocumentParserError(
        "PARSER_NOT_CONFIGURED",
        "DOCUMENT_PARSER_PROVIDER=mock is not permitted in a production environment."
      );
    }
    return new MockDoclingProvider();
  }

  throw new DocumentParserError(
    "PARSER_NOT_CONFIGURED",
    "No document parser provider is configured. Set DOCUMENT_PARSER_PROVIDER=ibm-docling (production) or =mock (local development)."
  );
}

/** True when a provider can be resolved. Used by health reporting, not control flow. */
export function isDocumentParsingEnabled(): boolean {
  try {
    getDocumentParserProvider();
    return true;
  } catch {
    return false;
  }
}
