import { z } from "zod";

// Inputs arrive as form strings (client) or JSON numbers (API). Both go through the same
// checks; empty or non-numeric input is an error, never a silent zero.
// Prices are entered in dollars and discounts in percent; the output is integer cents / basis points.

const NUMERIC = /^-?\d+(\.\d+)?$/;
const UP_TO_2_DECIMALS = /^\d+(\.\d{1,2})?$/;

type Ctx = z.RefinementCtx;

/** Returns the trimmed numeric text, or reports an issue and returns undefined. */
function numericText(value: unknown, ctx: Ctx): string | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    ctx.addIssue({ code: "custom", message: "Required" });
    return undefined;
  }
  const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!NUMERIC.test(text)) {
    ctx.addIssue({ code: "custom", message: "Must be a number" });
    return undefined;
  }
  return text;
}

/** Converts validated text with at most 2 decimals to an integer in hundredths ("12.5" → 1250). */
function toHundredths(text: string): number {
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const quantity = z.unknown().transform((value, ctx) => {
  const text = numericText(value, ctx);
  if (text === undefined) return z.NEVER;
  const n = Number(text);
  if (!Number.isInteger(n)) {
    ctx.addIssue({ code: "custom", message: "Must be a whole number" });
    return z.NEVER;
  }
  if (n < 1) {
    ctx.addIssue({ code: "custom", message: "Must be at least 1" });
    return z.NEVER;
  }
  return n;
});

/** Dollar amount ≥ 0 with at most 2 decimals → integer cents. */
const moneyCents = z.unknown().transform((value, ctx) => {
  const text = numericText(value, ctx);
  if (text === undefined) return z.NEVER;
  if (Number(text) < 0) {
    ctx.addIssue({ code: "custom", message: "Must be 0 or more" });
    return z.NEVER;
  }
  if (!UP_TO_2_DECIMALS.test(text)) {
    ctx.addIssue({ code: "custom", message: "At most 2 decimal places" });
    return z.NEVER;
  }
  return toHundredths(text);
});

/** Percent 0–100 inclusive with at most 2 decimals → integer basis points. */
const discountBps = z.unknown().transform((value, ctx) => {
  const text = numericText(value, ctx);
  if (text === undefined) return z.NEVER;
  const n = Number(text);
  if (n < 0 || n > 100) {
    ctx.addIssue({ code: "custom", message: "Must be between 0 and 100" });
    return z.NEVER;
  }
  if (!UP_TO_2_DECIMALS.test(text)) {
    ctx.addIssue({ code: "custom", message: "At most 2 decimal places" });
    return z.NEVER;
  }
  return toHundredths(text);
});

const requiredText = (max: number) =>
  z
    .string({ error: "Required" })
    .trim()
    .min(1, { error: "Required" })
    .max(max, { error: `At most ${max} characters` });

/** Input field names match the form; output matches the domain (LineItem, CommercialTerms). */
export const lineItemSchema = z
  .object({
    description: requiredText(200),
    quantity,
    unitPrice: moneyCents,
    unitCost: moneyCents,
  })
  .transform(({ description, quantity, unitPrice, unitCost }) => ({
    description,
    quantity,
    unitPriceCents: unitPrice,
    unitCostCents: unitCost,
  }));

const termsFields = {
  items: z.array(lineItemSchema, { error: "Required" }),
  discount: discountBps,
};

/** Commercial terms only; used by the editor to preview totals before name and notes are valid. */
export const termsInputSchema = z
  .object(termsFields)
  .transform(({ discount, ...rest }) => ({ ...rest, discountBps: discount }));

export const quoteInputSchema = z
  .object({
    name: requiredText(120),
    notes: z.string({ error: "Must be text" }).max(2000, { error: "At most 2000 characters" }).default(""),
    ...termsFields,
  })
  .transform(({ discount, ...rest }) => ({ ...rest, discountBps: discount }));

export const decisionInputSchema = z.object({
  decision: z.enum(["approved", "rejected"], { error: "Choose approve or reject" }),
  reason: requiredText(1000),
  termsFingerprint: z.string({ error: "Required" }).regex(/^[0-9a-f]{64}$/, { error: "Invalid fingerprint" }),
});

export type QuoteInput = z.output<typeof quoteInputSchema>;
export type DecisionInput = z.output<typeof decisionInputSchema>;

/** Field-level messages keyed by path ("items.0.quantity" → "Must be at least 1"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}
