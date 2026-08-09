/**
 * Builds the tenant-scoped URL used to view or download a stored document.
 *
 * Only the document id is sent; the server resolves the real storage location
 * from the tenant's own record.
 */
export function documentViewUrl(documentId: string): string {
  return `/api/documents/proxy?documentId=${encodeURIComponent(documentId)}`;
}
