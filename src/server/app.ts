import express, { type ErrorRequestHandler } from "express";
import type { Db } from "./db.js";
import { demoRouter } from "./routes/demo.js";
import { quotesRouter } from "./routes/quotes.js";

export function createApp(db: Db): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/quotes", quotesRouter(db));
  app.use("/api/demo", demoRouter(db));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const onError: ErrorRequestHandler = (err: { type?: string }, _req, res, _next) => {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body must be valid JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);

  return app;
}
