'use client';

import { useMemo, useState } from 'react';
import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';

export const TableApi = {
  name: 'Table',
  schema: z.object({
    columns: z
      .array(z.object({ key: z.string(), label: z.string() }))
      .describe('Column definitions, in display order.'),
    rows: z
      .array(z.record(z.any()))
      .describe("Row data. Each row is an object keyed by column 'key'."),
  }),
} satisfies ComponentApi;

type SortState = { key: string; direction: 'asc' | 'desc' };

// Inline styles rather than classes: the component has no reachable
// stylesheet in every context it renders (this app's Tailwind build, a
// design-sync preview), so it owns its look outright.
const MONO = 'var(--font-geist-mono), ui-monospace, Menlo, monospace';
const LINE = '1px solid #e4e4e7';
const ROW_LINE = '1px solid #f4f4f5';

// "$1,209.93", "-12", "40%" -> number; anything else -> null.
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$€£,%\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

// A column is numeric when every non-empty value parses as a number. Numeric
// columns sort by value and right-align in tabular mono figures.
function numericColumns(columns: { key: string }[], rows: Record<string, unknown>[]) {
  const numeric = new Set<string>();
  for (const c of columns) {
    const values = rows.map((r) => r[c.key]).filter((v) => v != null && v !== '');
    if (values.length > 0 && values.every((v) => toNumber(v) !== null)) numeric.add(c.key);
  }
  return numeric;
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'asc' ? <path d="M12 19V5M6 11l6-6 6 6" /> : <path d="M12 5v14M6 13l6 6 6-6" />}
    </svg>
  );
}

export const Table = createComponentImplementation(TableApi, ({ props }) => {
  const { columns, rows } = props;
  const [sort, setSort] = useState<SortState | null>(null);
  const numeric = useMemo(() => numericColumns(columns, rows), [columns, rows]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    const isNumeric = numeric.has(sort.key);
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      if (isNumeric) return ((toNumber(av) ?? 0) - (toNumber(bv) ?? 0)) * sign;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign;
    });
  }, [rows, sort, numeric]);

  // Click cycles asc -> desc -> unsorted; a new column always starts at asc.
  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  // Outer columns get a wider gutter so text lines up with the card's edges.
  const cellPad = (i: number, vertical: number) =>
    `${vertical}px ${i === columns.length - 1 ? 20 : 12}px ${vertical}px ${i === 0 ? 20 : 12}px`;

  return (
    <div
      className="a2ui-table"
      style={{ border: LINE, borderRadius: 12, overflow: 'hidden', background: '#ffffff' }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: '#18181b' }}>
          <thead>
            <tr style={{ background: '#fafaf9' }}>
              {columns.map((c, i) => {
                const active = sort?.key === c.key;
                const alignRight = numeric.has(c.key);
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ padding: 0, borderBottom: LINE, textAlign: alignRight ? 'right' : 'left' }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      style={{
                        width: '100%',
                        minHeight: 44,
                        padding: cellPad(i, 0),
                        border: 0,
                        background: 'transparent',
                        font: 'inherit',
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        color: active ? '#18181b' : '#52525b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: alignRight ? 'flex-end' : 'flex-start',
                        gap: 4,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.label}
                      {active && <SortIcon direction={sort!.direction} />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((c, colIndex) => {
                  const isNumeric = numeric.has(c.key);
                  return (
                    <td
                      key={c.key}
                      style={{
                        padding: cellPad(colIndex, 11),
                        borderBottom: rowIndex < sortedRows.length - 1 ? ROW_LINE : undefined,
                        textAlign: isNumeric ? 'right' : 'left',
                        fontFamily: isNumeric ? MONO : undefined,
                        fontVariantNumeric: isNumeric ? 'tabular-nums' : undefined,
                        color: colIndex === 0 || isNumeric ? '#18181b' : '#3f3f46',
                      }}
                    >
                      {String(row[c.key] ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
