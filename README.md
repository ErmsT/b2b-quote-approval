# Quote Margin & Approval Prototype

A small working prototype: an account manager builds a fixed-price quote. The app shows net revenue, margin and whether the deal can proceed or needs a manager decision. A simulated manager approves or rejects exceptions. An approval never carries over to terms the manager did not see.

- **Deployed app:** https://b2b-quote-approval.fly.dev/
- **Public repository:** https://github.com/ErmsT/b2b-quote-approval

> The deployed demo uses **one shared database for every reviewer**. Others may edit the same quotes while you look at them. Use **Restore demo data** (bottom of the quote list) to return to the three seeded cases.

## Problem and users (fictional scenario)

- **Customer:** a B2B implementation-services firm that negotiates fixed-price projects.
- **Buyer:** the commercial director.
- **Primary user:** a sales account manager preparing a quote during a customer negotiation.
- **Secondary user:** a sales manager reviewing exceptions. This role is simulated, with no login.
- **Workflow replaced:** prices, delivery costs and discount approvals scattered across spreadsheets.
- **Business outcome sought:** move sensible deals forward quickly while keeping margin and exceptions visible.

## Key trade-off: speed vs. commercial risk

Requiring approval for every quote would make deals safe but slow. Requiring none would make them fast but would let low-margin or heavily discounted deals through unseen. The prototype takes a middle path with one deterministic rule:

- A quote **can proceed** with no approval when margin ≥ 30% and discount ≤ 15%. Most ordinary edits during a negotiation need no one else's time.
- Only exceptions **need review**: a margin below 30%, a discount above 15%, or no revenue. The reason is always shown, e.g. "Margin 25.0% is below the 30% minimum; discount 20% exceeds the 15% maximum".
- A decision covers exactly the terms the manager saw, identified by a fingerprint of those terms. If the price, cost, quantity, description or discount changes afterwards, the approval no longer applies. If the new terms still need review, a new decision is required. Renaming the quote or editing notes does not invalidate a decision.

The thresholds are a product decision, not a finding. They live in one constant (`APPROVAL_RULE` in `src/domain/approval.ts`).

## Proposed metric: quote turnaround time, by exception reason

- **Definition:** time from a quote's `createdAt` to the first moment its status is `not_required` or `approved`, grouped by exception reason (margin below the minimum, discount above the maximum, both, no revenue, none).
- **Why:** it shows whether the rule keeps ordinary quotes fast, and which exception types slow deals down.
- **How it would be measured:**
  - The prototype already stores `createdAt` per quote and `decidedAt` per decision.
  - Measuring "first moment within the rule" also needs an append-only log of term changes with timestamps; see Next steps.
- **Status:** no results are claimed. The prototype has not been used with real users or deals.

## Deliberately left out

- Login, authentication, roles and access control. The manager role is a labelled simulation in the same browser.
- Real email or notifications, tax, payments and contracts.
- Multiple currencies (USD only), quote deletion and PDF export.
- Any prediction language or scoring. The rule is deterministic.
- Browser storage of any kind. The server database is the only source of truth.

## Rules & assumptions

- **Money** is stored and computed in integer cents (USD). Floats are used only for display.
- **Discount** is entered as a percentage from 0 to 100 inclusive with at most 2 decimals, and stored as integer basis points (15.01% = 1501 bp). The discount reduces price, never cost.
- **Net revenue** = gross revenue × (1 − discount), rounded half up to the nearest cent. Margin is computed from that rounded net revenue, so the displayed net revenue is the value the rule uses.
- **Margin** = (net revenue − total cost) / net revenue. With zero net revenue (no items, all prices 0, or a 100% discount) the margin is undefined, shown as "—" with "No revenue: margin cannot be calculated", and the quote needs review.
- **Approval rule (product decision):** a quote can proceed when margin ≥ 30% and discount ≤ 15%; otherwise it needs review. The thresholds live only in `APPROVAL_RULE` (`src/domain/approval.ts`).
- **Rounding vs. thresholds:** comparisons use unrounded values, done exactly in integer arithmetic. Display rounds currency to 2 decimals and margin to 1 decimal. Consequence: a 29.96% margin displays as "30.0%" yet needs review. When a margin is within 0.1 pp of the threshold, the explanation shows 2 decimals ("Margin 29.96% is below the 30% minimum").
- **Commercial terms** = line items (description, quantity, unit price, unit cost) + discount. The terms fingerprint is a SHA-256 of these normalized terms. Item order does not affect it, and descriptions are trimmed. Quote name and notes are not commercial terms, so editing them does not invalidate a decision.
- **Status** is derived on every read: `not_required` when the terms satisfy the rule; otherwise `approved`/`rejected` from the latest decision whose fingerprint matches the current terms, `stale` if decisions exist only for other terms, and `pending` if there are none. If the terms are reverted to ones already decided, that earlier decision applies again, because the manager saw exactly those terms.
- **Invalidation:** an edit that brings a quote within the rule makes it `not_required`. Earlier decisions stay in the history, but none is shown as current.
- **Validation:** quantity is a whole number ≥ 1. Unit price and unit cost are ≥ 0 with at most 2 decimals. Empty or non-numeric input is an error, never a zero. Exponent notation ("1e3") and currency symbols are rejected. Quote name and item description are required (assumption: an item without a description is not meaningful). A decision reason is required.
- **Dates** in the stale-decision message are formatted in UTC.
- **Decisions only where review is needed:** the API rejects (409) a decision on a quote whose current terms already satisfy the rule, so the history holds only meaningful decisions.
- **Decisions only on saved terms:** while the editor has unsaved changes, the manager panel is disabled. The manager decides on what is stored, not on a draft.
- **Live preview:** while editing, the totals panel previews totals, margin and status from the unsaved input using the same domain code as the server, and labels it "Preview of unsaved changes". On save, the server recomputes everything and its values replace the preview.
- **Search** matches the quote name, case-insensitive, and treats `%` and `_` literally. The list is ordered by id.
- **Shared demo database:** every reviewer of the deployed app sees and edits the same data. Concurrent edits are caught by optimistic concurrency (see below). Restore demo data affects everyone.

## Local setup

Requires Node 22 or later.

```bash
npm install
npm run dev        # server on :3000 (tsx watch) + Vite client on :5173 with /api proxied
npm test           # Vitest: domain, API and UI tests
npm run lint
npm run typecheck
npm run build      # client to dist/client, server to dist/server
npm start          # serves API + built client on PORT (default 3000)
npm run db:reset   # drop data and re-seed (local only)
```

The SQLite file path comes from `DATABASE_PATH` (default `./data/app.db`). Migrations run on startup. The seed runs only when the quotes table is empty.

## Deployment (Fly.io)

The app is deployed as one Fly Machine with a Fly volume holding the SQLite file. Serverless hosts without a persistent disk are not suitable for SQLite.

The deployment files:

- `Dockerfile`: a multi-stage build on `node:22-bookworm-slim`. The first stage installs dependencies and builds the client and server. The runtime image contains only `dist/` and production dependencies.
- `fly.toml`:
  - mounts the volume `quote_data` at `/data` and sets `DATABASE_PATH=/data/app.db`;
  - checks health with `GET /api/quotes`;
  - stops the machine when idle and restarts it on the next request. The data stays on the volume, but the first request after idle has a cold start of a few seconds.
- On startup the server runs any pending migrations, then seeds the three demo quotes only if the database is empty.

**It must run as exactly one machine.** Each Fly volume belongs to one machine. A second machine would get its own empty database, and reviewers would see different data depending on which machine served them.

First deployment (requires [flyctl](https://fly.io/docs/flyctl/install/) and a Fly.io account):

```bash
# 1. Edit `app` (globally unique) and `primary_region` in fly.toml.
fly apps create <app-name>
fly volumes create quote_data --size 1 --region <primary_region>
fly deploy --ha=false
```

Later deployments: `fly deploy --ha=false`. Restoring the demo data on the deployed app uses the **Restore demo data** button. There is no shell step.

## Key engineering choices

- **Server-side SQLite** (`better-sqlite3`): a single file on a persistent volume, with plain SQL migrations (`src/server/migrations/`). Decisions sit in an append-only table, and a database trigger rejects updates.
- **Shared, pure domain code** (`src/domain/`): calculation, rule, fingerprint, status and the Zod validation schema have no framework, HTTP or database imports. The client and server use the same functions and the same validation messages.
- **The server never trusts the client.** Every response recomputes totals, margin, fingerprint and status from stored terms. Client-sent totals or status are ignored.
- **Optimistic concurrency:** every quote has a `version`. A `PUT` with an outdated version returns 409 with the current quote, and the UI shows "This quote changed since you opened it" and loads the latest version. A decision whose `termsFingerprint` no longer matches the current terms also returns 409.
- **Small API:** `GET /api/quotes?search=`, `GET /api/quotes/:id`, `POST /api/quotes`, `PUT /api/quotes/:id`, `POST /api/quotes/:id/decisions`, `POST /api/demo/reset`. Validation errors return 400 with field-level messages, which the UI shows next to each field via `aria-describedby`.

## What was tested

Automated tests (`npm test`, 122 tests, all passing at the time of writing):

- **Domain** (`src/domain/*.test.ts`):
  - the three seeded cases, including Revision at 20% and at 10%;
  - zero revenue: no items, all prices 0, and a 100% discount;
  - margin 29.99% / 30.00% / 30.01%, and the 29.96% display case;
  - discount 15% / 15.01%;
  - half-up rounding of net revenue;
  - validation: quantity 0, −1, 1.5; price −1; discount −1 and 100.01; empty and non-numeric input; discount 0 and 100 accepted;
  - fingerprint stability and sensitivity;
  - every status transition, including Revision approved at 20% then changed to 10% (`not_required`), approved then repriced (`stale`), and a name-only edit (still `approved`).
- **API** (`src/server/api.test.ts`), against in-memory SQLite:
  - all endpoints, including 400 field errors and malformed JSON;
  - 404 for unknown quotes;
  - 409 for an outdated version, an outdated fingerprint, and a decision that isn't needed;
  - client-supplied totals being ignored;
  - the append-only trigger and demo reset;
  - a restart test with a temp-file database: data survives, migrations rerun cleanly, and the seed does not run twice.
- **UI** (`src/client/App.test.tsx`), Testing Library with jsdom against the real Express app and in-memory SQLite:
  - seeded list rendering;
  - the search no-match state;
  - field errors linked with `aria-describedby`, and focus moving to the first invalid field;
  - an empty discount rejected rather than treated as 0;
  - Revision 20% → 10%: preview, save, then "Can proceed";
  - adding a line item to Standard (Support, $5,000 price and cost): the preview and saved totals show $15,000 revenue, $11,000 cost and 26.7% margin, the status becomes Needs review, and the new item is still there when the app is rendered again;
  - the 409 conflict reload;
  - a manager decision with a required reason, and the `role="status"` announcement;
  - the decision confirmation cleared once the saved commercial terms change;
  - stale after a price change;
  - demo reset: confirmation, Escape to cancel, focus on Cancel.
- **Deployed app check by the agent** (Fly.io, region `iad`; image built on Fly's remote builder):
  - one machine is running, with the volume mounted at `/data`, and the server logs `database: /data/app.db`;
  - the health check passes. It failed once during the two seconds before the server started listening;
  - the live API returns the three seeded cases with the expected margins and statuses;
  - a decision recorded through the live API was still there after `fly machine restart`. The demo data was then restored through `POST /api/demo/reset`;
  - in the browser at 1400px, the live site renders like the local build, with no console errors or warnings;
  - a redeploy (`fly deploy --ha=false`) updated the same machine in place, with the same volume, and the existing data was still there afterwards;
  - waking from idle after auto-stop: the first request took 5.1 seconds, and the app then responded normally.
- **Manual smoke test by the agent:**
  - the built server seeded the cases and an approval survived a server restart;
  - `npm run db:reset` restored the seeded data;
  - the built client was served from the same process.
- **Real-browser checks by the agent** against the built app with a scratch database, measuring element positions and reviewing screenshots. Earlier passes used Microsoft Edge through a Playwright script. The final pass, after the CSS rework, used the Playwright MCP browser (Chromium).
  - **Decision confirmation fix:** approving Large, then lowering a unit cost and saving, removes "Approval recorded for the current terms." The panel shows only "No manager decision needed…" and the history entry is marked "earlier terms".
  - The saved change survives a page reload.
  - **Desktop, 1280 / 1400 / 1440px:**
    - three columns: quote list, editor, and a sticky Totals and manager column;
    - line items end 37px or more before the Totals and manager column (e.g. 983px vs 1020px at 1400px), so nothing overlaps;
    - no horizontal scroll.
  - **Tablet, 820×1024:** two columns (list and editor), with Totals and the manager panel stacked below the form. No horizontal scroll. The narrowest line-item input is 194px wide.
  - **Mobile, 390×844:**
    - a single column;
    - line-item fields stack, with the description using the full row;
    - no horizontal scroll;
    - every button and input is at least 44px tall.
  - **Validation:** quantity `1.5` and discount `100.01` show "Must be a whole number" and "Must be between 0 and 100" next to their fields, with red borders and a tinted background. Focus moves to the quantity field, and the other fields in the row stay aligned.
  - **Keyboard:** Tab reaches search → New quote → each quote → Restore demo data. Each stop shows a 2px blue `:focus-visible` outline. Enter opens a quote.
  - **Demo-reset confirmation:**
    - opened with the keyboard, it focuses Cancel with a visible outline;
    - Escape closes it and returns focus to "Restore demo data";
    - confirming restores the seeded data.
  - **New quote** (local build, 1400px):
    - submitting the empty form shows "Required" next to name, description, unit price and unit cost, moves focus to the name field, and saves nothing;
    - a two-item quote with a 5% discount previews $9,500.00 net and 38.9% margin (correct by hand);
    - "Create quote" opens it in the editor with the server's figures, announces "Quote created.", and adds it to the list as the selected quote;
    - it is still there after a page reload;
    - a quote with no line items is created with margin "—", "No revenue: margin cannot be calculated", status Needs review, and the manager panel offered.
    - This flow has no automated UI test.
  - **Stale state:** the warning callout ("Approval from … applied to earlier terms …") and the "earlier decision no longer applies" badge render as intended.
  - **Console:** no errors or warnings. The inline SVG favicon removed the earlier `/favicon.ico` 404.
  - **Colour contrast**, computed from the CSS values against WCAG 2.1:
    - input borders: 4.8:1 on white and 4.6:1 on the canvas, above the WCAG 1.4.11 minimum of 3:1;
    - all text pairs pass AA at 4.5:1 or more, the lowest being links on the canvas at 4.9:1;
    - status badges are 6.4–6.8:1;
    - the focus outline is 5.2:1 on white.

**Resolved:**
- The 1400px line-item overlap. The cause was the fieldset's default `min-width: min-content`. Fixed with `min-width: 0` and a container query, so line items lay out by the width actually available.
- The 1.67:1 input border contrast.

## What remains untested

- **Screen-reader output:** no screen reader was used. Live-region announcements are covered only by `role="status"` assertions in the UI tests.
- Firefox and Safari: only Chromium-based browsers (Edge, Playwright's Chromium) were used. The layout relies on CSS container queries, which current versions of all three support, but this was not checked.
- Viewports other than 1280, 1400, 1440, 820 and 390px wide, and browser zoom levels above 100%.
- **The deployed environment, beyond the checks above:** several reviewers editing at the same time.
- The Docker image has only been built on Fly's remote builder, never locally.
- `npm run dev` (watch mode with the Vite proxy) was not exercised by automated tests.
- Very large values: quantity × price above about $90 billion per line would exceed exact integer arithmetic in JavaScript. No upper bound is enforced.

## Known limitations

- Navigating to another quote with unsaved edits discards them without a warning.
- The 409 reload replaces the user's unsaved edits with the latest version, and the user re-applies their change. There is no merge.
- No pagination. The list fetches every matching quote with its history, which is fine at demo scale only.
- Dates in the decision history use the browser's locale and time zone. The stale message uses UTC.

## Next steps

- Record an append-only log of term changes with timestamps, so the turnaround metric can be computed from data rather than only from `createdAt` and `decidedAt`.
- Warn before leaving a quote with unsaved changes.
- Run the full manual checklist below against the deployed app (https://b2b-quote-approval.fly.dev/). Deployment, persistence across a machine restart, and demo reset have been checked there; the rest of the checklist has not.
- Add an automated UI test for creating a whole new quote ("New quote"). It has been checked by hand in the browser only. Adding line items to an existing quote is covered by a UI test.

## Reviewer walkthrough (seeded cases)

1. **Standard**: discovery $2,000 / $1,200 and implementation $8,000 / $4,800, 0% discount. Net $10,000.00, cost $6,000.00, margin **40.0%**, status **Can proceed**. No manager decision is offered.
2. **Large**: implementation $20,000 / $15,000 and training $5,000 / $3,000, 10% discount. Net $22,500.00, cost $18,000.00, margin **20.0%**, status **Needs review**: "Margin 20.0% is below the 30% minimum; discount 10% is within the 15% maximum". Enter a reason in the simulated manager panel and approve. The status becomes **Approved by manager**.
3. **Revision**: implementation $12,000 / $7,200, 20% discount. Net $9,600.00, margin **25.0%**, **Needs review** for both reasons.
   - **a.** Approve it with a reason, then change the unit price to 11500 and save. The status becomes **Needs review: earlier decision no longer applies**, with "Approval from [date] applied to earlier terms (margin 25.0%, discount 20%)".
   - **b.** Change the discount to 10 and save. Net $10,800.00, margin **33.3%**, **Can proceed**. The earlier approval stays in the history, marked "earlier terms".
4. Use **Restore demo data**, then confirm, to return to the starting state.

## Reproducible manual checklist

- [ ] Open the deployed app. The three seeded quotes are listed with margin and status.
- [ ] Search "rev" shows only Revision. Search "xyz" shows "No quotes match 'xyz'".
- [ ] Edit Revision's discount to 10 and save. Reload the page: the change is still there.
- [ ] Enter quantity `0`, `-1` and `1.5`, unit price `-1`, discount `-1`, `100.01` and an empty discount. Each shows a message next to its field. Save does not store anything; reload to confirm.
- [ ] Boundaries: a single item at price 100 and cost 70.01 needs review ("Margin 29.99% …"). Cost 70 can proceed ("Margin 30.00% …"). Cost 69.99 can proceed. With cost 10, discount 15 can proceed and 15.01 needs review.
- [ ] Cost 70.04 at price 100 shows margin "30.0%" but needs review, with "Margin 29.96% is below the 30% minimum".
- [ ] Approve Large with a reason. The confirmation is announced (screen reader) and the status shows Approved. Rename the quote: it stays Approved.
- [ ] Open the same quote in two tabs, save in one, then save in the other. The second shows "This quote changed since you opened it" and loads the latest version.
- [ ] Everything works with the keyboard alone, with visible focus. Escape cancels the demo-reset confirmation.
- [ ] Restart the server (or redeploy). Data and decisions persist.
- [ ] Restore demo data. The three seeded cases return, and decisions are gone.

## AI usage

This prototype was built with an AI coding agent (Claude Code), working from `AGENTS.md` in three reviewed phases. The agent generated:

- the project scaffold and configuration;
- the domain layer and its unit tests;
- the SQLite schema, migrations, seed and Express API, with integration tests;
- the React client and its UI tests;
- the initial draft of this README.

The author reviewed each phase and approved the documented assumptions before the next phase started.

### My changes

- **Agent specification & guardrails (`AGENTS.md`):** Authored the repository specification before generating code—locking the stack, pure domain boundary (`src/domain/`), integer-cents arithmetic, approval thresholds (`margin >= 30%` and `discount <= 15%`), deterministic terms fingerprinting, optimistic concurrency, and explicit out-of-scope constraints.
- **Architectural & domain sign-off:** Reviewed and confirmed key edge-case choices during phased delivery (half-up cent rounding for net revenue so displayed totals match threshold checks, re-applying an existing decision if terms are reverted to an exact previously decided fingerprint, rejecting decisions with `409` when terms already satisfy the rule, and disabling 
manager actions while edits are unsaved).
- **UI & bug-fix direction:** Caught a stale confirmation banner bug in `DecisionPanel` during manual browser testing (where `"Approval recorded for the current terms."` remained visible after saving revised commercial terms) and directed the regression test, fix, and responsive/contrast polish.
- **Code review:** Reviewed the domain math, Zod schemas, SQLite migrations/triggers, API handlers, and React components to ensure server-side recomputation and clean separation of concerns.

### My personal checks

- **Seeded quotes & Revision workflow:** Verified all three seeded records (`Standard`, `Large`, `Revision`) in the browser. Edited `Revision` from `20%` discount (`$9,600.00` net, `25.0%` margin, `Needs review`) to `10%` discount (`$10,800.00` net, `33.3%` margin) and confirmed it transitioned to `Can proceed` and persisted across page reloads.
- **Manager simulation & stale approval invalidation:** Tested `Large` by attempting to approve without a reason (blocked by validation), recording an approval with a reason (`Approved by manager`), verifying that non-commercial edits (`Notes`) kept the approval intact, and verifying that changing commercial terms cleared the old confirmation banner and required fresh evaluation (`Can proceed` when brought inside the rule, or `Stale` when kept outside).
- **Validation & boundary inputs:** Tested invalid quantities, negative values, out-of-range discounts, and zero-revenue scenarios in the form UI, confirming inline error feedback and that invalid values cannot be saved.
- **Responsive layout & demo reset:** Inspected desktop and mobile viewports for alignment, input border contrast, keyboard focus navigation, and the in-page `Restore demo data` confirmation dialog.