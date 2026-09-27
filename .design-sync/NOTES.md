# design-sync notes for dynamic-ui/frontend

- Scope: only `frontend/components/catalog/{chart,table}.tsx` are synced.
  `basicCatalog` (re-exported from `@a2ui/react`'s `catalog.ts`) is a
  third-party package, deliberately excluded — user's call, see chat history.
- `frontend` has no publishable dist/`.d.ts` (it's a Next.js app, not a
  component library) — `cfg.entry` points at a small synthetic re-export shim,
  `frontend/.design-sync-entry.tsx` (`export { Table } from ...; export
  { Chart } from ...;`). It exists only for the converter's entry-detection
  walk (needs a `package.json` with a `name` up its directory tree); it is not
  part of the app and can be freely regenerated if deleted.
- `--node-modules` must point at `frontend/node_modules` (real deps live
  there, not at the repo root) — this is why `cfg.entry` (not
  `join(--node-modules, cfg.pkg)`) is what resolves `PKG_DIR` to `frontend/`.
- **Rendering model** (also in `.design-sync/conventions.md`, prepended to the
  README): `Chart`/`Table` are A2UI `ReactComponentImplementation` objects,
  not plain React components — they only render through
  `MessageProcessor` + `A2uiSurface`, never `<Chart {...props} />` directly.
  Discovered because the first preview attempt (direct JSX) failed with
  "Element type is invalid: ... got: object". Previews build a one-shot
  surface via the real wire protocol (`.design-sync/previews/{Chart,Table}.tsx`).
- No CSS exists anywhere for `a2ui-table`/`a2ui-chart` — confirmed with the
  user (chose "sync as-is" initially). `Table` and `Chart` both now
  self-style via inline `style` props (added per user request: bordered
  rows/columns, colored centered Table headers, multi-color Chart
  bars/lines) rather than depending on a class defined elsewhere — there is
  still no reachable stylesheet in any context (this app's Tailwind build
  isn't a static file we can point `cfg.cssEntry` at; a design-sync preview
  gets none of it either way).
- `cfg.overrides.Chart.cardMode: "column"` — Chart's stories render wider
  than a multi-column grid cell (`[GRID_OVERFLOW]`); full-width column cards
  fixes it.
- **Chart schema changed mid-project**: `yKey: string` → `series: {key,
  label?}[]` (supports multiple distinctly-colored lines/bar-groups, per user
  request). `backend/catalog/dynamic_ui_catalog.json` (a hand-maintained JSON
  Schema mirror the Python agent reads, loaded by `backend/agent.py`) was
  updated to match in the same session — **if the frontend schema changes
  again, that file needs a matching edit or the real running app breaks**
  (agent and frontend would disagree on the Chart contract). This
  cross-repo coupling isn't something design-sync can detect on its own.
- Known render warns: none currently recorded.

## Re-sync risks

- The backend/frontend schema coupling above is the biggest one — re-verify
  `backend/catalog/dynamic_ui_catalog.json` still matches
  `ChartApi`/`TableApi` any time either component's schema changes.
- The synthetic entry file (`frontend/.design-sync-entry.tsx`) needs updating
  if a component is added to/removed from the sync scope (`cfg.componentSrcMap`).
- Playwright/Chromium were freshly installed into `.ds-sync/node_modules` this
  run (none was cached before) — a clean machine will need it reinstalled or
  will hit `[RENDER_SKIPPED]`.
- The auto-generated README boilerplate below the conventions header still
  shows a generic `ReactDOM.createRoot(...).render(<Chart />)` snippet, which
  contradicts the header's explicit warning against mounting `Chart` directly.
  The header takes precedence (it says so explicitly) but this is a known,
  unresolved tension in the generated output — not something to "fix" by
  editing generated boilerplate.
