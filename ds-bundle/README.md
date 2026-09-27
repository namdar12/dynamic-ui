## Rendering model — read this before building anything

`Chart` and `Table` are **not** plain React components. Each is an A2UI
`ReactComponentImplementation` object (`{ name, schema, render }`) meant to be
driven through the A2UI wire protocol, not mounted as `<Chart {...props} />`
directly (that throws "Element type is invalid"). To render one, build a
one-shot surface and mount it via `A2uiSurface`:

```tsx
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { dynamicUiCatalog } from './catalog'; // the Catalog these components are registered in

const processor = new MessageProcessor([dynamicUiCatalog]);
let surface;
processor.onSurfaceCreated((s) => { surface = s; });
processor.processMessages([
  { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: 'dynamic-ui-catalog' } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'main',
      // id: 'root' is required — A2uiSurface always renders the component
      // with that id. Extra keys beyond component/id are the component's
      // own schema props, applied flat (no "properties" wrapper).
      components: [{ id: 'root', component: 'Table', columns, rows }],
    },
  },
]);

// <A2uiSurface surface={surface} />
```

Build one `updateComponents` message per screen; static prop values (arrays,
strings, numbers) go straight on the message object next to `component`/`id`.

## Styling idiom

There is no design-token system, no CSS classes to reuse, and no shared
stylesheet — both components are entirely self-styling via inline `style`
props (there is nothing under `tokens/` or `_ds_bundle.css` to import). Match
their look with the same literal values rather than inventing a new palette:

- **Categorical accent colors** (`Chart`'s bar-per-category / line-per-series
  colors, in order): `#2563eb` (blue), `#f97316` (orange), `#16a34a` (green),
  `#db2777` (pink), `#7c3aed` (violet), `#0891b2` (cyan).
- **Table header**: background `#eef2ff`, text `#312e81`, bottom border
  `#c7d2fe`; body/header cell dividers `#e2e8f0`; container border-radius
  `8px`. Header and body text are center-aligned.
- Font stack: `system-ui, -apple-system, "Segoe UI", sans-serif`.

## API notes

- `Chart.series` is an array (`{ key, label? }[]`) — one entry renders a
  single-color chart (bars still colored per category); 2+ entries render one
  line/bar-group per series, each its own color, plus a legend placed above
  the plot (never at the bottom, to avoid colliding with the x-axis label).
- `Table` columns are click-to-sort (asc → desc → unsorted); sort state is
  internal, not a prop.

## Where the truth lives

Read the actual props from each component's `<Name>.d.ts` in this bundle —
`ChartApi`/`TableApi`'s zod schemas in the source repo are the same contract.
There is no separate stylesheet to consult; the inline styles above are the
whole of it.

# DynamicUiCatalog (frontend@0.1.0)

This design system is the published frontend React library, bundled as a single
browser global. All 2 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.DynamicUiCatalog`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry (tokens and fonts; this DS injects component styles at runtime). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.DynamicUiCatalog.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Chart } = window.DynamicUiCatalog;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Chart />);
```

## Tokens

0 CSS custom properties from frontend. Names are
preserved verbatim from upstream. None detected — this DS may compute styles at runtime (CSS-in-JS).



## Components

### catalog
- `Chart`
- `Table`
