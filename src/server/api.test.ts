import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDatabase, type Db } from "./db.js";
import type { QuoteView } from "./routes/quotes.js";
import { seedIfEmpty } from "./seed.js";

interface Running {
  call: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
}

async function start(db: Db): Promise<Running> {
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async call(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Turns a quote view back into the form-shaped PUT body (dollars and percent), with optional changes. */
function editBody(q: QuoteView, patch: Record<string, unknown> = {}) {
  return {
    name: q.name,
    notes: q.notes,
    version: q.version,
    discount: q.discountBps / 100,
    items: q.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPriceCents / 100,
      unitCost: i.unitCostCents / 100,
    })),
    ...patch,
  };
}

const newQuote = {
  name: "New deal",
  notes: "",
  discount: "5",
  items: [{ description: "Implementation", quantity: "2", unitPrice: "5000", unitCost: "3000" }],
};

let db: Db;
let api: Running["call"];
let close: Running["close"];

beforeEach(async () => {
  db = openDatabase(":memory:");
  seedIfEmpty(db);
  ({ call: api, close } = await start(db));
});

afterEach(async () => {
  await close();
  db.close();
});

async function getByName(name: string): Promise<QuoteView> {
  const { body } = await api("GET", `/api/quotes?search=${encodeURIComponent(name)}`);
  return body[0];
}

async function approve(q: QuoteView, decision = "approved") {
  return api("POST", `/api/quotes/${q.id}/decisions`, {
    decision,
    reason: "Strategic account",
    termsFingerprint: q.termsFingerprint,
  });
}

describe("GET /api/quotes", () => {
  it("lists the seeded cases with server-computed totals and status", async () => {
    const { status, body } = await api("GET", "/api/quotes");
    expect(status).toBe(200);
    expect(body.map((q: QuoteView) => [q.name, q.totals.netRevenueCents, q.totals.totalCostCents, q.status])).toEqual([
      ["Standard", 1_000_000, 600_000, "not_required"],
      ["Large", 2_250_000, 1_800_000, "pending"],
      ["Revision", 960_000, 720_000, "pending"],
    ]);
    expect(body[1].rule.explanation).toBe("Margin 20.0% is below the 30% minimum; discount 10% is within the 15% maximum");
  });

  it("filters by name, case-insensitively", async () => {
    const { body } = await api("GET", "/api/quotes?search=REV");
    expect(body.map((q: QuoteView) => q.name)).toEqual(["Revision"]);
  });

  it("returns an empty list when nothing matches, treating % and _ literally", async () => {
    expect((await api("GET", "/api/quotes?search=xyz")).body).toEqual([]);
    expect((await api("GET", "/api/quotes?search=%25")).body).toEqual([]);
    expect((await api("GET", "/api/quotes?search=_")).body).toEqual([]);
  });
});

describe("GET /api/quotes/:id", () => {
  it("returns one quote with terms, status and decision history", async () => {
    const revision = await getByName("Revision");
    const { status, body } = await api("GET", `/api/quotes/${revision.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "Revision", discountBps: 2000, version: 1, status: "pending", decisions: [] });
    expect(body.items).toEqual([{ description: "Implementation", quantity: 1, unitPriceCents: 1_200_000, unitCostCents: 720_000 }]);
    expect(body.termsFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["999", "abc", "1.5"])("returns 404 for id %s", async (id) => {
    const { status, body } = await api("GET", `/api/quotes/${id}`);
    expect(status).toBe(404);
    expect(body.error).toBe("Quote not found");
  });
});

describe("POST /api/quotes", () => {
  it("creates a quote and computes everything on the server", async () => {
    const { status, body } = await api("POST", "/api/quotes", newQuote);
    expect(status).toBe(201);
    expect(body).toMatchObject({ name: "New deal", version: 1, discountBps: 500, status: "not_required" });
    expect(body.totals).toEqual({
      grossRevenueCents: 1_000_000,
      netRevenueCents: 950_000,
      totalCostCents: 600_000,
      discountBps: 500,
      margin: (950_000 - 600_000) / 950_000,
    });
    expect((await api("GET", `/api/quotes/${body.id}`)).body.name).toBe("New deal");
  });

  it("ignores client-supplied totals, margin and status", async () => {
    const { body } = await api("POST", "/api/quotes", {
      ...newQuote,
      discount: "40",
      status: "approved",
      totals: { netRevenueCents: 99_999_999, margin: 0.9 },
    });
    expect(body.status).toBe("pending");
    expect(body.totals.netRevenueCents).toBe(600_000);
  });

  it.each([
    [{ quantity: "0" }, "items.0.quantity", "Must be at least 1"],
    [{ quantity: -1 }, "items.0.quantity", "Must be at least 1"],
    [{ quantity: 1.5 }, "items.0.quantity", "Must be a whole number"],
    [{ unitPrice: -1 }, "items.0.unitPrice", "Must be 0 or more"],
    [{ unitCost: "" }, "items.0.unitCost", "Required"],
  ])("rejects item %j with a field-level 400", async (patch, field, message) => {
    const body = { ...newQuote, items: [{ ...newQuote.items[0], ...patch }] };
    const res = await api("POST", "/api/quotes", body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Validation failed", fieldErrors: { [field]: message } });
  });

  it.each([
    [-1, "Must be between 0 and 100"],
    [100.01, "Must be between 0 and 100"],
    ["", "Required"],
  ])("rejects discount %j with a field-level 400", async (discount, message) => {
    const res = await api("POST", "/api/quotes", { ...newQuote, discount });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ discount: message });
  });

  it.each([0, 100])("accepts discount %j", async (discount) => {
    expect((await api("POST", "/api/quotes", { ...newQuote, discount })).status).toBe(201);
  });

  it("does not save invalid quotes", async () => {
    await api("POST", "/api/quotes", { ...newQuote, discount: -1 });
    expect((await api("GET", "/api/quotes")).body).toHaveLength(3);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await api("POST", "/api/quotes", "{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Request body must be valid JSON");
  });
});

describe("PUT /api/quotes/:id", () => {
  it("replaces terms, bumps the version and recomputes status (Revision 20% → 10%)", async () => {
    const revision = await getByName("Revision");
    const { status, body } = await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { discount: "10" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ version: 2, discountBps: 1000, status: "not_required" });
    expect(body.totals.netRevenueCents).toBe(1_080_000);
    expect(body.rule.explanation).toBe("Margin 33.3% meets the 30% minimum; discount 10% is within the 15% maximum");
  });

  it("returns 409 with the current quote when the version is outdated, and does not save", async () => {
    const revision = await getByName("Revision");
    await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { name: "Revision A" }));
    const res = await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { name: "Revision B" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This quote changed since you opened it");
    expect(res.body.quote).toMatchObject({ name: "Revision A", version: 2 });
    expect((await api("GET", `/api/quotes/${revision.id}`)).body.name).toBe("Revision A");
  });

  it("requires a version", async () => {
    const revision = await getByName("Revision");
    const { version: _omit, ...body } = editBody(revision);
    const res = await api("PUT", `/api/quotes/${revision.id}`, body);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ version: "Required" });
  });

  it("rejects invalid terms with 400 and keeps the saved quote unchanged", async () => {
    const revision = await getByName("Revision");
    const res = await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { discount: 100.01 }));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ discount: "Must be between 0 and 100" });
    expect((await api("GET", `/api/quotes/${revision.id}`)).body).toMatchObject({ discountBps: 2000, version: 1 });
  });

  it("returns 404 for an unknown quote", async () => {
    const revision = await getByName("Revision");
    expect((await api("PUT", "/api/quotes/999", editBody(revision))).status).toBe(404);
  });
});

describe("POST /api/quotes/:id/decisions", () => {
  it("records a decision with a snapshot of the reviewed terms", async () => {
    const revision = await getByName("Revision");
    const { status, body } = await approve(revision);
    expect(status).toBe(201);
    expect(body.status).toBe("approved");
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      decision: "approved",
      reason: "Strategic account",
      termsFingerprint: revision.termsFingerprint,
      snapshot: { netRevenueCents: 960_000, totalCostCents: 720_000, discountBps: 2000, margin: 0.25 },
    });
    expect(Date.parse(body.decisions[0].decidedAt)).not.toBeNaN();
    expect(body.statusDecision.id).toBe(body.decisions[0].id);
  });

  it("records a rejection", async () => {
    expect((await approve(await getByName("Large"), "rejected")).body.status).toBe("rejected");
  });

  it("approve Revision at 20% → change to 10%: not_required, decision kept in history but not current", async () => {
    const revision = await getByName("Revision");
    const approved = (await approve(revision)).body as QuoteView;
    const { body } = await api("PUT", `/api/quotes/${revision.id}`, editBody(approved, { discount: 10 }));
    expect(body.status).toBe("not_required");
    expect(body.statusDecision).toBeUndefined();
    expect(body.decisions).toHaveLength(1);
  });

  it("approve → change price while still outside the rule: stale, and a new decision is required", async () => {
    const revision = await getByName("Revision");
    const approved = (await approve(revision)).body as QuoteView;
    const changed = editBody(approved, {
      items: [{ description: "Implementation", quantity: 1, unitPrice: 11_500, unitCost: 7200 }],
    });
    const { body } = await api("PUT", `/api/quotes/${revision.id}`, changed);
    expect(body.status).toBe("stale");
    expect(body.staleMessage).toMatch(/^Approval from .+ applied to earlier terms \(margin 25\.0%, discount 20%\)$/);

    const second = await approve(body);
    expect(second.body.status).toBe("approved");
    expect(second.body.decisions).toHaveLength(2);
  });

  it("a name-only edit does not invalidate the decision", async () => {
    const revision = await getByName("Revision");
    const approved = (await approve(revision)).body as QuoteView;
    const { body } = await api("PUT", `/api/quotes/${revision.id}`, editBody(approved, { name: "Revision (final)", notes: "Renamed" }));
    expect(body).toMatchObject({ status: "approved", version: 2, termsFingerprint: revision.termsFingerprint });
  });

  it("rejects a decision with an outdated fingerprint with 409 and records nothing", async () => {
    const revision = await getByName("Revision");
    await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { discount: 25 }));
    const res = await approve(revision);
    expect(res.status).toBe(409);
    expect(res.body.quote.discountBps).toBe(2500);
    expect((await api("GET", `/api/quotes/${revision.id}`)).body.decisions).toEqual([]);
  });

  it("rejects a decision on a quote that does not need one with 409", async () => {
    const res = await approve(await getByName("Standard"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("No decision needed: this quote satisfies the approval rule.");
  });

  it.each([
    [{ reason: "" }, "reason", "Required"],
    [{ reason: "   " }, "reason", "Required"],
    [{ decision: "maybe" }, "decision", "Choose approve or reject"],
    [{ termsFingerprint: "abc" }, "termsFingerprint", "Invalid fingerprint"],
  ])("rejects %j with a field-level 400", async (patch, field, message) => {
    const revision = await getByName("Revision");
    const res = await api("POST", `/api/quotes/${revision.id}/decisions`, {
      decision: "approved",
      reason: "ok",
      termsFingerprint: revision.termsFingerprint,
      ...patch,
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ [field]: message });
  });

  it("keeps decisions append-only at the database level", async () => {
    await approve(await getByName("Revision"));
    expect(() => db.prepare("UPDATE decisions SET decision = 'rejected'").run()).toThrow("decisions are append-only");
  });
});

describe("POST /api/demo/reset", () => {
  it("restores the seeded quotes and removes added quotes, edits and decisions", async () => {
    const revision = await getByName("Revision");
    await approve(revision);
    await api("POST", "/api/quotes", newQuote);
    await api("PUT", `/api/quotes/${revision.id}`, editBody(revision, { name: "Edited" }));

    const { status, body } = await api("POST", "/api/demo/reset");
    expect(status).toBe(200);
    expect(body.map((q: QuoteView) => [q.id, q.name, q.version, q.status, q.decisions.length])).toEqual([
      [1, "Standard", 1, "not_required", 0],
      [2, "Large", 1, "pending", 0],
      [3, "Revision", 1, "pending", 0],
    ]);
  });
});

describe("unknown API routes", () => {
  it("return a JSON 404", async () => {
    const res = await api("GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("persistence", () => {
  it("quotes, edits and decisions survive a server and database restart (temp-file database)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quotes-"));
    const file = path.join(dir, "nested", "app.db");
    try {
      let fileDb = openDatabase(file);
      seedIfEmpty(fileDb);
      let server = await start(fileDb);
      const revision = (await server.call("GET", "/api/quotes?search=Revision")).body[0] as QuoteView;
      const approved = (
        await server.call("POST", `/api/quotes/${revision.id}/decisions`, {
          decision: "approved",
          reason: "Strategic account",
          termsFingerprint: revision.termsFingerprint,
        })
      ).body as QuoteView;
      await server.call("PUT", `/api/quotes/${revision.id}`, editBody(approved, { notes: "Persist me" }));
      const created = (await server.call("POST", "/api/quotes", newQuote)).body as QuoteView;
      await server.close();
      fileDb.close();

      fileDb = openDatabase(file); // migrations must be idempotent
      seedIfEmpty(fileDb); // must not re-seed a non-empty database
      server = await start(fileDb);
      const list = (await server.call("GET", "/api/quotes")).body as QuoteView[];
      expect(list.map((q) => q.name)).toEqual(["Standard", "Large", "Revision", "New deal"]);
      const reloaded = (await server.call("GET", `/api/quotes/${revision.id}`)).body as QuoteView;
      expect(reloaded).toMatchObject({ notes: "Persist me", version: 2, status: "approved" });
      expect(reloaded.decisions).toEqual(approved.decisions);
      expect((await server.call("GET", `/api/quotes/${created.id}`)).body.totals).toEqual(created.totals);
      await server.close();
      fileDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
