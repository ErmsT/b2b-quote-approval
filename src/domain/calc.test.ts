import { describe, expect, it } from "vitest";
import { evaluateRule, NO_REVENUE_MESSAGE } from "./approval.js";
import { calculateTotals, type CommercialTerms, type LineItem } from "./calc.js";
import { formatPercent, formatUsd } from "./money.js";

const item = (description: string, priceCents: number, costCents: number, quantity = 1): LineItem => ({
  description,
  quantity,
  unitPriceCents: priceCents,
  unitCostCents: costCents,
});

const shown = (margin: number | undefined) => (margin === undefined ? "—" : formatPercent(margin, 1));

function assess(terms: CommercialTerms) {
  const totals = calculateTotals(terms);
  return { totals, rule: evaluateRule(totals) };
}

describe("seeded cases", () => {
  it("Standard: $10,000 net, $6,000 cost, 40.0% margin, can proceed", () => {
    const { totals, rule } = assess({
      items: [item("Discovery", 200_000, 120_000), item("Implementation", 800_000, 480_000)],
      discountBps: 0,
    });
    expect(totals.netRevenueCents).toBe(1_000_000);
    expect(totals.totalCostCents).toBe(600_000);
    expect(shown(totals.margin)).toBe("40.0%");
    expect(rule.requiresReview).toBe(false);
    expect(rule.explanation).toBe("Margin 40.0% meets the 30% minimum; discount 0% is within the 15% maximum");
  });

  it("Large: $22,500 net, $18,000 cost, 20.0% margin, needs review", () => {
    const { totals, rule } = assess({
      items: [item("Implementation", 2_000_000, 1_500_000), item("Training", 500_000, 300_000)],
      discountBps: 1000,
    });
    expect(totals.grossRevenueCents).toBe(2_500_000);
    expect(totals.netRevenueCents).toBe(2_250_000);
    expect(totals.totalCostCents).toBe(1_800_000);
    expect(shown(totals.margin)).toBe("20.0%");
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toBe("Margin 20.0% is below the 30% minimum; discount 10% is within the 15% maximum");
  });

  const revision = (discountBps: number) => assess({ items: [item("Implementation", 1_200_000, 720_000)], discountBps });

  it("Revision at 20%: $9,600 net, 25.0% margin, needs review for both reasons", () => {
    const { totals, rule } = revision(2000);
    expect(totals.netRevenueCents).toBe(960_000);
    expect(totals.totalCostCents).toBe(720_000);
    expect(shown(totals.margin)).toBe("25.0%");
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toBe("Margin 25.0% is below the 30% minimum; discount 20% exceeds the 15% maximum");
  });

  it("Revision at 10%: $10,800 net, 33.3% margin, can proceed", () => {
    const { totals, rule } = revision(1000);
    expect(totals.netRevenueCents).toBe(1_080_000);
    expect(formatUsd(totals.netRevenueCents)).toBe("$10,800.00");
    expect(shown(totals.margin)).toBe("33.3%");
    expect(rule.requiresReview).toBe(false);
  });
});

describe("calculation", () => {
  it("multiplies quantity by unit price and unit cost", () => {
    const totals = calculateTotals({ items: [item("Workshop", 150_050, 100_000, 3)], discountBps: 0 });
    expect(totals.grossRevenueCents).toBe(450_150);
    expect(totals.totalCostCents).toBe(300_000);
  });

  it("discount reduces price, not cost", () => {
    const totals = calculateTotals({ items: [item("Work", 100_000, 50_000)], discountBps: 5000 });
    expect(totals.netRevenueCents).toBe(50_000);
    expect(totals.totalCostCents).toBe(50_000);
    expect(totals.margin).toBe(0);
  });

  it("rounds net revenue half up to the cent", () => {
    // $0.05 at 10% off = 4.5 cents → 5 cents
    expect(calculateTotals({ items: [item("Tiny", 5, 0)], discountBps: 1000 }).netRevenueCents).toBe(5);
    // $0.01 at 15.01% off = 0.8499 cents → 1 cent
    expect(calculateTotals({ items: [item("Tiny", 1, 0)], discountBps: 1501 }).netRevenueCents).toBe(1);
  });

  it("allows a negative margin when cost exceeds net revenue", () => {
    const { totals, rule } = assess({ items: [item("Loss", 100_000, 150_000)], discountBps: 0 });
    expect(shown(totals.margin)).toBe("-50.0%");
    expect(rule.requiresReview).toBe(true);
  });
});

describe("zero revenue", () => {
  it.each([
    ["no items", { items: [], discountBps: 0 }],
    ["all prices 0", { items: [item("Free", 0, 10_000)], discountBps: 0 }],
    ["100% discount", { items: [item("Work", 100_000, 50_000)], discountBps: 10_000 }],
  ])("%s: margin undefined, needs review, no NaN or Infinity", (_label, terms) => {
    const { totals, rule } = assess(terms);
    expect(totals.netRevenueCents).toBe(0);
    expect(totals.margin).toBeUndefined();
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toContain(NO_REVENUE_MESSAGE);
    expect(rule.explanation).not.toMatch(/NaN|Infinity/);
  });
});

describe("rule boundaries (unrounded comparison)", () => {
  // $100.00 net revenue; cost sets the margin exactly.
  const withCost = (costCents: number, discountBps = 0) =>
    assess({ items: [item("Work", 10_000, costCents)], discountBps });

  it("margin 29.99% needs review", () => {
    const { rule } = withCost(7001);
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toBe("Margin 29.99% is below the 30% minimum; discount 0% is within the 15% maximum");
  });

  it("margin 30.00% can proceed", () => {
    const { rule } = withCost(7000);
    expect(rule.requiresReview).toBe(false);
    expect(rule.explanation).toBe("Margin 30.00% meets the 30% minimum; discount 0% is within the 15% maximum");
  });

  it("margin 30.01% can proceed", () => {
    const { rule } = withCost(6999);
    expect(rule.requiresReview).toBe(false);
    expect(rule.explanation).toContain("Margin 30.01% meets");
  });

  it("margin 29.96% displays as 30.0% but is below the threshold; explanation shows 2 decimals", () => {
    const { totals, rule } = withCost(7004);
    expect(shown(totals.margin)).toBe("30.0%");
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toContain("Margin 29.96% is below the 30% minimum");
  });

  it("margin just below the 30% boundary by less than a cent is still below", () => {
    // net $1,000.00, cost $700.01 → 29.999%
    const { rule } = assess({ items: [item("Work", 100_000, 70_001)], discountBps: 0 });
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toContain("Margin 30.00% is below");
  });

  it("margin outside 0.1 pp of the threshold shows 1 decimal", () => {
    expect(withCost(7010).rule.explanation).toContain("Margin 29.9% is below");
  });

  it("discount 15% can proceed", () => {
    const { rule } = withCost(1000, 1500);
    expect(rule.requiresReview).toBe(false);
    expect(rule.explanation).toContain("discount 15% is within the 15% maximum");
  });

  it("discount 15.01% needs review", () => {
    const { rule } = withCost(1000, 1501);
    expect(rule.requiresReview).toBe(true);
    expect(rule.explanation).toContain("discount 15.01% exceeds the 15% maximum");
  });
});
