import { describe, expect, it } from "vitest";
import { decisionInputSchema, fieldErrors, quoteInputSchema } from "./schema.js";

const validItem = { description: "Implementation", quantity: "1", unitPrice: "12000", unitCost: "7200" };
const validQuote = { name: "Revision", notes: "", items: [validItem], discount: "20" };

function errorsFor(input: unknown): Record<string, string> {
  const result = quoteInputSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

const withItem = (patch: Record<string, unknown>) => ({ ...validQuote, items: [{ ...validItem, ...patch }] });

describe("quote input schema", () => {
  it("converts form strings to integer cents and basis points", () => {
    const parsed = quoteInputSchema.parse(withItem({ quantity: "3", unitPrice: "1500.5", unitCost: "0.07" }));
    expect(parsed.items[0]).toEqual({ description: "Implementation", quantity: 3, unitPriceCents: 150_050, unitCostCents: 7 });
    expect(parsed.discountBps).toBe(2000);
  });

  it("accepts JSON numbers as well as strings", () => {
    const parsed = quoteInputSchema.parse({ ...validQuote, items: [{ ...validItem, quantity: 2, unitPrice: 0.29 }], discount: 15.01 });
    expect(parsed.items[0]?.unitPriceCents).toBe(29);
    expect(parsed.discountBps).toBe(1501);
  });

  it("accepts an empty item list (zero revenue is a valid, reviewable state)", () => {
    expect(quoteInputSchema.safeParse({ ...validQuote, items: [] }).success).toBe(true);
  });

  it.each([
    ["0", "Must be at least 1"],
    ["-1", "Must be at least 1"],
    ["1.5", "Must be a whole number"],
    ["", "Required"],
    ["abc", "Must be a number"],
  ])("quantity %j is rejected: %s", (quantity, message) => {
    expect(errorsFor(withItem({ quantity }))).toEqual({ "items.0.quantity": message });
  });

  it.each([
    ["-1", "Must be 0 or more"],
    ["10.123", "At most 2 decimal places"],
    ["", "Required"],
    ["  ", "Required"],
    ["1e3", "Must be a number"],
    ["$10", "Must be a number"],
  ])("unit price %j is rejected: %s", (unitPrice, message) => {
    expect(errorsFor(withItem({ unitPrice }))).toEqual({ "items.0.unitPrice": message });
  });

  it("unit cost uses the same rules as unit price", () => {
    expect(errorsFor(withItem({ unitCost: "-0.01" }))).toEqual({ "items.0.unitCost": "Must be 0 or more" });
    expect(errorsFor(withItem({ unitCost: undefined }))).toEqual({ "items.0.unitCost": "Required" });
  });

  it("unit price and cost of 0 are accepted", () => {
    expect(quoteInputSchema.safeParse(withItem({ unitPrice: "0", unitCost: 0 })).success).toBe(true);
  });

  it.each([
    ["-1", "Must be between 0 and 100"],
    ["100.01", "Must be between 0 and 100"],
    ["10.555", "At most 2 decimal places"],
    ["", "Required"],
    [null, "Required"],
    ["ten", "Must be a number"],
  ])("discount %j is rejected: %s", (discount, message) => {
    expect(errorsFor({ ...validQuote, discount })).toEqual({ discount: message });
  });

  it.each([
    ["0", 0],
    ["100", 10_000],
    ["15", 1500],
    ["15.01", 1501],
  ])("discount %j is accepted as %i bp", (discount, bps) => {
    expect(quoteInputSchema.parse({ ...validQuote, discount }).discountBps).toBe(bps);
  });

  it("requires a non-empty name and item description", () => {
    expect(errorsFor({ ...validQuote, name: "  " })).toEqual({ name: "Required" });
    expect(errorsFor(withItem({ description: "" }))).toEqual({ "items.0.description": "Required" });
  });

  it("reports one message per field, for every invalid field", () => {
    expect(errorsFor({ ...withItem({ quantity: "0", unitPrice: "-1" }), discount: "101" })).toEqual({
      "items.0.quantity": "Must be at least 1",
      "items.0.unitPrice": "Must be 0 or more",
      discount: "Must be between 0 and 100",
    });
  });
});

describe("decision input schema", () => {
  const fp = "a".repeat(64);

  it("accepts a decision with a reason", () => {
    expect(decisionInputSchema.parse({ decision: "approved", reason: " Strategic account ", termsFingerprint: fp })).toEqual({
      decision: "approved",
      reason: "Strategic account",
      termsFingerprint: fp,
    });
  });

  it.each(["", "   ", undefined])("rejects reason %j", (reason) => {
    const result = decisionInputSchema.safeParse({ decision: "rejected", reason, termsFingerprint: fp });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toEqual({ reason: "Required" });
  });

  it("rejects an unknown decision value", () => {
    expect(decisionInputSchema.safeParse({ decision: "maybe", reason: "x", termsFingerprint: fp }).success).toBe(false);
  });
});
