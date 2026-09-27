# frontend — Dynamic UI chat (Next.js)

Chat UI that talks to the Python agent over A2A and renders the returned A2UI
payloads with the official `@a2ui/react` renderer (v0.9).

- `app/page.tsx` — chat UI with a live `@a2ui/react` surface.
- `app/api/agent/route.ts` — server-side proxy: sends the question to the
  backend over A2A (non-streaming, single-turn), returns text + A2UI messages.
- `components/catalog/` — the `dynamic-ui-catalog` (`Table`, `Chart` plus the
  basic catalog) registered for rendering.

## Run

```bash
cd frontend
npm install
npm run dev              # http://localhost:3000
```

Expects the backend on `http://localhost:8000` (see `app/api/agent/route.ts`).
