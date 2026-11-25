import { applyDiscount } from "./money.js";

export interface LineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

/** Commercial terms: everything a manager decision covers. */
export interface CommercialTerms {
  items: LineItem[];
  discountBps: number;
}

export interface QuoteTotals {
  grossRevenueCents: number;
  netRevenueCents: number;
  totalCostCents: number;
  discountBps: number;
  /** (net − cost) / net, unrounded. Undefined when net revenue is zero. */
  margin: number | undefined;
}

export function calculateTotals(terms: CommercialTerms): QuoteTotals {
  let grossRevenueCents = 0;
  let totalCostCents = 0;
  for (const item of terms.items) {
    grossRevenueCents += item.quantity * item.unitPriceCents;
    totalCostCents += item.quantity * item.unitCostCents;
  }
  // The discount reduces price, never cost.
  const netRevenueCents = applyDiscount(grossRevenueCents, terms.discountBps);
  const margin =
    netRevenueCents > 0 ? (netRevenueCents - totalCostCents) / netRevenueCents : undefined;
  return { grossRevenueCents, netRevenueCents, totalCostCents, discountBps: terms.discountBps, margin };
}
