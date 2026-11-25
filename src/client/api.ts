import type { QuoteView } from "../server/routes/quotes.js";

export type { QuoteView };

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status, or 0 when the server could not be reached. */
      status: number;
      error: string;
      fieldErrors?: Record<string, string>;
      /** The current quote, sent with 409 responses. */
      quote?: QuoteView;
    };

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server" };
  }
  const json = await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, data: json as T };
  return {
    ok: false,
    status: res.status,
    error: json?.error ?? `Request failed (${res.status})`,
    fieldErrors: json?.fieldErrors,
    quote: json?.quote,
  };
}

/** Form-shaped body: amounts in dollars and discount in percent, as typed by the user. */
export interface QuoteForm {
  name: string;
  notes: string;
  discount: string;
  items: { description: string; quantity: string; unitPrice: string; unitCost: string }[];
}

export const api = {
  listQuotes: (search: string) => request<QuoteView[]>("GET", `/api/quotes?search=${encodeURIComponent(search)}`),
  getQuote: (id: number) => request<QuoteView>("GET", `/api/quotes/${id}`),
  createQuote: (form: QuoteForm) => request<QuoteView>("POST", "/api/quotes", form),
  updateQuote: (id: number, form: QuoteForm, version: number) =>
    request<QuoteView>("PUT", `/api/quotes/${id}`, { ...form, version }),
  decide: (id: number, body: { decision: "approved" | "rejected"; reason: string; termsFingerprint: string }) =>
    request<QuoteView>("POST", `/api/quotes/${id}/decisions`, body),
  resetDemo: () => request<QuoteView[]>("POST", "/api/demo/reset"),
};
