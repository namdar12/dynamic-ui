'use client';

import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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

// One color per series, never per category: a single series is all accent
// blue, so color only ever means "which series". Blue and orange lead because
// they stay distinguishable for red-green color blindness.
const PALETTE = ['#2563eb', '#ea580c', '#0d9488', '#db2777', '#7c3aed', '#65a30d'];

const MONO = 'var(--font-geist-mono), ui-monospace, Menlo, monospace';
const TICK = { fontSize: 11, fill: '#71717a', fontFamily: MONO };
const CATEGORY_TICK = { fontSize: 13, fill: '#52525b' };
const TOOLTIP_STYLE = {
  border: '1px solid #e4e4e7',
  borderRadius: 8,
  boxShadow: 'none',
  fontSize: 13,
  fontFamily: MONO,
};

const formatValue = (v: unknown) =>
  typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v ?? '');

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
  // Top margin leaves room for the legend (2+ series) or the value labels
  // printed above single-series bars.
  const margin = {
    top: multiSeries ? 28 : chartType === 'bar' ? 24 : 12,
    right: 24,
    left: yLabel ? 12 : 0,
    bottom: xLabel ? 20 : 0,
  };
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />;
  const xAxis = (
    <XAxis dataKey={xKey} tick={CATEGORY_TICK} tickLine={false} axisLine={{ stroke: '#d4d4d8' }} label={xAxisLabel} />
  );
  const yAxis = (
    <YAxis
      tick={TICK}
      tickLine={false}
      axisLine={false}
      tickFormatter={formatValue}
      width={yLabel ? 76 : 48}
      label={yAxisLabel}
    />
  );
  const tooltip = <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatValue} cursor={{ fill: '#f4f4f5' }} />;
  const legend = multiSeries && <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 13 }} />;

  return (
    <div className="a2ui-chart" style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'line' ? (
          <LineChart data={data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {legend}
            {series.map((s, i) => {
              const color = PALETTE[i % PALETTE.length];
              return (
                <Line
                  key={s.key}
                  type="linear"
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
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {legend}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label ?? s.key}
                fill={PALETTE[i % PALETTE.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={104}
              >
                {!multiSeries && (
                  <LabelList
                    dataKey={s.key}
                    position="top"
                    formatter={formatValue}
                    style={{ fontSize: 12, fill: '#18181b', fontFamily: MONO }}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});
