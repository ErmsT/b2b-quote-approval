import type { QuoteTotals } from "./calc.js";
import { formatBps, formatPercent } from "./money.js";

export type QuoteStatus = "not_required" | "pending" | "approved" | "rejected" | "stale";
export type DecisionValue = "approved" | "rejected";

/** Totals, margin and discount as the manager saw them when deciding. */
export type DecisionSnapshot = QuoteTotals;

export interface Decision {
  decision: DecisionValue;
  reason: string;
  decidedAt: string; // ISO 8601
  termsFingerprint: string;
  snapshot: DecisionSnapshot;
}

export interface DerivedStatus<D extends Decision = Decision> {
  status: QuoteStatus;
  /** The decision covering the current terms (approved/rejected), or the one that went stale. */
  decision?: D;
}

/**
 * Derives status from the current terms and the append-only decision history
 * (oldest first). Never stored; recomputed on every read.
 */
export function deriveStatus<D extends Decision>(
  currentFingerprint: string,
  requiresReview: boolean,
  decisions: readonly D[],
): DerivedStatus<D> {
  if (!requiresReview) return { status: "not_required" };
  const matching = decisions.filter((d) => d.termsFingerprint === currentFingerprint).at(-1);
  if (matching) return { status: matching.decision, decision: matching };
  const latest = decisions.at(-1);
  if (latest) return { status: "stale", decision: latest };
  return { status: "pending" };
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** "Approval from Nov 25, 2026 applied to earlier terms (margin 25.0%, discount 20%)" */
export function describeStaleDecision(decision: Decision): string {
  const kind = decision.decision === "approved" ? "Approval" : "Rejection";
  const date = dateFormat.format(new Date(decision.decidedAt));
  const { margin, discountBps } = decision.snapshot;
  const marginText = margin === undefined ? "—" : formatPercent(margin, 1);
  return `${kind} from ${date} applied to earlier terms (margin ${marginText}, discount ${formatBps(discountBps)})`;
}
