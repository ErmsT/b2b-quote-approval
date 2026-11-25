import { pathToFileURL } from "node:url";
import type { QuoteInput } from "../domain/schema.js";
import { DEFAULT_DATABASE_PATH, deleteAllData, insertQuote, openDatabase, type Db } from "./db.js";

const item = (description: string, priceCents: number, costCents: number) => ({
  description,
  quantity: 1,
  unitPriceCents: priceCents,
  unitCostCents: costCents,
});

/** The seeded cases from AGENTS.md. Revision starts at 20%; the reviewer changes it to 10%. */
export const SEED_QUOTES: QuoteInput[] = [
  {
    name: "Standard",
    notes: "",
    items: [item("Discovery", 200_000, 120_000), item("Implementation", 800_000, 480_000)],
    discountBps: 0,
  },
  {
    name: "Large",
    notes: "",
    items: [item("Implementation", 2_000_000, 1_500_000), item("Training", 500_000, 300_000)],
    discountBps: 1000,
  },
  {
    name: "Revision",
    notes: "",
    items: [item("Implementation", 1_200_000, 720_000)],
    discountBps: 2000,
  },
];

function insertSeed(db: Db): void {
  const now = new Date().toISOString();
  for (const quote of SEED_QUOTES) insertQuote(db, quote, now);
}

export function seedIfEmpty(db: Db): void {
  db.transaction(() => {
    const count = db.prepare("SELECT COUNT(*) FROM quotes").pluck().get() as number;
    if (count === 0) insertSeed(db);
  })();
}

/** Drops all data and restores the seeded cases. */
export function resetDemoData(db: Db): void {
  db.transaction(() => {
    deleteAllData(db);
    insertSeed(db);
  })();
}

// `npm run db:reset`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const db = openDatabase(file);
  resetDemoData(db);
  db.close();
  console.log(`Demo data restored in ${file}`);
}
