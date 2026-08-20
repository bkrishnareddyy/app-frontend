"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X, ChevronDown } from "lucide-react";

export interface CountryOption {
  code: string;
  label: string;
}

interface CountryComboboxProps {
  countries: CountryOption[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  id?: string;
}

export function CountryCombobox({ countries, value, onChange, placeholder = "Search country...", allowClear = false, id }: CountryComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = countries.find((c) => c.code === value) ?? null;
  const disabled = countries.length === 0;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries.slice(0, 50);
    return countries.filter((c) => c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)).slice(0, 50);
  }, [countries, query]);

  const commit = (c: CountryOption) => {
    onChange(c.code);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <SearchIcon className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          id={id}
          value={open ? query : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[highlight]) commit(filtered[highlight]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder={disabled ? "No countries loaded" : placeholder}
          disabled={disabled}
          autoComplete="off"
          className="w-full rounded-lg border border-border pl-8 pr-8 py-2 text-sm disabled:bg-slate-50 disabled:text-ink-muted disabled:cursor-not-allowed"
        />
        {selected && !open && allowClear ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            aria-label="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-ink-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-white shadow-lg py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">No matching country</p>
          ) : (
            filtered.map((c, idx) => (
              <button
                key={c.code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(c)}
                className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer ${
                  idx === highlight ? "bg-brand/10 text-brand" : "text-ink hover:bg-slate-50"
                } ${c.code === value ? "font-semibold" : ""}`}
              >
                <span>{c.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
