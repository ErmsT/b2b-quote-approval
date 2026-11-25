AGENTS.md — Quote Margin & Approval Prototype

Operating instructions for coding agents in this repository. Follows the open AGENTS.md standard. For tools that look for a different file name: ln -s AGENTS.md CLAUDE.md · ln -s AGENTS.md GEMINI.md

Working code only. Finish the job. Plausibility is not correctness.

0. Non-negotiables

These override everything below.

No flattery, no filler. Get to the point.
Disagree when the premise is wrong (e.g. a calculation that contradicts the seeded cases).
Never fabricate numbers, test results, metrics, customer research, revenue or savings. Missing information is labeled an assumption, never stated as fact.
Confused? Stop and ask.
Touch only what the request requires.
1. Before writing code
State the plan in 1–2 sentences before editing.
Read the affected files and their callers. Match existing patterns.
State assumptions explicitly. If an assumption is a business rule, also record it in the README (Rules & assumptions).
When there is a real choice (e.g. round before or after comparing to a threshold), present the options and the trade-off in a few lines.
2. Writing code: simplicity first
Write the minimum code. This is one small, finished workflow in 3–5 hours, not an enterprise product.
No speculative features, no single-use abstractions, no handling for impossible cases.
Prefer deleting code to adding it.
Calculation and approval logic live in pure functions (src/domain/) with no framework, HTTP or database imports, so they are trivially testable and shared by client and server.
3. Surgical changes
Every changed line must trace back to the request.
Do not refactor or reformat adjacent code.
Mention pre-existing dead code; do not remove it.
Clean up only what your own edits orphaned.
4. Goal-driven execution

Turn vague requests into verifiable goals:

Request	Verifiable goal
"Fix the margin"	Failing test using a seeded case → make it pass
"Stale approvals must not apply"	Test: approve → edit price → status becomes stale and a new decision is required
"Validate discount"	Test: −1, 100.01 and empty input are rejected with a message by both UI and API; 0 and 100 are accepted

Run the verification. Fix the cause, never the test.

5. Tool use and verification
Run test, lint and typecheck before reporting done. Never report success from a diff alone.
UI changes: verify visually in a browser, including keyboard focus and validation messages.
Persistence changes: verify the state survives a page reload and a server restart.
Read full logs and stack traces.
Never write in the README that something was tested if it was not. Untested items go under What remains untested.
6. Session hygiene
Context is scarce. Use subagents for broad exploration.
After two failed corrections, stop and ask for a sharper prompt in a fresh session.
Small commits with descriptive messages (feat: invalidate approval when commercial terms change).
7. Communication style
Direct and concise. No unprompted headers, no emoji.
Celebrate only meaningful outcomes (e.g. "all boundary cases pass").
All code, comments, UI copy, commit messages and docs are in English.
8. When to ask, when to proceed

Ask when:

interpretations diverge (e.g. should the discount reduce cost? → no, see §10);
a change touches the approval rule, the margin formula, the database schema or the API contract;
the goal conflicts with scope (e.g. login, tax, real email → out of scope).

Proceed when the task is trivial and reversible, or when reading code or running a command resolves the ambiguity.

9. Self-improvement loop
After a user correction, add a rule to §11. If the rule existed and was ignored, make it sharper.
Prune regularly. Keep this file under ~300 lines.
10. Project context
Problem and users (fictional scenario)
Customer: B2B implementation-services firm negotiating fixed-price projects.
Buyer: commercial director.
Primary user: sales account manager preparing a quote during a customer negotiation.
Secondary user: sales manager reviewing exceptions (simulated, no login).
Workflow replaced: prices, delivery costs and discount approvals scattered across spreadsheets.
Desired outcome: move a sensible deal forward quickly while making margin and exceptions clear. Do not require approval for every edit. Do not let a stale approval cover changed terms.
Stack (suggested default; change if preferred)
Client: Vite + React + TypeScript (strict)
Server: Node + Express (or Fastify) + TypeScript, serving a small JSON API and the built client from one process
Database: SQLite via better-sqlite3, file on a persistent volume. Migrations are plain SQL files run on startup.
Validation: one shared schema (e.g. Zod) used by both client and server
Tests: Vitest for domain and API (API tests run against an in-memory SQLite database); Testing Library for targeted UI tests
Deploy: a single service on a host with a persistent disk (e.g. Fly.io with a volume, or Railway). Serverless hosts without a persistent disk are not suitable for SQLite.
No browser storage of any kind (localStorage, sessionStorage, IndexedDB, cookies for data). The server database is the only source of truth; the client holds only in-memory UI state.
Commands
bash
npm install        # install
npm run dev        # client + server in watch mode
npm run build      # production build
npm start          # run built server (serves API + client)
npm test           # vitest run
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run db:reset   # drop data and re-seed (local only)
Layout
src/
  domain/          # pure functions: money, quote calc, approval rule, terms fingerprint, validation schema
  server/          # app.ts, routes/, db.ts, migrations/, seed.ts
  client/          # components: QuoteList, QuoteEditor, LineItemRow, TotalsPanel, DecisionPanel; api.ts
tests/             # or *.test.ts next to the code
README.md
AGENTS.md
API (keep it this small)
Method	Path	Purpose
GET	/api/quotes?search=	List quotes with computed totals and status
GET	/api/quotes/:id	One quote, its terms, computed status and decision history
POST	/api/quotes	Create a quote
PUT	/api/quotes/:id	Replace quote terms; body includes version
POST	/api/quotes/:id/decisions	Simulated manager decision { decision, reason, termsFingerprint }
POST	/api/demo/reset	Restore seeded demo data
The server recomputes totals, margin, fingerprint and status. Never trust values computed by the client.
Optimistic concurrency: every quote has a version. A PUT with an outdated version returns 409 with the current quote; the UI shows "This quote changed since you opened it" and reloads it. This matters because the deployed demo has one shared database for all reviewers.
A decision whose termsFingerprint does not match the current terms is rejected with 409. A manager can only decide on the terms they actually saw.
Validation errors return 400 with field-level messages that the UI shows next to the fields.
Domain rules (source of truth; do not change without asking)

Calculation

Currency: USD. Store and compute money in integer cents; discount as basis points or a validated decimal.
lineRevenue = quantity × unitPrice; lineCost = quantity × unitCost
grossRevenue = Σ lineRevenue
netRevenue = grossRevenue × (1 − discount%). The discount applies to the total price.
The discount reduces price, not cost. totalCost = Σ lineCost
margin = (netRevenue − totalCost) / netRevenue
Zero revenue (no items, all prices 0, or 100% discount): margin is undefined. Display "—" with "No revenue: margin cannot be calculated". Status is Needs review. Never divide by zero; never show NaN or Infinity.
Display rounding: currency to 2 decimals ($10,800.00), margin to 1 decimal (33.3%). Threshold comparisons use the unrounded value. Documented consequence: 29.96% displays as "30.0%" yet is below the threshold. The explanation text shows two decimals when a value is within 0.1 pp of a threshold.

Approval rule (suggested; document in the README as a product decision)

Can proceed when margin ≥ 30% and discount ≤ 15%.
Needs review when margin < 30% or discount > 15% or margin is undefined.
The UI always shows why (e.g. "Margin 25.0% is below the 30% minimum; discount 20% exceeds the 15% maximum").
Thresholds live in a single constant (APPROVAL_RULE) in src/domain/, never duplicated.

Input validation (enforced by the shared schema on client and server; message shown next to the field, linked with aria-describedby; invalid terms are never saved)

Quantity: integer ≥ 1
Unit price and unit cost: number ≥ 0, at most 2 decimal places
Discount: 0–100 inclusive
Empty or non-numeric input → error, never a silent zero

Decisions and commercial terms

Commercial terms = line items (description, quantity, unit price, unit cost) + discount.
Each manager decision (approve/reject) stores decision, reason (required, non-empty), decidedAt, termsFingerprint, and a snapshot of the reviewed terms (totals, margin, discount).
termsFingerprint = deterministic hash (e.g. SHA-256) of normalized commercial terms, with items in a stable order.
Status is derived on every read, never stored as a loose flag:
not_required: current terms satisfy the rule
pending: review needed and no decision exists for these terms
approved / rejected: a decision exists whose fingerprint matches the current terms
stale: a decision exists but for different terms → a new decision is required if the rule still requires review; show "Approval from [date] applied to earlier terms (margin X%, discount Y%)"
Edits that do not change commercial terms (quote name, notes) do not invalidate a decision.
An edit that brings the quote within the rule makes it not_required; the earlier decision remains in history but is not shown as current.
Decision history is append-only (a decisions table; no updates or deletes outside demo reset).

Simulation

The manager panel carries the visible label "Simulation: manager decision (no login, no email)".
The same browser plays both roles.
Seeded cases (must match exactly; each one is a test)
Quote	Items (price/cost, qty 1)	Discount	Net revenue	Cost	Margin	Expected status*
Standard	discovery $2,000/$1,200 · implementation $8,000/$4,800	0%	$10,000	$6,000	40.0%	Can proceed
Large	implementation $20,000/$15,000 · training $5,000/$3,000	10%	$22,500	$18,000	20.0%	Needs review
Revision	implementation $12,000/$7,200	20% → 10%	$9,600 → $10,800	$7,200	25.0% → 33.3%	Needs review → Can proceed

* Under the suggested rule. If the rule changes, update this table, the tests and the README together.

Persistence
SQLite file path comes from DATABASE_PATH; default ./data/app.db locally, a mounted volume in production.
Migrations run on startup. Seed runs only when the quotes table is empty.
"Restore demo data" button calls POST /api/demo/reset, behind an accessible in-page confirmation (no window.confirm). Labeled as a demo-only action.
The deployed database is shared by every reviewer. The README states this and points to the reset button.
Required UX
Quote list with search and an empty / no-matching-results state ("No quotes match 'xyz'").
Loading and server-error states for every request (e.g. "Could not save. Your changes are still on screen. Retry").
Readable hierarchy: totals, margin and status with its reason always visible in the editor.
Every control has a <label>, is keyboard operable and has visible focus; decision confirmation is announced via aria-live.
No elaborate branding, no extra screens.
Minimum required tests
All three seeded cases, including Revision before and after.
Zero revenue: no items; 100% discount.
Rule boundaries: margin 29.99% / 30.00% / 30.01%; discount 15% / 15.01%.
Validation (domain and API): qty 0, −1, 1.5; price −1; discount −1, 100.01.
Approve Revision at 20% → change to 10% → status leaves approved (becomes not_required); approve → change price while still outside the rule → stale.
A name-only edit does not invalidate a decision.
Decision submitted with an outdated fingerprint → 409. PUT with an outdated version → 409.
Data persists across server restart (API test using a temp-file database).
Do not modify without asking
APPROVAL_RULE, formulas in src/domain/, the database schema and migrations, the API contract, the seeded-cases table.
Forbidden patterns
Any browser storage for application data (localStorage, sessionStorage, IndexedDB).
Floats for money in calculations (display only).
Approval status stored as a boolean without its terms fingerprint.
Server trusting client-computed totals, margin or status.
Prediction language ("risk score", "likelihood to close"). Rules are deterministic and described as such.
Login, authentication, tax, payments, contracts, real email, access control, paid external APIs.
Real customer data, production passwords or secrets committed to the repo.
README claims of revenue, savings or research that the prototype has not demonstrated.
README deliverables (checklist)
[ ] Buyer, primary user, business outcome, workflow replaced
[ ] Key trade-off: speed vs. commercial risk, and how the rule avoids unnecessary approval work
[ ] Proposed metric: quote turnaround time, with the exception reason visible, and how it would be measured (from createdAt to the first status of not_required or approved, grouped by exception reason; the prototype records the timestamps but does not claim real results)
[ ] What was deliberately left out
[ ] Rules and assumptions (rounding, zero revenue, approval rule, invalidation, shared demo database)
[ ] Local setup, key engineering choices (server-side SQLite, shared domain code, optimistic concurrency)
[ ] What was tested, known limitations, next steps, what remains untested
[ ] Reviewer walkthrough using the three seeded cases
[ ] Reproducible manual checklist (deployed flow, reload, invalid input, boundaries)
[ ] AI usage: the agent describes what it generated; "My changes" and "My personal checks" stay as TODO (human). The agent never fills these in on the author's behalf.
[ ] Links: deployed app + public repository
11. Project Learnings
<!-- One concrete rule per line, appended after user corrections. -->
No browser storage. Persistence is server-side only.
All project text is in English.
12. How this file was built

Structure based on FerroxLabs/agents-md (Karpathy's principles, Boris Cherny's Claude Code workflow, Anthropic best practices, the AGENTS.md standard), adapted to the "Quote Margin & Approval" challenge brief.