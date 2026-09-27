import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from '../../frontend/components/catalog/catalog';

// Table is driven entirely through the A2UI wire protocol (see
// frontend/app/page.tsx) — there is no plain `<Table {...props} />` JSX
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

const topProductsSurface = surfaceFor({
  id: 'root',
  component: 'Table',
  columns: [
    { key: 'product', label: 'Product' },
    { key: 'unitsSold', label: 'Units sold' },
    { key: 'revenue', label: 'Revenue' },
  ],
  rows: [
    { product: 'Wireless Headphones', unitsSold: 1240, revenue: '$86,800' },
    { product: 'Smart Watch', unitsSold: 890, revenue: '$142,400' },
    { product: 'USB-C Hub', unitsSold: 2310, revenue: '$46,200' },
    { product: 'Mechanical Keyboard', unitsSold: 560, revenue: '$78,400' },
  ],
});

// Mirrors this app's real use: the agent answers a natural-language data
// question by rendering a Table surface for the result set.
const queryResultSurface = surfaceFor({
  id: 'root',
  component: 'Table',
  columns: [
    { key: 'city', label: 'City' },
    { key: 'signups', label: 'Signups' },
  ],
  rows: [
    { city: 'Austin', signups: 412 },
    { city: 'Seattle', signups: 375 },
    { city: 'Denver', signups: 298 },
  ],
});

export function TopProducts() {
  return topProductsSurface ? <A2uiSurface surface={topProductsSurface} /> : null;
}

export function QueryResult() {
  return queryResultSurface ? <A2uiSurface surface={queryResultSurface} /> : null;
}
