# Quote Margin & Approval Prototype

Work in progress. The remaining README sections (see AGENTS.md, "README deliverables") will be added as the prototype is built.

## Rules & assumptions

- **Money** is stored and computed in integer cents (USD). Floats are used only for display.
- **Discount** is entered as a percentage from 0 to 100 inclusive with at most 2 decimals, and stored as integer basis points (15.01% = 1501 bp). The discount reduces price, never cost.
- **Net revenue** = gross revenue × (1 − discount), rounded half up to the nearest cent. Margin is computed from that rounded net revenue, so the displayed net revenue is the value the rule uses.
- **Margin** = (net revenue − total cost) / net revenue. With zero net revenue (no items, all prices 0, or a 100% discount) the margin is undefined, shown as "—" with "No revenue: margin cannot be calculated", and the quote needs review.
- **Approval rule (product decision):** a quote can proceed when margin ≥ 30% and discount ≤ 15%; otherwise it needs review. The thresholds live only in `APPROVAL_RULE` (`src/domain/approval.ts`).
- **Rounding vs. thresholds:** comparisons use unrounded values, done exactly in integer arithmetic. Display rounds currency to 2 decimals and margin to 1 decimal. Consequence: a 29.96% margin displays as "30.0%" yet needs review. When a margin is within 0.1 pp of the threshold, the explanation shows 2 decimals ("Margin 29.96% is below the 30% minimum").
- **Commercial terms** = line items (description, quantity, unit price, unit cost) + discount. The terms fingerprint is a SHA-256 of these normalized terms. Item order does not affect it, and descriptions are trimmed. Quote name and notes are not commercial terms, so editing them does not invalidate a decision.
- **Status** is derived on every read: `not_required` when the terms satisfy the rule; otherwise `approved`/`rejected` from the latest decision whose fingerprint matches the current terms, `stale` if decisions exist only for other terms, and `pending` if there are none. If the terms are reverted to ones already decided, that earlier decision applies again, because the manager saw exactly those terms.
- **Validation:** quantity is a whole number ≥ 1. Unit price and unit cost are ≥ 0 with at most 2 decimals. Empty or non-numeric input is an error, never a zero. Exponent notation ("1e3") and currency symbols are rejected. Quote name and item description are required (assumption: an item without a description is not meaningful). A decision reason is required.
- **Dates** in the stale-decision message are formatted in UTC.
