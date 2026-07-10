'use client';

import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export const ChartApi = {
  name: 'Chart',
  schema: z.object({
    chartType: z
      .enum(['bar', 'line'])
      .describe('Whether to render a bar chart or a line chart.'),
    xKey: z.string().describe('Key in each data row to use for the x-axis.'),
    yKey: z.string().describe('Key in each data row to use for the y-axis.'),
    xLabel: z.string().optional().describe('Optional x-axis label.'),
    yLabel: z.string().optional().describe('Optional y-axis label.'),
    data: z.array(z.record(z.any())).describe('Chart data rows.'),
  }),
} satisfies ComponentApi;

export const Chart = createComponentImplementation(ChartApi, ({ props }) => {
  const { chartType, xKey, yKey, xLabel, yLabel, data } = props;

  return (
    <div className="a2ui-chart" style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xKey} label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -5 } : undefined} />
            <YAxis label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft' } : undefined} />
            <Tooltip />
            <Line type="monotone" dataKey={yKey} stroke="#000000" />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xKey} label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -5 } : undefined} />
            <YAxis label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft' } : undefined} />
            <Tooltip />
            <Bar dataKey={yKey} fill="#000000" />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});
