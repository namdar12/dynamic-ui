'use client';

import { z } from 'zod';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toNumber } from './table';

export const ChartApi = {
  name: 'Chart',
  schema: z.object({
    chartType: z
      .enum(['bar', 'line', 'pie'])
      .describe('Bar or line chart, or a pie (donut) of one series as shares of a whole.'),
    xKey: z.string().describe('Key in each data row to use for the x-axis.'),
    series: z
      .array(
        z.object({
          key: z.string().describe('Key in each data row holding this series’ value.'),
          label: z.string().optional().describe('Legend label for this series (defaults to the key).'),
        }),
      )
      .min(1)
      .max(5)
      .describe('One to five series to plot. Each gets its own solid color; 2+ series show a legend.'),
    xLabel: z.string().optional().describe('Optional x-axis label.'),
    yLabel: z.string().optional().describe('Optional y-axis label.'),
    data: z.array(z.record(z.any())).describe('Chart data rows.'),
  }),
} satisfies ComponentApi;

// One palette for every chart: a color per series in bar/line, a color per
// slice in pie. Validated with the dataviz checker on every pair, not just
// neighbors, since a pie's slices and a legend's series can be compared in any
// combination (validate_palette.js --pairs all: CVD ΔE >= 11.7, normal vision
// ΔE >= 19.9). Blue and orange lead because they stay apart under red-green
// color blindness. No sixth hue passes alongside these, so colors never cycle:
// charts take at most five series, and a pie folds extra slices into "Other".
const PALETTE = ['#2563eb', '#ea580c', '#0d9488', '#854d0e', '#86198f'];
const PIE_OTHER = '#a1a1aa';

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

type Slice = { name: string; value: number; color: string };

// Slices keep the data's order, so a category's color follows the category
// rather than its rank. Past PALETTE.length, the largest slices stay and
// the rest fold into one gray "Other" at the end.
function pieSlices(data: Record<string, unknown>[], xKey: string, valueKey: string): Slice[] {
  const rows = data
    .map((row) => ({ name: String(row[xKey] ?? ''), value: toNumber(row[valueKey]) ?? 0 }))
    .filter((row) => row.value > 0);
  if (rows.length <= PALETTE.length) {
    return rows.map((row, i) => ({ ...row, color: PALETTE[i] }));
  }
  const keep = new Set(
    [...rows].sort((a, b) => b.value - a.value).slice(0, PALETTE.length).map((row) => row.name),
  );
  const kept = rows.filter((row) => keep.has(row.name));
  const rest = rows.filter((row) => !keep.has(row.name));
  return [
    ...kept.map((row, i) => ({ ...row, color: PALETTE[i] })),
    {
      name: `Other (${rest.length})`,
      value: rest.reduce((sum, row) => sum + row.value, 0),
      color: PIE_OTHER,
    },
  ];
}

// A donut with the total in its hole, beside a legend that names every slice
// with its value and share, so no slice is identified by color alone.
function PieView({ slices, label }: { slices: Slice[]; label?: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const share = (value: number) => `${((value / total) * 100).toFixed(value / total < 0.1 ? 1 : 0)}%`;
  return (
    <div className="a2ui-chart" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 32 }}>
      <div style={{ position: 'relative', width: 220, height: 220, flex: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="#ffffff"
              strokeWidth={2}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatValue} />
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 600, color: '#18181b', fontFamily: MONO }}>
            {formatValue(total)}
          </span>
          {label && <span style={{ fontSize: 12, color: '#71717a' }}>{label}</span>}
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 200px', maxWidth: 340 }}>
        {slices.map((s) => (
          <li key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#18181b' }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
            <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#52525b' }}>{formatValue(s.value)}</span>
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#71717a', width: 48, textAlign: 'right' }}>
              {share(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const Chart = createComponentImplementation(ChartApi, ({ props }) => {
  const { chartType, xKey, series, xLabel, yLabel, data } = props;
  if (chartType === 'pie') {
    // One series only: the slices are its values, named by xKey.
    return <PieView slices={pieSlices(data, xKey, series[0].key)} label={series[0].label} />;
  }
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
              const color = PALETTE[i];
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
                fill={PALETTE[i]}
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
