import { Router } from "express";
import { listQuotes, type Db } from "../db.js";
import { resetDemoData } from "../seed.js";
import { toQuoteView } from "./quotes.js";

export function demoRouter(db: Db): Router {
  const router = Router();

  // Demo-only: restores the seeded quotes for every reviewer sharing this database.
  router.post("/reset", (_req, res) => {
    resetDemoData(db);
    res.json(listQuotes(db, "").map((q) => toQuoteView(db, q)));
  });

  return router;
}
