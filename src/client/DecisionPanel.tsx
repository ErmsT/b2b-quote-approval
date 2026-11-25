import { useState } from "react";
import { formatBps, formatUsd } from "../domain/money.js";
import { decisionInputSchema, fieldErrors } from "../domain/schema.js";
import { api, type QuoteView } from "./api.js";
import { Field } from "./Field.js";
import { formatMargin } from "./TotalsPanel.js";

interface DecisionPanelProps {
  quote: QuoteView;
  /** Unsaved edits on screen: the manager may decide only on saved terms. */
  dirty: boolean;
  /** Called with the latest quote after a decision or a 409 conflict. */
  onQuoteChanged: (quote: QuoteView) => void;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function DecisionPanel({ quote, dirty, onQuoteChanged }: DecisionPanelProps) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // The confirmation belongs to the terms it was recorded for; it is not shown once those terms change.
  const [announcement, setAnnouncement] = useState<{ text: string; termsFingerprint: string }>();

  async function submit(decision: "approved" | "rejected") {
    setError(undefined);
    setAnnouncement(undefined);
    const parsed = decisionInputSchema.safeParse({ decision, reason, termsFingerprint: quote.termsFingerprint });
    if (!parsed.success) {
      setReasonError(fieldErrors(parsed.error).reason);
      document.getElementById("decision-reason")?.focus();
      return;
    }
    setReasonError(undefined);
    setSubmitting(true);
    const res = await api.decide(quote.id, parsed.data);
    setSubmitting(false);
    if (res.ok) {
      setReason("");
      setAnnouncement({
        text: decision === "approved" ? "Approval recorded for the current terms." : "Rejection recorded for the current terms.",
        termsFingerprint: res.data.termsFingerprint,
      });
      onQuoteChanged(res.data);
    } else if (res.status === 409 && res.quote) {
      setError(`${res.error} The latest version has been loaded.`);
      onQuoteChanged(res.quote);
    } else if (res.status === 400) {
      setReasonError(res.fieldErrors?.reason);
      setError(res.error);
    } else {
      setError("Could not record the decision. Your reason is still on screen. Try again.");
    }
  }

  const history = [...quote.decisions].reverse();
  const currentId = quote.status === "approved" || quote.status === "rejected" ? quote.statusDecision?.id : undefined;

  return (
    <section className="decision" aria-labelledby="decision-heading">
      <h2 id="decision-heading">Simulation: manager decision (no login, no email)</h2>
      {!quote.rule.requiresReview ? (
        <p>No manager decision needed: the saved terms satisfy the approval rule.</p>
      ) : dirty ? (
        <p>Save or discard your changes first. The manager decides on the saved terms.</p>
      ) : (
        <div className="decision-form">
          <Field
            id="decision-reason"
            label="Reason for the decision (required)"
            value={reason}
            onChange={setReason}
            error={reasonError}
            multiline
          />
          <div className="actions">
            <button type="button" disabled={submitting} onClick={() => void submit("approved")}>
              Approve these terms
            </button>
            <button type="button" disabled={submitting} onClick={() => void submit("rejected")}>
              Reject these terms
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="announcement">
        {announcement?.termsFingerprint === quote.termsFingerprint ? announcement.text : ""}
      </p>

      {history.length > 0 && (
        <>
          <h3>Decision history</h3>
          <ol className="history">
            {history.map((d) => (
              <li key={d.id}>
                <strong>{d.decision === "approved" ? "Approved" : "Rejected"}</strong> on {formatDateTime(d.decidedAt)}
                {d.id === currentId ? " (applies to the current terms)" : " (earlier terms)"}
                <br />
                Reason: {d.reason}
                <br />
                Reviewed: net {formatUsd(d.snapshot.netRevenueCents)}, margin {formatMargin(d.snapshot.margin)}, discount{" "}
                {formatBps(d.snapshot.discountBps)}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
