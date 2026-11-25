// Minimal entry point; the API, database and seed arrive in Phase 2.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client");
const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.static(clientDir));
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
