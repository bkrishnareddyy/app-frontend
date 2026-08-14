"use client";

import { useMemo, useState } from "react";
import { Settings2, Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { PAGE_SIZE_DEFAULT, pageWindow } from "@/modules/tables/tableQuery";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Static, developer-authored UI text (table/field labels, column headers,
 * generic chrome) is translated through the existing i18n dictionary.
 * Deliberately out of scope: canonical-schema field labels, and any label an
 * admin types into the "Required Fields" accordion -- those are runtime
 * content, not something a static compile-time dictionary can cover; see
 * FilingDetailClient.tsx's ActionFieldPrompts, which renders admin-entered
 * labels as-is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dict = any;

function toCamelKey(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function tableDict(dict: Dict, tableKey: string): Dict {
  return dict?.filingConfig?.tables?.[toCamelKey(tableKey)];
}

function fieldLabel(dict: Dict, tableKey: string, field: FieldMeta): string {
  return tableDict(dict, tableKey)?.fields?.[field.key]?.label ?? field.label;
}

function fieldHelp(dict: Dict, tableKey: string, field: FieldMeta): string | undefined {
  return tableDict(dict, tableKey)?.fields?.[field.key]?.help ?? field.help;
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template);
}

export interface SubFieldMeta {
  key: string;
  label: string;
  type: "text" | "boolean" | "select" | "fieldArray";
  options?: string[];
  help?: string;
  /**
   * Only present when type === "fieldArray": the shape of each nested entry.
   * When omitted (the usual case for a self-referencing tree, since a truly
   * circular structure can't cross the server/client boundary), the editor
   * falls back to reusing its own current itemFields -- this is what lets a
   * GoodsItem -> Packages -> ... tree render at any depth from one fixed
   * shape sent once from the server.
   */
  itemFields?: SubFieldMeta[];
}

export interface FieldMeta {
  key: string;
  label: string;
  type: "text" | "boolean" | "fieldArray";
  help?: string;
  /** Only present when type === "fieldArray": the shape of each entry in the array. */
  itemFields?: SubFieldMeta[];
}

export interface TableMeta {
  key: string;
  label: string;
  description: string;
  idField: string;
  fields: FieldMeta[];
}

type Row = Record<string, unknown>;
type ArrayEntry = Record<string, unknown>;

function errorFromResponse(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error?: { message?: string } }).error;
    if (err && typeof err.message === "string") return err.message;
  }
  return fallback;
}

function emptyDraft(fields: FieldMeta[]): Row {
  const draft: Row = {};
  for (const f of fields) draft[f.key] = f.type === "boolean" ? false : f.type === "fieldArray" ? [] : "";
  return draft;
}

function emptyArrayEntry(itemFields: SubFieldMeta[]): ArrayEntry {
  const entry: ArrayEntry = {};
  for (const f of itemFields) {
    entry[f.key] = f.type === "boolean" ? false : f.type === "fieldArray" ? [] : f.options?.[0] ?? "";
  }
  return entry;
}

export function FilingConfigClient({ tables }: { tables: TableMeta[] }) {
  const { t } = useLanguage();
  const [activeKey, setActiveKey] = useState(tables[0]?.key);
  const active = tables.find((table) => table.key === activeKey) ?? tables[0];

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div className="flex items-center space-x-2">
          <Settings2 className="w-5 h-5 text-brand" />
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">{t.filingConfig?.title ?? "Filing Configuration"}</h1>
        </div>
        <p className="text-xs text-ink-muted mt-1">
          {t.filingConfig?.subtitle ??
            "Global reference data every tenant's customs filing workflow resolves against. Changes here take effect immediately, for every account."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tables.map((table) => (
          <button
            key={table.key}
            type="button"
            onClick={() => setActiveKey(table.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              table.key === active?.key ? "bg-brand text-white" : "bg-white border border-border text-ink-muted hover:bg-surface-muted"
            }`}
          >
            {tableDict(t, table.key)?.label ?? table.label}
          </button>
        ))}
      </div>

      {active && <TablePanel key={active.key} table={active} />}
    </div>
  );
}

function TablePanel({ table }: { table: TableMeta }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/filing-config/${table.key}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Failed to load rows."));
      setRows(data.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useMemo(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.key]);

  const filtered = (rows ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return table.fields.some((f) => String(r[f.key] ?? "").toLowerCase().includes(q));
  });

  const window_ = pageWindow(filtered.length, PAGE_SIZE_DEFAULT, page);
  const pageRows = filtered.slice(window_.start, window_.end);

  async function handleDelete(row: Row) {
    setError(null);
    try {
      const id = row[table.idField];
      const res = await fetch(`/api/filing-config/${table.key}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Delete failed."));
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-sm font-bold text-ink">{tableDict(t, table.key)?.label ?? table.label}</p>
          <p className="text-xs text-ink-muted mt-0.5 max-w-xl">{tableDict(t, table.key)?.description ?? table.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t.filingConfig?.searchPlaceholder ?? "Search..."}
              className="pl-9 w-52"
            />
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t.filingConfig?.addRow ?? "Add Row"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-ink-muted bg-surface-muted">
              {table.fields.map((f) => (
                <th key={f.key} className="py-2.5 px-3 font-bold">{fieldLabel(t, table.key, f)}</th>
              ))}
              <th className="py-2.5 px-3 font-bold text-right">{t.filingConfig?.actionsColumn ?? "Actions"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={table.fields.length + 1} className="py-8 text-center text-ink-muted">{t.filingConfig?.loading ?? "Loading..."}</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={table.fields.length + 1} className="py-8 text-center text-ink-muted">{t.filingConfig?.noRows ?? "No rows."}</td></tr>
            ) : (
              pageRows.map((row) => (
                <tr key={String(row[table.idField])} className="hover:bg-surface-muted">
                  {table.fields.map((f) => (
                    <td key={f.key} className="py-2.5 px-3 text-ink">
                      {f.type === "boolean"
                        ? (row[f.key] ? t.filingConfig?.yes ?? "Yes" : t.filingConfig?.no ?? "No")
                        : f.type === "fieldArray"
                          ? interpolate(t.filingConfig?.fieldsConfiguredCount ?? "{count} field(s) configured", {
                              count: Array.isArray(row[f.key]) ? (row[f.key] as unknown[]).length : 0,
                            })
                          : String(row[f.key] ?? "")}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        aria-label={t.filingConfig?.editRow ?? "Edit row"}
                        className="p-1.5 rounded-lg border border-border bg-white hover:bg-surface-muted text-ink"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(row)}
                        aria-label={t.filingConfig?.deleteRow ?? "Delete row"}
                        className="p-1.5 rounded-lg border border-border bg-white hover:bg-red-50 text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-ink-muted">
          <span>
            {interpolate(t.filingConfig?.showingRows ?? "Showing {first}-{last} of {total}", {
              first: window_.firstRow,
              last: window_.lastRow,
              total: filtered.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={window_.page <= 1}
              aria-label="Previous page"
              className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-surface-muted"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>{interpolate(t.filingConfig?.pageOf ?? "Page {page} of {pages}", { page: window_.page, pages: window_.pages })}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(window_.pages, p + 1))}
              disabled={window_.page >= window_.pages}
              aria-label="Next page"
              className="p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-surface-muted"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <RowFormModal
          table={table}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      {confirmDelete && (
        <Modal isOpen onClose={() => setConfirmDelete(null)} titleId="delete-row-title">
          <ModalHeader
            titleId="delete-row-title"
            title={t.filingConfig?.deleteConfirmTitle ?? "Delete this row?"}
            onClose={() => setConfirmDelete(null)}
          />
          <ModalBody>
            <p className="text-sm text-ink-muted">
              {t.filingConfig?.deleteConfirmBody ?? "This immediately affects filing resolution for every tenant. This cannot be undone."}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              {t.filingConfig?.cancel ?? "Cancel"}
            </Button>
            <Button variant="danger" onClick={() => handleDelete(confirmDelete)}>
              {t.filingConfig?.delete ?? "Delete"}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Card>
  );
}

function RowFormModal({
  table,
  initial,
  onClose,
  onSaved,
}: {
  table: TableMeta;
  initial: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const isEdit = initial !== null;
  const [draft, setDraft] = useState<Row>(() => (initial ? { ...initial } : emptyDraft(table.fields)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const payload: Row = {};
      for (const f of table.fields) {
        if (isEdit && f.key === table.idField) continue; // PK never editable
        if (f.type === "boolean") payload[f.key] = Boolean(draft[f.key]);
        else if (f.type === "fieldArray") payload[f.key] = draft[f.key] ?? [];
        else payload[f.key] = String(draft[f.key] ?? "").trim();
      }
      const url = isEdit
        ? `/api/filing-config/${table.key}/${encodeURIComponent(String((initial as Row)[table.idField]))}`
        : `/api/filing-config/${table.key}`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorFromResponse(data, "Save failed."));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const translatedTableLabel = tableDict(t, table.key)?.label ?? table.label;
  const modalTitle = `${isEdit ? t.filingConfig?.editTitlePrefix ?? "Edit" : t.filingConfig?.addTitlePrefix ?? "Add"} ${translatedTableLabel}`;

  return (
    <Modal isOpen onClose={onClose} titleId="row-form-title">
      <ModalHeader titleId="row-form-title" title={modalTitle} onClose={onClose} />
      <ModalBody className="space-y-3">
        {table.fields.map((f) => {
          const disabled = isEdit && f.key === table.idField;
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-xs font-bold text-ink-muted">{fieldLabel(t, table.key, f)}</label>
              {f.type === "boolean" ? (
                <select
                  value={draft[f.key] ? "true" : "false"}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value === "true" }))}
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <option value="false">{t.filingConfig?.no ?? "No"}</option>
                  <option value="true">{t.filingConfig?.yes ?? "Yes"}</option>
                </select>
              ) : f.type === "fieldArray" ? (
                <FieldArrayEditor
                  itemFields={f.itemFields ?? []}
                  entries={(draft[f.key] as ArrayEntry[] | undefined) ?? []}
                  onChange={(entries) => setDraft((d) => ({ ...d, [f.key]: entries }))}
                  dict={t}
                  dictPath={tableDict(t, table.key)?.fields?.[f.key]?.itemFields}
                />
              ) : (
                <Input
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  disabled={disabled}
                  className={disabled ? "opacity-60" : undefined}
                />
              )}
              {fieldHelp(t, table.key, f) && <p className="text-[11px] text-ink-muted">{fieldHelp(t, table.key, f)}</p>}
            </div>
          );
        })}
        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t.filingConfig?.cancel ?? "Cancel"}
        </Button>
        <Button onClick={handleSubmit} loading={busy}>
          {isEdit ? t.filingConfig?.saveChanges ?? "Save Changes" : t.filingConfig?.createRow ?? "Create Row"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Convention: the first itemField is the entry's identifying label; any "select" fields become inline badges. */
function entrySummary(entry: ArrayEntry, itemFields: SubFieldMeta[]): string {
  const titleField = itemFields[0];
  const title = titleField ? String(entry[titleField.key] ?? "(untitled)") || "(untitled)" : "(untitled)";
  const badges = itemFields.filter((f) => f.type === "select" && entry[f.key]).map((f) => String(entry[f.key]));
  return badges.length > 0 ? `${title} — ${badges.join(", ")}` : title;
}

/**
 * One-level expandable list ("tree") for editing a fieldArray column -- a
 * repeating group of flat entries, each with its own small form. Generic over
 * whatever itemFields the table declares; nothing here is specific to
 * FilingActionDataRequirement.
 */
function FieldArrayEditor({
  itemFields,
  entries,
  onChange,
  dict,
  dictPath,
}: {
  itemFields: SubFieldMeta[];
  entries: ArrayEntry[];
  onChange: (entries: ArrayEntry[]) => void;
  dict: Dict;
  dictPath?: Dict;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function updateEntry(i: number, patch: ArrayEntry) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  function removeEntry(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }

  function addEntry() {
    const next = [...entries, emptyArrayEntry(itemFields)];
    onChange(next);
    setExpanded((s) => new Set(s).add(next.length - 1));
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-2 bg-surface-muted/40">
      {entries.length === 0 && (
        <p className="text-xs text-ink-muted px-2 py-1">{dict.filingConfig?.noFieldsYet ?? "No fields yet."}</p>
      )}
      {entries.map((entry, i) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} className="rounded-lg border border-border bg-white">
            <div className="flex items-center justify-between px-2.5 py-2">
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex items-center gap-1.5 text-xs font-semibold text-ink flex-1 text-left min-w-0"
              >
                {isOpen ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{entrySummary(entry, itemFields)}</span>
              </button>
              <button
                type="button"
                onClick={() => removeEntry(i)}
                aria-label={dict.filingConfig?.removeField ?? "Remove field"}
                className="p-1 rounded hover:bg-red-50 text-red-600 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {isOpen && (
              <div className="px-2.5 pb-2.5 space-y-2 border-t border-border pt-2">
                {itemFields.map((sf) => {
                  const sfLabel = dictPath?.[sf.key]?.label ?? sf.label;
                  const sfHelp = dictPath?.[sf.key]?.help ?? sf.help;
                  return (
                  <div key={sf.key} className="space-y-1">
                    <label className="text-[11px] font-bold text-ink-muted">{sfLabel}</label>
                    {sf.type === "boolean" ? (
                      <select
                        value={entry[sf.key] ? "true" : "false"}
                        onChange={(e) => updateEntry(i, { [sf.key]: e.target.value === "true" })}
                        className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs"
                      >
                        <option value="false">{dict.filingConfig?.no ?? "No"}</option>
                        <option value="true">{dict.filingConfig?.yes ?? "Yes"}</option>
                      </select>
                    ) : sf.type === "select" ? (
                      <select
                        value={String(entry[sf.key] ?? sf.options?.[0] ?? "")}
                        onChange={(e) => updateEntry(i, { [sf.key]: e.target.value })}
                        className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs"
                      >
                        {(sf.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : sf.type === "fieldArray" ? (
                      // Recursive: a "grid" field's own columns are themselves
                      // described by this same editor, arbitrarily deep --
                      // itemFields falls back to the enclosing level's shape
                      // when the server omitted an explicit nested one.
                      <FieldArrayEditor
                        itemFields={sf.itemFields ?? itemFields}
                        entries={(entry[sf.key] as ArrayEntry[] | undefined) ?? []}
                        onChange={(nested) => updateEntry(i, { [sf.key]: nested })}
                        dict={dict}
                        dictPath={dictPath?.[sf.key]?.itemFields ?? dictPath}
                      />
                    ) : (
                      <Input
                        value={String(entry[sf.key] ?? "")}
                        onChange={(e) => updateEntry(i, { [sf.key]: e.target.value })}
                        className="text-xs"
                      />
                    )}
                    {sfHelp && <p className="text-[10px] text-ink-muted">{sfHelp}</p>}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" onClick={addEntry} className="w-full justify-center">
        <Plus className="w-3.5 h-3.5" />
        {dict.filingConfig?.addField ?? "Add Field"}
      </Button>
    </div>
  );
}
