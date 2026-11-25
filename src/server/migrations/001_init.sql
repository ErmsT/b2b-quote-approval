CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE line_items (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes (id),
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  UNIQUE (quote_id, position)
);

-- Append-only history. Each row stores a snapshot of the terms the manager reviewed.
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes (id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  decided_at TEXT NOT NULL,
  terms_fingerprint TEXT NOT NULL,
  gross_revenue_cents INTEGER NOT NULL,
  net_revenue_cents INTEGER NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  discount_bps INTEGER NOT NULL,
  margin REAL -- NULL when there was no revenue
);

CREATE INDEX decisions_by_quote ON decisions (quote_id, id);

CREATE TRIGGER decisions_append_only BEFORE UPDATE ON decisions
BEGIN
  SELECT RAISE(ABORT, 'decisions are append-only');
END;
