import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { QuoteEditor } from "./QuoteEditor.js";
import { QuoteList } from "./QuoteList.js";

export function App() {
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const refreshList = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <header className="app-header">
        <h1>Quote Margin &amp; Approval</h1>
        <p>Prototype. One shared demo database for every reviewer.</p>
      </header>
      <div className="layout">
        <div>
          <QuoteList
            selectedId={selected}
            refreshKey={refreshKey}
            onSelect={(id) => {
              setAnnouncement("");
              setSelected(id);
            }}
            onNew={() => {
              setAnnouncement("");
              setSelected("new");
            }}
          />
          <DemoReset
            onRestored={() => {
              setSelected(null);
              refreshList();
              setAnnouncement("Demo data restored.");
            }}
          />
        </div>
        <main>
          {selected === null ? (
            <p>Select a quote or create a new one.</p>
          ) : (
            <QuoteEditor
              key={selected}
              quoteId={selected}
              onCreated={(quote) => {
                setSelected(quote.id);
                refreshList();
                setAnnouncement("Quote created.");
              }}
              onChanged={refreshList}
            />
          )}
        </main>
      </div>
      <p role="status" className="announcement">
        {announcement}
      </p>
    </>
  );
}

/** Demo-only action behind an in-page confirmation. */
function DemoReset({ onRestored }: { onRestored: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    // Return focus to the button that opened the confirmation.
    setTimeout(() => openRef.current?.focus());
  }

  async function restore() {
    setBusy(true);
    setError(undefined);
    const res = await api.resetDemo();
    setBusy(false);
    if (!res.ok) {
      setError("Could not restore demo data. Try again.");
      return;
    }
    setConfirming(false);
    onRestored();
  }

  return (
    <section className="demo-reset" aria-labelledby="demo-heading">
      <h2 id="demo-heading">Demo only</h2>
      {!confirming ? (
        <button ref={openRef} type="button" onClick={() => setConfirming(true)}>
          Restore demo data
        </button>
      ) : (
        <div
          role="group"
          aria-labelledby="demo-confirm-text"
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        >
          <p id="demo-confirm-text">
            Replace all quotes and decisions with the three seeded cases? This affects everyone using this demo.
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void restore()}>
              {busy ? "Restoring…" : "Yes, restore demo data"}
            </button>
            <button ref={cancelRef} type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
