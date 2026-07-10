'use client';

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

export const Table = createComponentImplementation(TableApi, ({ props }) => (
  <table className="a2ui-table">
    <thead>
      <tr>
        {props.columns.map((c) => (
          <th key={c.key} className="a2ui-table-th">
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {props.rows.map((row, i) => (
        <tr key={i}>
          {props.columns.map((c) => (
            <td key={c.key} className="a2ui-table-td">
              {String(row[c.key] ?? '')}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
));
