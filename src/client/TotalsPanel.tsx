import type { RuleEvaluation } from "../domain/approval.js";
import type { QuoteTotals } from "../domain/calc.js";
import { formatBps, formatPercent, formatUsd } from "../domain/money.js";
import type { QuoteStatus } from "../domain/status.js";

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  not_required: "Can proceed",
  pending: "Needs review: awaiting manager decision",
  approved: "Approved by manager",
  rejected: "Rejected by manager",
  stale: "Needs review: earlier decision no longer applies",
};

export const formatMargin = (margin: number | undefined) => (margin === undefined ? "—" : formatPercent(margin, 1));

interface TotalsPanelProps {
  totals: QuoteTotals;
  rule: RuleEvaluation;
  status: QuoteStatus;
  staleMessage?: string;
  /** True when the figures come from unsaved edits rather than the saved quote. */
  preview: boolean;
}

export function TotalsPanel({ totals, rule, status, staleMessage, preview }: TotalsPanelProps) {
  return (
    <section className="totals" aria-labelledby="totals-heading">
      <h2 id="totals-heading">
        Totals {preview && <span className="tag">Preview of unsaved changes</span>}
      </h2>
      <dl>
        <dt>Gross revenue</dt>
        <dd>{formatUsd(totals.grossRevenueCents)}</dd>
        <dt>Discount</dt>
        <dd>{formatBps(totals.discountBps)}</dd>
        <dt>Net revenue</dt>
        <dd>{formatUsd(totals.netRevenueCents)}</dd>
        <dt>Total cost</dt>
        <dd>{formatUsd(totals.totalCostCents)}</dd>
        <dt>Margin</dt>
        <dd className="margin">{formatMargin(totals.margin)}</dd>
      </dl>
      <p className={`status status-${status}`}>
        <strong>Status:</strong> {STATUS_LABEL[status]}
      </p>
      <p className="explanation">{rule.explanation}</p>
      {staleMessage && <p className="explanation">{staleMessage}</p>}
    </section>
  );
}
