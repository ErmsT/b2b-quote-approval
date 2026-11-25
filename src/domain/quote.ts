import { evaluateRule, type RuleEvaluation } from "./approval.js";
import { calculateTotals, type CommercialTerms, type QuoteTotals } from "./calc.js";
import { termsFingerprint } from "./fingerprint.js";
import { deriveStatus, type Decision, type DerivedStatus } from "./status.js";

export interface QuoteAssessment extends DerivedStatus {
  totals: QuoteTotals;
  rule: RuleEvaluation;
  termsFingerprint: string;
}

/** Everything the server recomputes on every read: totals, rule, fingerprint and status. */
export function assessQuote(terms: CommercialTerms, decisions: readonly Decision[]): QuoteAssessment {
  const totals = calculateTotals(terms);
  const rule = evaluateRule(totals);
  const fingerprint = termsFingerprint(terms);
  return {
    totals,
    rule,
    termsFingerprint: fingerprint,
    ...deriveStatus(fingerprint, rule.requiresReview, decisions),
  };
}
