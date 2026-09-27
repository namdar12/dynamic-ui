import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from '../../frontend/components/catalog/catalog';

// Chart is driven entirely through the A2UI wire protocol (see
// frontend/app/page.tsx) — there is no plain `<Chart {...props} />` JSX
// form, so previews build a one-shot surface the same way the real backend
// agent does, then render it via A2uiSurface.
function surfaceFor(root: Record<string, unknown>) {
  const processor = new MessageProcessor([dynamicUiCatalog]);
  let surface: ReturnType<typeof processor.model.getSurface> = undefined;
  processor.onSurfaceCreated((s) => {
    surface = s;
  });
  processor.processMessages([
    { version: 'v0.9', createSurface: { surfaceId: 'preview', catalogId: 'dynamic-ui-catalog' } },
    { version: 'v0.9', updateComponents: { surfaceId: 'preview', components: [root] } },
  ]);
  return surface;
}

const barSurface = surfaceFor({
  id: 'root',
  component: 'Chart',
  chartType: 'bar',
  xKey: 'region',
  series: [{ key: 'revenue', label: 'Revenue' }],
  xLabel: 'Region',
  yLabel: 'Revenue (USD)',
  data: [
    { region: 'North America', revenue: 182000 },
    { region: 'Europe', revenue: 143500 },
    { region: 'Asia Pacific', revenue: 96200 },
    { region: 'Latin America', revenue: 41800 },
  ],
});

const lineSurface = surfaceFor({
  id: 'root',
  component: 'Chart',
  chartType: 'line',
  xKey: 'month',
  series: [{ key: 'users', label: 'Monthly active users' }],
  xLabel: 'Month',
  yLabel: 'Monthly active users',
  data: [
    { month: 'Jan', users: 12400 },
    { month: 'Feb', users: 13850 },
    { month: 'Mar', users: 15100 },
    { month: 'Apr', users: 14700 },
    { month: 'May', users: 16800 },
    { month: 'Jun', users: 18950 },
  ],
});

// Demonstrates multi-series: each line gets its own solid color plus a legend.
const multiLineSurface = surfaceFor({
  id: 'root',
  component: 'Chart',
  chartType: 'line',
  xKey: 'month',
  series: [
    { key: 'web', label: 'Web' },
    { key: 'mobile', label: 'Mobile' },
  ],
  xLabel: 'Month',
  yLabel: 'Active users',
  data: [
    { month: 'Jan', web: 8400, mobile: 4000 },
    { month: 'Feb', web: 8850, mobile: 5000 },
    { month: 'Mar', web: 9100, mobile: 6000 },
    { month: 'Apr', web: 8700, mobile: 6000 },
    { month: 'May', web: 9800, mobile: 7000 },
    { month: 'Jun', web: 10950, mobile: 8000 },
  ],
});

export function BarChart() {
  return barSurface ? <A2uiSurface surface={barSurface} /> : null;
}

export function LineChart() {
  return lineSurface ? <A2uiSurface surface={lineSurface} /> : null;
}

export function MultiLineChart() {
  return multiLineSurface ? <A2uiSurface surface={multiLineSurface} /> : null;
}
