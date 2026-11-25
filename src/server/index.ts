import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { DEFAULT_DATABASE_PATH, openDatabase } from "./db.js";
import { seedIfEmpty } from "./seed.js";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client");
const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;

const db = openDatabase(databasePath);
seedIfEmpty(db);

const app = createApp(db);
app.use(express.static(clientDir));
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port} (database: ${databasePath})`);
});
