/**
 * Shapes shared across the shipment workspace panels.
 *
 * These panels used `any[]` for the same three shapes in five different files,
 * so a field renamed in one place produced no error in the others. Declaring
 * them once is type-level only: nothing here changes what the panels render.
 */

/**
 * A line item as the workspace panels receive it.
 *
 * `unitPrice` and `totalValue` are numbers, not Prisma `Decimal`s: the server
 * component converts them with `Number(...)` before passing them down, because a
 * Decimal cannot cross the server/client boundary.
 */
export interface ShipmentLineItemRow {
  id: string;
  lineNumber: number;
  partNumber?: string | null;
  description: string;
  quantity: number;
  /**
   * Null when the source never carried a price — extraction routinely recovers a
   * line's total without its unit price, and vice versa. Coercing either to 0
   * makes an unknown amount render as a real "0.00", so the absence survives to
   * the renderer and shows as missing instead.
   */
  unitPrice: number | null;
  totalValue: number | null;
  countryOfOrigin: string;
  htsCode: string;
  htsConfidence?: number | null;
  productId?: string | null;
  status?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/**
 * A line item as persisted inside a document's `extractedJson`.
 *
 * Historical rows carry either the current `totalAmount`/`sku` names or the older
 * `totalValue`/`partNumber` ones, so both are accepted and readers fall back
 * across them. Numbers may arrive as strings from the extractor, which is why
 * `numberOrNull` is applied at every use.
 */
export interface ExtractedLineItem {
  lineNumber?: number | null;
  sku?: string | null;
  partNumber?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  totalAmount?: number | string | null;
  totalValue?: number | string | null;
  countryOfOrigin?: string | null;
  htsCode?: string | null;
}

/** Reads a numeric field that may be absent, keeping "missing" distinct from 0. */
export function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

/**
 * A line's extended amount, or null when no source carried one.
 *
 * Prefers the total the document stated over one multiplied out here — the two
 * disagree whenever the invoice discounts a line or prices per pack. Falls back
 * to quantity x unit price only when a unit price is genuinely present. A real 0
 * survives every branch, because a free-of-charge line is a fact, while an
 * unknown amount rendered as "0.00" is a false one.
 */
export function extendedAmount(item: {
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
}): number | null {
  if (item.totalValue !== null && item.totalValue !== undefined) return item.totalValue;
  if (item.unitPrice === null || item.unitPrice === undefined) return null;
  return Number(item.quantity) * item.unitPrice;
}

/**
 * One autocomplete result from `/api/v1/hts/search`.
 *
 * Both the inline line-item editor and the exception resolution modal render the
 * same three fields from it.
 */
export interface HtsSuggestion {
  id: string;
  htsNumberDisplay: string;
  description: string;
}

/** An open `ExceptionItem` row, limited to the fields the drawer reads. */
export interface DbExceptionItem {
  id: string;
  version: number;
  status?: string | null;
  description: string;
  /**
   * Which agent raised it. The drawer trusts the real `category` column instead
   * of description keywords for Compliance Agent findings, whose wording can
   * coincidentally match another rule's phrase.
   */
  sourceAgent?: string | null;
  category?: string | null;
  severity?: string | null;
}

/**
 * A drawer card that maps to a real `ExceptionItem` row, so it carries the ids
 * the resolution modal needs to write back.
 */
export interface ResolvableException {
  id: string;
  dbId: string;
  version: number;
  category: string;
  title: string;
  desc: string;
  actionText: string;
  actionType: string;
}

/**
 * One card rendered in the exceptions drawer.
 *
 * `actionType` and `actionHref` are both optional because the two kinds of card
 * differ in exactly that way, and the render branches on it: a card with an
 * `actionType` opens a resolution flow, a card without one links out via
 * `actionHref`. `dbId`/`version` are absent on synthetic cards (a required
 * document that was never uploaded has no exception row to resolve), and are
 * left undefined rather than filled with a placeholder id.
 */
export interface ExceptionCard {
  id: string;
  category: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  actionText: string;
  actionType?: string;
  actionHref?: string;
  dbId?: string;
  version?: number;
}

/** True when a card carries the ids the resolution modal writes back with. */
export function isResolvableException(card: ExceptionCard): card is ExceptionCard & ResolvableException {
  return (
    typeof card.dbId === "string" &&
    typeof card.version === "number" &&
    typeof card.actionType === "string"
  );
}
