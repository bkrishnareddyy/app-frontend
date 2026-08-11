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
  unitPrice: number;
  totalValue: number;
  countryOfOrigin: string;
  htsCode: string;
  htsConfidence: number;
  status?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
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
