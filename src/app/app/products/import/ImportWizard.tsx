"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Outcome =
  | "CREATED"
  | "ALREADY_PRESENT"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "NOT_SELECTED"
  | "FAILED";

interface RowIssue {
  column: string | null;
  message: string;
}

interface PreviewRow {
  rowNumber: number;
  outcome: Outcome;
  productName: string | null;
  internalSku: string | null;
  matchedProductId: string | null;
  matchExplanation: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

interface Preview {
  contentDigest: string;
  fileName: string | null;
  totalRows: number;
  counts: Record<Outcome, number>;
  rows: PreviewRow[];
  unmappedHeaders: string[];
  fileErrors: RowIssue[];
}

interface CommitResult {
  contentDigest: string;
  counts: Record<Outcome, number>;
  rows: PreviewRow[];
  createdProductIds: string[];
}

/** What each outcome means, in the words a person reading the preview needs. */
const OUTCOME_COPY: Record<Outcome, { label: string; className: string; hint: string }> = {
  CREATED: {
    label: "Will create",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
    hint: "Nothing in the catalogue matched, so this row becomes a new product.",
  },
  ALREADY_PRESENT: {
    label: "Already here",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    hint: "An identifier on this row already resolves to a product. It is skipped, so re-uploading the same file creates nothing.",
  },
  NEEDS_REVIEW: {
    label: "Needs a person",
    className: "bg-amber-50 text-amber-900 border-amber-200",
    hint: "The match was close but not certain. Qubere will not guess which product this is, so the row is skipped until you say.",
  },
  INVALID: {
    label: "Cannot be read",
    className: "bg-red-50 text-red-800 border-red-200",
    hint: "The row failed validation. It is skipped and the rest of the file still imports.",
  },
  NOT_SELECTED: {
    label: "Not selected",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    hint: "You unticked this row.",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-50 text-red-800 border-red-200",
    hint: "The write was rejected — usually a value another user claimed between the preview and the commit.",
  },
};

const OUTCOME_ORDER: Outcome[] = [
  "CREATED",
  "NEEDS_REVIEW",
  "ALREADY_PRESENT",
  "INVALID",
  "NOT_SELECTED",
  "FAILED",
];

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const copy = OUTCOME_COPY[outcome];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${copy.className}`}>
      {copy.label}
    </span>
  );
}

export function ImportWizard() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;

    setBusy(true);
    setError(null);
    setPreview(null);
    setResult(null);
    setExcluded(new Set());

    try {
      const text = await file.text();
      setContent(text);
      setFileName(file.name);

      const response = await fetch("/api/products/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, fileName: file.name }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "The file could not be read.");
        return;
      }
      setPreview(body.preview as Preview);
    } catch {
      setError("The file could not be read from this browser. Nothing was uploaded.");
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (preview === null || content === null) return;
    setBusy(true);
    setError(null);

    // Only rows the preview says would create anything are worth sending, and of
    // those only the ones still ticked. Everything else the server would skip.
    const accepted = preview.rows
      .filter((row) => row.outcome === "CREATED" && !excluded.has(row.rowNumber))
      .map((row) => row.rowNumber);

    try {
      const response = await fetch("/api/products/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          fileName,
          contentDigest: preview.contentDigest,
          acceptedRows: accepted,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "The import did not run.");
        return;
      }
      setResult(body.result as CommitResult);
      router.refresh();
    } catch {
      setError("The request did not reach the server. Nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(rowNumber: number) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  const creatable =
    preview === null
      ? 0
      : preview.rows.filter((row) => row.outcome === "CREATED" && !excluded.has(row.rowNumber))
          .length;

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">1. Choose a file</h2>
            <p className="text-xs text-[#6E6E73] mt-1 max-w-2xl">
              A CSV with one product per row. Column names are matched case- and
              punctuation-insensitively; anything Qubere does not recognise is listed back to you
              rather than silently dropped.
            </p>
          </div>
          {/*
            A plain anchor, not next/link: this is a file download served by an
            API route, and client-side navigation to it would be handed a CSV
            body it cannot render.
          */}
          <a
            href="/api/products/import/template"
            download
            className="inline-flex items-center h-10 px-4 rounded-xl border border-border text-sm font-semibold text-ink hover:bg-surface-muted"
          >
            Download template
          </a>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-sm file:mr-4 file:h-10 file:px-4 file:rounded-xl file:border-0 file:bg-brand file:text-white file:text-sm file:font-semibold"
        />
        {fileName !== null && (
          <p className="text-xs text-[#6E6E73]">
            {fileName}
            {preview !== null && ` — ${preview.totalRows} rows read`}
          </p>
        )}
      </section>

      {preview !== null && preview.fileErrors.length > 0 && (
        <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 p-5">
          <h2 className="text-sm font-bold text-red-900">This file cannot be imported</h2>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-red-900">
            {preview.fileErrors.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview !== null && preview.fileErrors.length === 0 && result === null && (
        <>
          <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
            <h2 className="text-sm font-bold text-ink">2. Check what would happen</h2>
            <div className="flex flex-wrap gap-2">
              {OUTCOME_ORDER.filter((outcome) => preview.counts[outcome] > 0).map((outcome) => (
                <span
                  key={outcome}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${OUTCOME_COPY[outcome].className}`}
                >
                  {preview.counts[outcome]} {OUTCOME_COPY[outcome].label.toLowerCase()}
                </span>
              ))}
            </div>
            <ul className="space-y-1 text-xs text-[#6E6E73]">
              {OUTCOME_ORDER.filter((outcome) => preview.counts[outcome] > 0).map((outcome) => (
                <li key={outcome}>
                  <span className="font-semibold text-ink">{OUTCOME_COPY[outcome].label}</span>:{" "}
                  {OUTCOME_COPY[outcome].hint}
                </li>
              ))}
            </ul>

            {preview.unmappedHeaders.length > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                These columns were not recognised and will be ignored:{" "}
                {preview.unmappedHeaders.join(", ")}. Attribute columns need an{" "}
                <code>attribute:</code> prefix to be read as attributes.
              </p>
            )}
          </section>

          <div className="rounded-2xl bg-white border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wider text-ink-muted bg-surface-muted">
                  <tr>
                    <th className="px-3 py-3">Import</th>
                    <th className="px-3 py-3">Row</th>
                    <th className="px-3 py-3">Product</th>
                    <th className="px-3 py-3">SKU</th>
                    <th className="px-3 py-3">Outcome</th>
                    <th className="px-3 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-3 py-3">
                        {row.outcome === "CREATED" ? (
                          <input
                            type="checkbox"
                            checked={!excluded.has(row.rowNumber)}
                            onChange={() => toggleRow(row.rowNumber)}
                            aria-label={`Import row ${row.rowNumber}`}
                          />
                        ) : (
                          <span className="text-xs text-[#6E6E73]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[#6E6E73]">{row.rowNumber}</td>
                      <td className="px-3 py-3 text-ink">{row.productName ?? "—"}</td>
                      <td className="px-3 py-3 text-[#6E6E73]">{row.internalSku ?? "—"}</td>
                      <td className="px-3 py-3">
                        <OutcomeBadge outcome={row.outcome} />
                      </td>
                      <td className="px-3 py-3 text-xs text-[#6E6E73] max-w-md">
                        {row.matchExplanation !== null && <p>{row.matchExplanation}</p>}
                        {row.matchedProductId !== null && (
                          <Link
                            href={`/app/products/${row.matchedProductId}`}
                            className="font-semibold text-brand"
                          >
                            Open the matched product
                          </Link>
                        )}
                        {row.errors.map((issue, index) => (
                          <p key={`e${index}`} className="text-red-700">
                            {issue.column !== null ? `${issue.column}: ` : ""}
                            {issue.message}
                          </p>
                        ))}
                        {row.warnings.map((issue, index) => (
                          <p key={`w${index}`} className="text-amber-800">
                            {issue.column !== null ? `${issue.column}: ` : ""}
                            {issue.message}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <section className="rounded-2xl bg-white border border-border p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink">3. Import</h2>
            <p className="text-xs text-[#6E6E73] max-w-2xl">
              Classification codes in the file are recorded as candidates, not approved positions —
              importing a spreadsheet does not approve anything for any jurisdiction. Each row is
              written on its own, so one row failing leaves the rest imported.
            </p>
            <button
              type="button"
              onClick={onCommit}
              disabled={busy || creatable === 0}
              className="h-10 px-5 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy
                ? "Importing…"
                : creatable === 0
                  ? "Nothing selected to import"
                  : `Import ${creatable} ${creatable === 1 ? "product" : "products"}`}
            </button>
          </section>
        </>
      )}

      {result !== null && (
        <section className="rounded-2xl bg-white border border-border p-5 space-y-4">
          <h2 className="text-sm font-bold text-ink">Import finished</h2>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_ORDER.filter((outcome) => result.counts[outcome] > 0).map((outcome) => (
              <span
                key={outcome}
                className={`inline-flex px-3 py-1.5 rounded-full border text-xs font-semibold ${OUTCOME_COPY[outcome].className}`}
              >
                {result.counts[outcome]} {OUTCOME_COPY[outcome].label.toLowerCase()}
              </span>
            ))}
          </div>
          {result.rows.some((row) => row.outcome === "FAILED") && (
            <div className="text-sm text-red-900">
              <p className="font-semibold">These rows were rejected on write:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.rows
                  .filter((row) => row.outcome === "FAILED")
                  .map((row) => (
                    <li key={row.rowNumber}>
                      Row {row.rowNumber}: {row.errors[0]?.message ?? "Rejected."}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <Link
            href="/app/products"
            className="inline-flex items-center h-10 px-5 rounded-xl bg-brand text-white text-sm font-semibold"
          >
            Back to products
          </Link>
        </section>
      )}
    </div>
  );
}
