import { useCallback, useEffect, useState, type FormEvent } from "react";
import { assessQuote } from "../domain/quote.js";
import { fieldErrors, quoteInputSchema, termsInputSchema } from "../domain/schema.js";
import { describeStaleDecision } from "../domain/status.js";
import { api, type QuoteForm, type QuoteView } from "./api.js";
import { DecisionPanel } from "./DecisionPanel.js";
import { Field } from "./Field.js";
import { LineItemRow, type ItemForm } from "./LineItemRow.js";
import { TotalsPanel } from "./TotalsPanel.js";

interface FormState extends Omit<QuoteForm, "items"> {
  items: ItemForm[];
}

let nextKey = 1;
const emptyItem = (): ItemForm => ({ key: nextKey++, description: "", quantity: "1", unitPrice: "", unitCost: "" });
const EMPTY_FORM: FormState = { name: "", notes: "", discount: "0", items: [] };

const dollars = (cents: number) => (cents / 100).toFixed(2);

function formFromQuote(q: QuoteView): FormState {
  return {
    name: q.name,
    notes: q.notes,
    discount: String(q.discountBps / 100),
    items: q.items.map((i) => ({
      key: nextKey++,
      description: i.description,
      quantity: String(i.quantity),
      unitPrice: dollars(i.unitPriceCents),
      unitCost: dollars(i.unitCostCents),
    })),
  };
}

/** The request body: exactly what the user typed; the server validates and converts it again. */
function toBody(form: FormState): QuoteForm {
  return { ...form, items: form.items.map(({ key: _key, ...item }) => item) };
}

const sameContent = (a: FormState, b: FormState) => JSON.stringify(toBody(a)) === JSON.stringify(toBody(b));

const fieldId = (path: string) => `quote-${path}`;

type Banner = { kind: "error" | "info"; text: string; retry?: boolean };

interface QuoteEditorProps {
  /** Quote to edit, or "new" to create one. */
  quoteId: number | "new";
  onCreated: (quote: QuoteView) => void;
  /** Saved data changed (save, decision or conflict reload): refresh the list. */
  onChanged: () => void;
}

export function QuoteEditor({ quoteId, onCreated, onChanged }: QuoteEditorProps) {
  const [quote, setQuote] = useState<QuoteView>();
  const [form, setForm] = useState<FormState>(() => (quoteId === "new" ? { ...EMPTY_FORM, items: [emptyItem()] } : EMPTY_FORM));
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>();
  const [notice, setNotice] = useState("");

  const applyQuote = useCallback((q: QuoteView) => {
    setQuote(q);
    setForm(formFromQuote(q));
    setServerErrors({});
    setShowErrors(false);
  }, []);

  const load = useCallback(async () => {
    if (quoteId === "new") return;
    setLoadError(false);
    const res = await api.getQuote(quoteId);
    if (res.ok) applyQuote(res.data);
    else setLoadError(true);
  }, [quoteId, applyQuote]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch for this quote
  }, [load]);

  function update(next: FormState) {
    setForm(next);
    setServerErrors({});
    setNotice("");
  }

  const updateItem = (index: number, patch: Partial<ItemForm>) =>
    update({ ...form, items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const body = toBody(form);
  const parsed = quoteInputSchema.safeParse(body);
  const errors = showErrors ? { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...serverErrors } : serverErrors;
  const dirty = quote ? !sameContent(form, formFromQuote(quote)) : true;

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setShowErrors(true);
    setBanner(undefined);
    setNotice("");
    if (!parsed.success) {
      const first = Object.keys(fieldErrors(parsed.error))[0];
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setSaving(true);
    const res = quote ? await api.updateQuote(quote.id, body, quote.version) : await api.createQuote(body);
    setSaving(false);

    if (res.ok) {
      if (!quote) return onCreated(res.data);
      applyQuote(res.data);
      setNotice("Quote saved.");
      onChanged();
    } else if (res.status === 409 && res.quote) {
      applyQuote(res.quote);
      setBanner({ kind: "info", text: "This quote changed since you opened it. The latest version has been loaded." });
      onChanged();
    } else if (res.status === 400) {
      setServerErrors(res.fieldErrors ?? {});
      setBanner({ kind: "error", text: "Could not save. Check the highlighted fields." });
    } else if (res.status === 404) {
      setBanner({ kind: "error", text: "This quote no longer exists. The demo data may have been restored." });
    } else {
      setBanner({ kind: "error", text: "Could not save. Your changes are still on screen.", retry: true });
    }
  }

  function onQuoteChanged(q: QuoteView) {
    applyQuote(q);
    onChanged();
  }

  if (quoteId !== "new" && !quote) {
    return loadError ? (
      <div className="banner banner-error" role="alert">
        Could not load the quote.{" "}
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading quote…</p>
    );
  }

  // Totals: the saved server view when nothing changed; otherwise a preview from the shared domain code.
  const terms = termsInputSchema.safeParse(body);
  const savedView = quote && !dirty ? quote : undefined;
  const preview = !savedView && terms.success ? assessQuote(terms.data, quote?.decisions ?? []) : undefined;

  return (
    <div className="editor">
      <form onSubmit={(e) => void save(e)} noValidate aria-labelledby="editor-heading">
        <h2 id="editor-heading">{quote ? `Edit quote: ${quote.name}` : "New quote"}</h2>
        <Field id={fieldId("name")} label="Quote name" value={form.name} error={errors.name} onChange={(name) => update({ ...form, name })} />
        <Field
          id={fieldId("notes")}
          label="Notes (not part of the commercial terms)"
          value={form.notes}
          error={errors.notes}
          multiline
          onChange={(notes) => update({ ...form, notes })}
        />

        <h3>Line items</h3>
        {form.items.length === 0 && <p>No line items. Add one to give the quote revenue.</p>}
        {form.items.map((item, index) => (
          <LineItemRow
            key={item.key}
            index={index}
            item={item}
            errors={errors}
            fieldId={fieldId}
            onChange={(patch) => updateItem(index, patch)}
            onRemove={() => update({ ...form, items: form.items.filter((_, i) => i !== index) })}
          />
        ))}
        <button type="button" onClick={() => update({ ...form, items: [...form.items, emptyItem()] })}>
          Add line item
        </button>

        <Field
          id={fieldId("discount")}
          label="Discount on total price (%)"
          inputMode="decimal"
          value={form.discount}
          error={errors.discount}
          onChange={(discount) => update({ ...form, discount })}
        />

        {banner && (
          <div className={`banner banner-${banner.kind}`} role="alert">
            {banner.text}{" "}
            {banner.retry && (
              <button type="button" onClick={() => void save()}>
                Retry
              </button>
            )}
          </div>
        )}
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : quote ? "Save changes" : "Create quote"}
          </button>
          {quote && dirty && (
            <button type="button" onClick={() => applyQuote(quote)}>
              Discard changes
            </button>
          )}
        </div>
        <p role="status" className="announcement">
          {notice}
        </p>
      </form>

      <div className="side">
        {savedView ? (
          <TotalsPanel
            totals={savedView.totals}
            rule={savedView.rule}
            status={savedView.status}
            staleMessage={savedView.staleMessage}
            preview={false}
          />
        ) : preview ? (
          <TotalsPanel
            totals={preview.totals}
            rule={preview.rule}
            status={preview.status}
            staleMessage={preview.status === "stale" && preview.decision ? describeStaleDecision(preview.decision) : undefined}
            preview
          />
        ) : (
          <section className="totals" aria-labelledby="totals-heading">
            <h2 id="totals-heading">Totals</h2>
            <p>Totals, margin and status appear when every line item and the discount are valid.</p>
          </section>
        )}
        {quote && <DecisionPanel quote={quote} dirty={dirty} onQuoteChanged={onQuoteChanged} />}
      </div>
    </div>
  );
}
