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

// Inline styles rather than the a2ui-table* classes: the component has no
// reachable stylesheet in every context it renders (this app's Tailwind
// build, a design-sync preview), so it owns its own minimal, professional
// look rather than depending on one being defined elsewhere.
const BORDER = '1px solid #e2e8f0';
const HEADER_BG = '#eef2ff';
const HEADER_TEXT = '#312e81';

export const Table = createComponentImplementation(TableApi, ({ props }) => {
  const { columns, rows } = props;
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign;
    });
  }, [rows, sort]);

  // Click cycles asc -> desc -> unsorted; a new column always starts at asc.
  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  return (
    <div
      className="a2ui-table"
      style={{
        border: BORDER,
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className="a2ui-table-th"
                  onClick={() => toggleSort(c.key)}
                  role="button"
                  tabIndex={0}
                  aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={{
                    background: HEADER_BG,
                    color: HEADER_TEXT,
                    fontWeight: 600,
                    textAlign: 'center',
                    padding: '10px 16px',
                    borderBottom: `2px solid #c7d2fe`,
                    borderRight: i < columns.length - 1 ? BORDER : undefined,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {c.label}
                  {active ? (sort!.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((c, colIndex) => (
                <td
                  key={c.key}
                  className="a2ui-table-td"
                  style={{
                    textAlign: 'center',
                    padding: '8px 16px',
                    borderBottom: rowIndex < sortedRows.length - 1 ? BORDER : undefined,
                    borderRight: colIndex < columns.length - 1 ? BORDER : undefined,
                  }}
                >
                  {String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
