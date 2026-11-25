import { Router, type Response } from "express";
import { z } from "zod";
import { assessQuote } from "../../domain/quote.js";
import { decisionInputSchema, fieldErrors, quoteInputSchema } from "../../domain/schema.js";
import { describeStaleDecision } from "../../domain/status.js";
import {
  getDecisions,
  getQuote,
  insertDecision,
  insertQuote,
  listQuotes,
  updateQuote,
  type Db,
  type QuoteRecord,
} from "../db.js";

/** A quote as returned by the API. Everything computed is computed here, on the server. */
export function toQuoteView(db: Db, quote: QuoteRecord) {
  const decisions = getDecisions(db, quote.id);
  const { totals, rule, termsFingerprint, status, decision } = assessQuote(quote, decisions);
  return {
    ...quote,
    totals,
    rule,
    termsFingerprint,
    status,
    /** Decision covering the current terms, or the one that went stale. */
    statusDecision: decision,
    staleMessage: status === "stale" && decision ? describeStaleDecision(decision) : undefined,
    decisions,
  };
}

export type QuoteView = ReturnType<typeof toQuoteView>;

const versionSchema = z.object({
  version: z.number({ error: "Required" }).int({ error: "Invalid version" }).min(1, { error: "Invalid version" }),
});

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: "Validation failed", fieldErrors: fieldErrors(error) });
}

function sendNotFound(res: Response): void {
  res.status(404).json({ error: "Quote not found" });
}

function parseId(raw: string): number | undefined {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : undefined;
}

export function quotesRouter(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    res.json(listQuotes(db, search).map((q) => toQuoteView(db, q)));
  });

  router.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const quote = id === undefined ? undefined : getQuote(db, id);
    if (!quote) return sendNotFound(res);
    res.json(toQuoteView(db, quote));
  });

  router.post("/", (req, res) => {
    const parsed = quoteInputSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const id = insertQuote(db, parsed.data, new Date().toISOString());
    res.status(201).json(toQuoteView(db, getQuote(db, id) as QuoteRecord));
  });

  router.put("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id === undefined ? undefined : getQuote(db, id);
    if (id === undefined || !current) return sendNotFound(res);

    const version = versionSchema.safeParse(req.body);
    if (!version.success) return sendValidationError(res, version.error);
    const conflict = () =>
      res.status(409).json({
        error: "This quote changed since you opened it",
        quote: toQuoteView(db, getQuote(db, id) as QuoteRecord),
      });
    if (version.data.version !== current.version) return conflict();

    const parsed = quoteInputSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    if (!updateQuote(db, id, version.data.version, parsed.data, new Date().toISOString())) return conflict();
    res.json(toQuoteView(db, getQuote(db, id) as QuoteRecord));
  });

  router.post("/:id/decisions", (req, res) => {
    const id = parseId(req.params.id);
    const quote = id === undefined ? undefined : getQuote(db, id);
    if (id === undefined || !quote) return sendNotFound(res);

    const parsed = decisionInputSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);

    const { totals, rule, termsFingerprint } = assessQuote(quote, getDecisions(db, id));
    if (parsed.data.termsFingerprint !== termsFingerprint) {
      return res.status(409).json({
        error: "The quote terms changed since this decision was prepared. Review the current terms.",
        quote: toQuoteView(db, quote),
      });
    }
    if (!rule.requiresReview) {
      return res.status(409).json({
        error: "No decision needed: this quote satisfies the approval rule.",
        quote: toQuoteView(db, quote),
      });
    }

    insertDecision(db, id, {
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      decidedAt: new Date().toISOString(),
      termsFingerprint,
      snapshot: totals,
    });
    res.status(201).json(toQuoteView(db, quote));
  });

  return router;
}
