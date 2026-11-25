import { useEffect, useState } from "react";
import { formatUsd } from "../domain/money.js";
import { api, type QuoteView } from "./api.js";
import { formatMargin, STATUS_LABEL } from "./TotalsPanel.js";

interface QuoteListProps {
  selectedId: number | "new" | null;
  /** Changes whenever saved data changed and the list must be fetched again. */
  refreshKey: number;
  onSelect: (id: number) => void;
  onNew: () => void;
}

type ListState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; quotes: QuoteView[]; search: string };

export function QuoteList({ selectedId, refreshKey, onSelect, onNew }: QuoteListProps) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const term = search.trim();
    const timer = setTimeout(async () => {
      const res = await api.listQuotes(term);
      if (cancelled) return;
      setState(res.ok ? { kind: "ready", quotes: res.data, search: term } : { kind: "error" });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, refreshKey, retryKey]);

  return (
    <nav className="quote-list" aria-labelledby="list-heading">
      <h2 id="list-heading">Quotes</h2>
      <div className="field">
        <label htmlFor="quote-search">Search quotes by name</label>
        <input id="quote-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <button type="button" onClick={onNew} aria-pressed={selectedId === "new"}>
        New quote
      </button>

      {state.kind === "loading" && <p role="status">Loading quotes…</p>}
      {state.kind === "error" && (
        <div className="banner banner-error" role="alert">
          Could not load quotes.{" "}
          <button type="button" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}
      {state.kind === "ready" && state.quotes.length === 0 && (
        <p role="status">{state.search ? `No quotes match '${state.search}'` : "No quotes yet. Create one to get started."}</p>
      )}
      {state.kind === "ready" && state.quotes.length > 0 && (
        <ul>
          {state.quotes.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className="quote-item"
                aria-current={q.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(q.id)}
              >
                <span className="quote-name">{q.name}</span>
                <span className="quote-meta">
                  Net {formatUsd(q.totals.netRevenueCents)} · Margin {formatMargin(q.totals.margin)}
                </span>
                <span className={`status status-${q.status}`}>{STATUS_LABEL[q.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
