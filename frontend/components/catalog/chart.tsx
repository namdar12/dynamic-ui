'use client';

import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
    series: z
      .array(
        z.object({
          key: z.string().describe('Key in each data row holding this series’ value.'),
          label: z.string().optional().describe('Legend label for this series (defaults to the key).'),
        }),
      )
      .min(1)
      .describe('One or more series to plot. Each gets its own solid color; 2+ series show a legend.'),
    xLabel: z.string().optional().describe('Optional x-axis label.'),
    yLabel: z.string().optional().describe('Optional y-axis label.'),
    data: z.array(z.record(z.any())).describe('Chart data rows.'),
  }),
} satisfies ComponentApi;

// One solid color per series/category — a single bar series still reads as
// multi-color (one color per category), while a single line stays one
// consistent color; 2+ series pick up the palette in order.
const PALETTE = ['#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2'];

export const Chart = createComponentImplementation(ChartApi, ({ props }) => {
  const { chartType, xKey, series, xLabel, yLabel, data } = props;
  const multiSeries = series.length > 1;
  // insideLeft sits the label directly on top of the tick numbers; moving it
  // outside the axis (with matching left margin + axis width) is what keeps
  // the two from overlapping.
  const yAxisLabel = yLabel
    ? { value: yLabel, angle: -90, position: 'left' as const, style: { textAnchor: 'middle' as const } }
    : undefined;
  const xAxisLabel = xLabel ? { value: xLabel, position: 'insideBottom' as const, offset: -12 } : undefined;
  // The legend renders above the plot (verticalAlign="top") so it never
  // competes with the x-axis label/ticks for the same bottom margin space.
  const margin = { top: multiSeries ? 28 : 12, right: 24, left: yLabel ? 12 : 0, bottom: xLabel ? 20 : 0 };

  return (
    <div className="a2ui-chart" style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'line' ? (
          <LineChart data={data} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} label={xAxisLabel} />
            <YAxis tick={{ fontSize: 12 }} width={yLabel ? 68 : 40} label={yAxisLabel} />
            <Tooltip />
            {multiSeries && <Legend verticalAlign="top" height={28} />}
            {series.map((s, i) => {
              const color = PALETTE[i % PALETTE.length];
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 0, fill: color }}
                  activeDot={{ r: 6 }}
                />
              );
            })}
          </LineChart>
        ) : (
          <BarChart data={data} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} label={xAxisLabel} />
            <YAxis tick={{ fontSize: 12 }} width={yLabel ? 68 : 40} label={yAxisLabel} />
            <Tooltip />
            {multiSeries && <Legend verticalAlign="top" height={28} />}
            {multiSeries ? (
              series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
              ))
            ) : (
              <Bar dataKey={series[0].key} radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            )}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});
