import { describe, expect, it } from "vitest";
import type { CommercialTerms } from "./calc.js";
import { termsFingerprint } from "./fingerprint.js";
import { assessQuote } from "./quote.js";
import { describeStaleDecision, type Decision, type DecisionValue } from "./status.js";

const revision = (discountBps: number, priceCents = 1_200_000): CommercialTerms => ({
  items: [{ description: "Implementation", quantity: 1, unitPriceCents: priceCents, unitCostCents: 720_000 }],
  discountBps,
});

/** Simulates a manager deciding on the terms they currently see. */
function decide(terms: CommercialTerms, decision: DecisionValue, decidedAt = "2026-11-25T10:00:00Z"): Decision {
  const seen = assessQuote(terms, []);
  return { decision, reason: "Strategic account", decidedAt, termsFingerprint: seen.termsFingerprint, snapshot: seen.totals };
}

describe("derived status", () => {
  it("within the rule: not_required, no decision needed", () => {
    expect(assessQuote(revision(1000), []).status).toBe("not_required");
  });

  it("outside the rule with no decision: pending", () => {
    expect(assessQuote(revision(2000), []).status).toBe("pending");
  });

  it("decision for the current terms: approved / rejected", () => {
    const terms = revision(2000);
    expect(assessQuote(terms, [decide(terms, "approved")]).status).toBe("approved");
    expect(assessQuote(terms, [decide(terms, "rejected")]).status).toBe("rejected");
  });

  it("approve Revision at 20% → change to 10%: not_required, earlier decision not current", () => {
    const approval = decide(revision(2000), "approved");
    const after = assessQuote(revision(1000), [approval]);
    expect(after.status).toBe("not_required");
    expect(after.decision).toBeUndefined();
  });

  it("approve → change price while still outside the rule: stale with explanation", () => {
    const approval = decide(revision(2000), "approved");
    const after = assessQuote(revision(2000, 1_150_000), [approval]);
    expect(after.status).toBe("stale");
    expect(after.decision).toBe(approval);
    expect(after.decision && describeStaleDecision(after.decision)).toBe(
      "Approval from Nov 25, 2026 applied to earlier terms (margin 25.0%, discount 20%)",
    );
  });

  it("a new decision on the changed terms replaces the stale one", () => {
    const changed = revision(2000, 1_150_000);
    const history = [decide(revision(2000), "approved"), decide(changed, "rejected", "2026-11-26T10:00:00Z")];
    expect(assessQuote(changed, history).status).toBe("rejected");
  });

  it("the latest matching decision wins", () => {
    const terms = revision(2000);
    const history = [decide(terms, "rejected"), decide(terms, "approved", "2026-11-26T10:00:00Z")];
    expect(assessQuote(terms, history).status).toBe("approved");
  });

  it("reverting to previously decided terms restores that decision", () => {
    const original = revision(2000);
    const history = [decide(original, "approved")];
    expect(assessQuote(revision(2000, 1_150_000), history).status).toBe("stale");
    expect(assessQuote(original, history).status).toBe("approved");
  });

  it("zero revenue needs review: pending", () => {
    expect(assessQuote({ items: [], discountBps: 0 }, []).status).toBe("pending");
  });
});

describe("terms fingerprint", () => {
  const a = { description: "Discovery", quantity: 1, unitPriceCents: 200_000, unitCostCents: 120_000 };
  const b = { description: "Implementation", quantity: 1, unitPriceCents: 800_000, unitCostCents: 480_000 };

  it("is a deterministic SHA-256 hex digest", () => {
    const fp = termsFingerprint({ items: [a, b], discountBps: 0 });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(termsFingerprint({ items: [a, b], discountBps: 0 })).toBe(fp);
  });

  it("does not depend on item order", () => {
    expect(termsFingerprint({ items: [b, a], discountBps: 0 })).toBe(termsFingerprint({ items: [a, b], discountBps: 0 }));
  });

  it.each([
    ["discount", { items: [a, b], discountBps: 1 }],
    ["quantity", { items: [{ ...a, quantity: 2 }, b], discountBps: 0 }],
    ["unit price", { items: [{ ...a, unitPriceCents: 200_001 }, b], discountBps: 0 }],
    ["unit cost", { items: [{ ...a, unitCostCents: 120_001 }, b], discountBps: 0 }],
    ["description", { items: [{ ...a, description: "Discovery workshop" }, b], discountBps: 0 }],
    ["removed item", { items: [a], discountBps: 0 }],
  ])("changes when %s changes", (_label, terms) => {
    expect(termsFingerprint(terms)).not.toBe(termsFingerprint({ items: [a, b], discountBps: 0 }));
  });

  it("a name or notes edit does not invalidate a decision (they are not commercial terms)", () => {
    const quote = { name: "Revision", notes: "", ...revision(2000) };
    const approval = decide(quote, "approved");
    const renamed = { ...quote, name: "Revision (final)", notes: "Customer asked for a new title" };
    expect(assessQuote(renamed, [approval]).status).toBe("approved");
  });
});
