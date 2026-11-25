import type { QuoteTotals } from "./calc.js";
import { formatBps, formatPercent } from "./money.js";

/** The single source of the approval thresholds. */
export const APPROVAL_RULE = {
  minMarginBps: 3000, // margin must be >= 30%
  maxDiscountBps: 1500, // discount must be <= 15%
} as const;

export const NO_REVENUE_MESSAGE = "No revenue: margin cannot be calculated";

export interface RuleEvaluation {
  requiresReview: boolean;
  /** Human-readable explanation of why the quote can proceed or needs review. */
  explanation: string;
}

export function evaluateRule(totals: QuoteTotals): RuleEvaluation {
  const minMargin = formatBps(APPROVAL_RULE.minMarginBps);
  const maxDiscount = formatBps(APPROVAL_RULE.maxDiscountBps);
  const discount = formatBps(totals.discountBps);
  const discountOk = totals.discountBps <= APPROVAL_RULE.maxDiscountBps;
  const discountText = discountOk
    ? `discount ${discount} is within the ${maxDiscount} maximum`
    : `discount ${discount} exceeds the ${maxDiscount} maximum`;

  if (totals.margin === undefined) {
    return { requiresReview: true, explanation: `${NO_REVENUE_MESSAGE}; ${discountText}` };
  }

  // Compare unrounded values exactly, in integers:
  // (net − cost) / net − min  has the sign of  (net − cost) × 10000 − min × net.
  const net = totals.netRevenueCents;
  const distance = (net - totals.totalCostCents) * 10_000 - APPROVAL_RULE.minMarginBps * net;
  const marginOk = distance >= 0;
  // Within 0.1 pp (10 bp) of the threshold, show 2 decimals so the display cannot contradict the result.
  const nearThreshold = Math.abs(distance) < 10 * net;
  const margin = formatPercent(totals.margin, nearThreshold ? 2 : 1);
  const marginText = marginOk
    ? `Margin ${margin} meets the ${minMargin} minimum`
    : `Margin ${margin} is below the ${minMargin} minimum`;

  return { requiresReview: !marginOk || !discountOk, explanation: `${marginText}; ${discountText}` };
}
