import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FillSuggestion, FormField, WorkerRequest, WorkerResponse } from "../../src/shared/types";
import { canApproveValue, MIN_FILL_CONFIDENCE } from "../../src/shared/review";
import "./style.css";

interface ReviewItem {
  field: FormField;
  suggestion: FillSuggestion;
  value: string;
}

function SidePanel(): React.JSX.Element {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState("Monitoring active page for approved forms…");
  const [busy, setBusy] = useState(false);

  async function send(request: WorkerRequest): Promise<WorkerResponse> {
    return chrome.runtime.sendMessage(request) as Promise<WorkerResponse>;
  }

  function renderResults(fields: FormField[], suggestions: FillSuggestion[], autoFilled = true) {
    const reviewItems: ReviewItem[] = fields.map((field) => {
      const suggestion = suggestions.find((item) => item.field_id === field.id) ?? {
        field_id: field.id,
        proposed_value: "",
        confidence: 0,
        source: null,
        needs_review: true,
        reason: "No suggestion available."
      };
      return { field, suggestion, value: suggestion.proposed_value };
    });
    setItems(reviewItems);
    const filledCount = reviewItems.filter((i) => i.value && i.value.trim()).length;
    if (autoFilled) {
      setStatus(`Autonomous fill complete! ${filledCount} / ${fields.length} fields filled on the page. Review below before submitting.`);
    } else {
      setStatus(`Scanned ${fields.length} fields. Ready for review.`);
    }
  }

  // 1. On mount, load any existing autonomous RAG results cached in chrome.storage.session
  useEffect(() => {
    void chrome.storage.session.get("latestRAGResult").then((data) => {
      const res = data.latestRAGResult;
      if (res && res.fields && res.suggestions) {
        renderResults(res.fields, res.suggestions, true);
      }
    });

    // 2. Listen for runtime events when background script completes autonomous fill
    const listener = (message: any) => {
      if (message && message.type === "AUTONOMOUS_FILL_COMPLETE") {
        renderResults(message.fields, message.suggestions, true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function manualScan(): Promise<void> {
    setBusy(true);
    setStatus("Scanning form & querying Gemini RAG…");
    try {
      const response = await send({ type: "SCAN_ACTIVE_TAB" });
      if (!response.ok) throw new Error(response.error);

      const fields = response.fields ?? [];
      const suggestions = response.suggestions ?? [];
      renderResults(fields, suggestions, false);

      // Auto fill page
      const fillable = suggestions
        .filter((s) => s.proposed_value && s.proposed_value.trim().length > 0)
        .map((s) => ({ fieldId: s.field_id, value: s.proposed_value }));

      if (fillable.length > 0) {
        const fillResp = await send({ type: "FILL_ALL_FIELDS", items: fillable });
        if (fillResp.ok) {
          setStatus(`Auto-filled ${fillResp.filledCount ?? fillable.length} fields on page.`);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function refillField(item: ReviewItem): Promise<void> {
    if (!item.value.trim()) return;
    setBusy(true);
    try {
      const response = await send({ type: "FILL_FIELD", fieldId: item.field.id, value: item.value });
      if (!response.ok) throw new Error(response.error);
      setStatus(`Updated "${item.field.label}" on page.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to fill field.");
    } finally {
      setBusy(false);
    }
  }

  function updateValue(fieldId: string, value: string): void {
    setItems((current) => current.map((item) =>
      item.field.id === fieldId ? { ...item, value } : item
    ));
  }

  const filledCount = items.filter((i) => i.value && i.value.trim()).length;
  const avgConfidence = items.length > 0
    ? Math.round((items.reduce((acc, curr) => acc + curr.suggestion.confidence, 0) / items.length) * 100)
    : 0;

  return (
    <main>
      <header>
        <p className="eyebrow">RAG FORM ASSISTANT</p>
        <h1>Autonomous Auto-Fill</h1>
        <p className="intro">
          Automatically fills approved forms as soon as you visit them. Review all matched values & citations below before submitting.
        </p>
        <button
          className="primary scan-button"
          onClick={() => void manualScan()}
          disabled={busy}
        >
          {busy ? "Processing…" : "Re-scan & Auto-fill Page"}
        </button>
      </header>

      <p className="status" role="status">{status}</p>

      {items.length > 0 && (
        <section className="summary-card" aria-label="Auto-fill Summary">
          <div className="summary-stat">
            <span className="stat-value">{filledCount} / {items.length}</span>
            <span className="stat-label">Fields Filled</span>
          </div>
          <div className="summary-stat">
            <span className="stat-value">{avgConfidence}%</span>
            <span className="stat-label">Avg Confidence</span>
          </div>
        </section>
      )}

      <section aria-label="Field Inspection and Citations">
        {items.map((item) => {
          const lowConfidence = item.suggestion.confidence < MIN_FILL_CONFIDENCE;
          const isFilled = Boolean(item.value && item.value.trim());

          return (
            <article className={`suggestion ${isFilled ? "filled-field" : "unfilled-field"}`} key={item.field.id}>
              <div className="field-heading">
                <h2>
                  {item.field.label}
                  {item.field.required ? <span aria-label="required" style={{ color: "#dc2626" }}> *</span> : null}
                </h2>
                <span className={lowConfidence ? "confidence low" : "confidence"}>
                  {Math.round(item.suggestion.confidence * 100)}% match
                </span>
              </div>

              <div className="field-body">
                <label>
                  Filled Value
                  <input
                    value={item.value}
                    onChange={(event) => updateValue(item.field.id, event.target.value)}
                    placeholder="No value found"
                  />
                </label>

                <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                  <button
                    className="secondary small-btn"
                    onClick={() => void refillField(item)}
                    disabled={busy || !item.value.trim()}
                  >
                    Apply updated value to page
                  </button>
                </div>
              </div>

              {item.suggestion.source ? (
                <div className="source">
                  <strong>Source: {item.suggestion.source.title}</strong>
                  <p>{item.suggestion.source.excerpt}</p>
                </div>
              ) : (
                <p className="warning">Not cited in dossier. Enter manually if needed.</p>
              )}

              {item.suggestion.reason ? <p className="reason">Reasoning: {item.suggestion.reason}</p> : null}
            </article>
          );
        })}
      </section>

      <footer>
        <a href="../options.html" target="_blank">Open extension options</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
