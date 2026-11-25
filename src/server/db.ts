import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LineItem } from "../domain/calc.js";
import type { QuoteInput } from "../domain/schema.js";
import type { Decision } from "../domain/status.js";

export type Db = Database.Database;

export const DEFAULT_DATABASE_PATH = "./data/app.db";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Opens (creating if needed) the database and applies pending migrations. */
export function openDatabase(filename: string): Db {
  if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").pluck().all() as string[]);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.transaction(() => {
      db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
    })();
  }
}

export interface QuoteRecord {
  id: number;
  name: string;
  notes: string;
  items: LineItem[];
  discountBps: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord extends Decision {
  id: number;
}

interface QuoteRow {
  id: number;
  name: string;
  notes: string;
  discount_bps: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: number;
  decision: Decision["decision"];
  reason: string;
  decided_at: string;
  terms_fingerprint: string;
  gross_revenue_cents: number;
  net_revenue_cents: number;
  total_cost_cents: number;
  discount_bps: number;
  margin: number | null;
}

function toQuoteRecord(db: Db, row: QuoteRow): QuoteRecord {
  const items = db
    .prepare(
      `SELECT description, quantity, unit_price_cents AS unitPriceCents, unit_cost_cents AS unitCostCents
       FROM line_items WHERE quote_id = ? ORDER BY position`,
    )
    .all(row.id) as LineItem[];
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    items,
    discountBps: row.discount_bps,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getQuote(db: Db, id: number): QuoteRecord | undefined {
  const row = db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as QuoteRow | undefined;
  return row && toQuoteRecord(db, row);
}

/** Quotes whose name contains `search` (case-insensitive for ASCII), oldest first. */
export function listQuotes(db: Db, search: string): QuoteRecord[] {
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare("SELECT * FROM quotes WHERE name LIKE ? ESCAPE '\\' ORDER BY id")
    .all(pattern) as QuoteRow[];
  return rows.map((row) => toQuoteRecord(db, row));
}

function insertItems(db: Db, quoteId: number, items: LineItem[]): void {
  const insert = db.prepare(
    `INSERT INTO line_items (quote_id, position, description, quantity, unit_price_cents, unit_cost_cents)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  items.forEach((item, position) =>
    insert.run(quoteId, position, item.description, item.quantity, item.unitPriceCents, item.unitCostCents),
  );
}

export function insertQuote(db: Db, input: QuoteInput, now: string): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO quotes (name, notes, discount_bps, version, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(input.name, input.notes, input.discountBps, now, now);
    const id = Number(lastInsertRowid);
    insertItems(db, id, input.items);
    return id;
  })();
}

/** Replaces name, notes and commercial terms. Returns false if `version` is no longer current. */
export function updateQuote(db: Db, id: number, version: number, input: QuoteInput, now: string): boolean {
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE quotes SET name = ?, notes = ?, discount_bps = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(input.name, input.notes, input.discountBps, now, id, version);
    if (changes === 0) return false;
    db.prepare("DELETE FROM line_items WHERE quote_id = ?").run(id);
    insertItems(db, id, input.items);
    return true;
  })();
}

/** Decision history for a quote, oldest first. */
export function getDecisions(db: Db, quoteId: number): DecisionRecord[] {
  const rows = db.prepare("SELECT * FROM decisions WHERE quote_id = ? ORDER BY id").all(quoteId) as DecisionRow[];
  return rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    reason: r.reason,
    decidedAt: r.decided_at,
    termsFingerprint: r.terms_fingerprint,
    snapshot: {
      grossRevenueCents: r.gross_revenue_cents,
      netRevenueCents: r.net_revenue_cents,
      totalCostCents: r.total_cost_cents,
      discountBps: r.discount_bps,
      margin: r.margin ?? undefined,
    },
  }));
}

export function insertDecision(db: Db, quoteId: number, d: Decision): void {
  db.prepare(
    `INSERT INTO decisions (quote_id, decision, reason, decided_at, terms_fingerprint,
       gross_revenue_cents, net_revenue_cents, total_cost_cents, discount_bps, margin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    quoteId,
    d.decision,
    d.reason,
    d.decidedAt,
    d.termsFingerprint,
    d.snapshot.grossRevenueCents,
    d.snapshot.netRevenueCents,
    d.snapshot.totalCostCents,
    d.snapshot.discountBps,
    d.snapshot.margin ?? null,
  );
}

/** Demo reset only: removes all quotes, items and decisions. */
export function deleteAllData(db: Db): void {
  db.exec("DELETE FROM decisions; DELETE FROM line_items; DELETE FROM quotes;");
}
