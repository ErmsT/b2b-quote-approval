// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { getQuote, openDatabase, type Db } from "../server/db.js";
import { seedIfEmpty } from "../server/seed.js";
import { App } from "./App.js";

// The UI talks to the real Express app and domain code, backed by in-memory SQLite.
const nodeFetch = globalThis.fetch;
let db: Db;
let server: Server;
let base: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  seedIfEmpty(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => nodeFetch(base + url, init));
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

const list = () => screen.getByRole("navigation", { name: "Quotes" });
const totals = () => screen.getByRole("region", { name: /^Totals/ });

async function openQuote(name: string) {
  const user = userEvent.setup();
  await user.click(await within(list()).findByRole("button", { name: new RegExp(`^${name}`) }));
  await screen.findByRole("heading", { name: `Edit quote: ${name}` });
  return user;
}

describe("quote list", () => {
  it("renders the seeded quotes with server-computed margin and status", async () => {
    render(<App />);
    const standard = await within(list()).findByRole("button", { name: /^Standard/ });
    expect(standard.textContent).toContain("Net $10,000.00 · Margin 40.0%");
    expect(standard.textContent).toContain("Can proceed");
    const large = within(list()).getByRole("button", { name: /^Large/ });
    expect(large.textContent).toContain("Margin 20.0%");
    expect(large.textContent).toContain("Needs review: awaiting manager decision");
    expect(within(list()).getByRole("button", { name: /^Revision/ }).textContent).toContain("Margin 25.0%");
  });

  it("shows a no-match state for a search without results", async () => {
    render(<App />);
    const user = userEvent.setup();
    await within(list()).findByRole("button", { name: /^Standard/ });
    await user.type(screen.getByLabelText("Search quotes by name"), "xyz");
    expect(await screen.findByText("No quotes match 'xyz'")).toBeTruthy();
    expect(within(list()).queryByRole("button", { name: /^Standard/ })).toBeNull();
  });
});

describe("quote editor", () => {
  it("shows field-level errors linked with aria-describedby and never saves invalid terms", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    const discount = screen.getByLabelText("Discount on total price (%)");
    const quantity = screen.getByLabelText("Quantity");
    await user.clear(discount);
    await user.type(discount, "100.01");
    await user.clear(quantity);
    await user.type(quantity, "1.5");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    for (const [input, message] of [
      [quantity, "Must be a whole number"],
      [discount, "Must be between 0 and 100"],
    ] as const) {
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const describedBy = input.getAttribute("aria-describedby");
      expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(message);
    }
    expect(document.activeElement).toBe(quantity); // focus moves to the first invalid field
    expect(within(totals()).getByText(/appear when every line item and the discount are valid/)).toBeTruthy();
    expect(getQuote(db, 3)).toMatchObject({ discountBps: 2000, version: 1 });
  });

  it("rejects an empty discount instead of treating it as zero", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    await user.clear(screen.getByLabelText("Discount on total price (%)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Required")).toBeTruthy();
    expect(getQuote(db, 3)?.discountBps).toBe(2000);
  });

  it("editing Revision from 20% to 10% previews, saves and makes it Can proceed", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    expect(within(totals()).getByText("Margin 25.0% is below the 30% minimum; discount 20% exceeds the 15% maximum")).toBeTruthy();

    const discount = screen.getByLabelText("Discount on total price (%)");
    await user.clear(discount);
    await user.type(discount, "10");
    expect(within(totals()).getByText("Preview of unsaved changes")).toBeTruthy();
    expect(within(totals()).getByText("33.3%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Quote saved.")).toBeTruthy();
    expect(within(totals()).queryByText("Preview of unsaved changes")).toBeNull();
    expect(within(totals()).getByText("$10,800.00")).toBeTruthy();
    expect(within(totals()).getByText("Can proceed")).toBeTruthy();
    expect(getQuote(db, 3)).toMatchObject({ discountBps: 1000, version: 2 });
    await vi.waitFor(() =>
      expect(within(list()).getByRole("button", { name: /^Revision/ }).textContent).toContain("Margin 33.3%"),
    );
  });

  it("reloads the quote when someone else saved it first (409)", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    // Another reviewer renames the quote in the meantime.
    await nodeFetch(`${base}/api/quotes/3`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Revision (other reviewer)",
        notes: "",
        discount: 20,
        items: [{ description: "Implementation", quantity: 1, unitPrice: 12000, unitCost: 7200 }],
        version: 1,
      }),
    });
    const discount = screen.getByLabelText("Discount on total price (%)");
    await user.clear(discount);
    await user.type(discount, "10");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("This quote changed since you opened it");
    expect(screen.getByRole("heading", { name: "Edit quote: Revision (other reviewer)" })).toBeTruthy();
    expect((screen.getByLabelText("Discount on total price (%)") as HTMLInputElement).value).toBe("20");
    expect(getQuote(db, 3)?.discountBps).toBe(2000);
  });
});

describe("simulated manager decision", () => {
  it("requires a reason, records the approval and announces it", async () => {
    render(<App />);
    const user = await openQuote("Large");
    const panel = screen.getByRole("region", { name: "Simulation: manager decision (no login, no email)" });

    await user.click(within(panel).getByRole("button", { name: "Approve these terms" }));
    const reason = within(panel).getByLabelText("Reason for the decision (required)");
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(reason.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Required");

    await user.type(reason, "Strategic account");
    await user.click(within(panel).getByRole("button", { name: "Approve these terms" }));
    const announcement = await within(panel).findByText("Approval recorded for the current terms.");
    expect(announcement.getAttribute("role")).toBe("status");
    expect(within(totals()).getByText("Approved by manager")).toBeTruthy();
    expect(within(panel).getByText(/applies to the current terms/)).toBeTruthy();
  });

  it("clears the decision confirmation once the saved commercial terms change", async () => {
    render(<App />);
    const user = await openQuote("Large");
    const panel = screen.getByRole("region", { name: /^Simulation/ });
    await user.type(within(panel).getByLabelText(/^Reason/), "Strategic account");
    await user.click(within(panel).getByRole("button", { name: "Approve these terms" }));
    await within(panel).findByText("Approval recorded for the current terms.");

    // Lower the implementation cost so the quote satisfies the rule (margin 42.2%).
    const cost = screen.getAllByLabelText("Unit cost (USD)")[0] as HTMLElement;
    await user.clear(cost);
    await user.type(cost, "10000");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Quote saved.");

    expect(within(panel).getByText(/No manager decision needed/)).toBeTruthy();
    expect(within(panel).queryByText("Approval recorded for the current terms.")).toBeNull();
  });

  it("a price change after approval makes the decision stale and explains why", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    const panel = screen.getByRole("region", { name: /^Simulation/ });
    await user.type(within(panel).getByLabelText(/^Reason/), "Strategic account");
    await user.click(within(panel).getByRole("button", { name: "Approve these terms" }));
    await within(panel).findByText("Approval recorded for the current terms.");

    const price = screen.getByLabelText("Unit price (USD)");
    await user.clear(price);
    await user.type(price, "11500");
    expect(within(panel).getByText(/Save or discard your changes first/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Quote saved.");

    expect(within(totals()).getByText("Needs review: earlier decision no longer applies")).toBeTruthy();
    expect(within(totals()).getByText(/^Approval from .+ applied to earlier terms \(margin 25\.0%, discount 20%\)$/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Approve these terms" })).toBeTruthy();
  });
});

describe("demo reset", () => {
  it("asks for in-page confirmation, can be cancelled, and restores the seeded data", async () => {
    render(<App />);
    const user = await openQuote("Revision");
    const discount = screen.getByLabelText("Discount on total price (%)");
    await user.clear(discount);
    await user.type(discount, "10");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Quote saved.");

    await user.click(screen.getByRole("button", { name: "Restore demo data" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Yes, restore demo data" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Restore demo data" }));
    await user.click(screen.getByRole("button", { name: "Yes, restore demo data" }));
    expect(await screen.findByText("Demo data restored.")).toBeTruthy();
    expect(getQuote(db, 3)).toMatchObject({ discountBps: 2000, version: 1 });
    await vi.waitFor(() =>
      expect(within(list()).getByRole("button", { name: /^Revision/ }).textContent).toContain("Margin 25.0%"),
    );
  });
});
