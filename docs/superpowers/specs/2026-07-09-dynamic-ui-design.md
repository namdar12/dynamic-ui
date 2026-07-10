# dynamic-ui: CSV chatbot with A2UI rendering — design

## Summary

A sample app that lets a user ask natural-language questions about a CSV
dataset and get the answer rendered as UI (table, chart, card, list — whatever
fits), not just text. A Python agent reads the CSV, answers via Gemini, and
emits its response as an [A2UI](https://a2ui.org) JSON payload; a Next.js
frontend renders that payload live using the real A2UI React renderer.

## Goals

- Ask a question in a chat UI, get back a rendered answer (table/chart/card/etc.)
  chosen by the agent based on the question and data.
- CSV-backed, domain-agnostic: works for whatever CSV the user provides later,
  not hardcoded to one dataset's columns.
- Simple agent: Gemini via direct `google-genai` calls with tool-calling, no
  Google ADK.
- Uses the A2UI protocol "properly": A2A transport, the real `@a2ui/react` +
  `@a2ui/web_core` renderer packages, a proper catalog (basic catalog +
  custom Table/Chart components).

## Non-goals (v1)

- No follow-up/interactive actions from the rendered UI (no buttons that
  trigger a new agent call, unlike `restaurant_finder`'s booking flow). Each
  question produces a fresh rendered answer; purely display.
- No streaming responses — single-turn, non-streaming request/response per
  question. This is what lets us skip hand-rolling ADK's tool-call loop:
  `google-genai`'s automatic function-calling loop resolves tool calls for us
  in one blocking call. See "Future: streaming" below for the migration path
  and why it's deliberately deferred rather than designed in now.
- No automated test suite (pytest / Vitest+RTL) for v1 — manual smoke test
  only (ask real questions in the browser, confirm the render matches).
- No deployment/containerization concerns — local dev only, same scope as
  the other samples in the A2UI repo.

## Architecture

Two independent local processes, mirroring the `restaurant_finder` +
`samples/client/react/shell` shape in the A2UI monorepo, but backend has no
ADK and frontend is Next.js instead of Vite:

```
dynamic-ui/
  backend/                       # Python, uv-managed, A2A server on uvicorn
    __main__.py                  # entrypoint: builds agent, serves via a2a-sdk + uvicorn
    agent.py                     # DynamicUIAgent: system prompt, Gemini call w/ tool-calling, parses A2UI JSON out
    agent_executor.py            # A2A AgentExecutor — wires agent.py into the A2A request handler
    tools.py                     # CSV query tool(s) exposed to the LLM (pandas-backed)
    csv_store.py                 # loads CSV_PATH into a DataFrame at startup
    catalog/dynamic_ui_catalog.json   # custom catalog: basic catalog + Table (+ Chart) component schemas
    pyproject.toml, .env.example
  frontend/                      # Next.js (App Router), latest version
    app/page.tsx                 # chat UI: input, message list, <A2uiSurface> render area
    app/api/agent/route.ts       # server-side proxy: browser -> A2A agent
    components/catalog/          # custom Table (+ Chart) renderer + createCatalog(...) wiring
    package.json
  README.md                      # top-level: prereqs, .env setup, how to run both
```

Browser talks only to the Next.js server; the Next.js API route proxies to
the Python agent server-side (keeps the agent URL/any secrets off the
client), same pattern as the existing Vite shell's `middleware/a2a.ts`,
ported to a Next.js route handler.

Transport: **A2A protocol** (not AG-UI/CopilotKit) — chosen because this
repo already has a working, verified A2A reference (`restaurant_finder`,
run successfully in this environment), and it lets the frontend use the
actual A2UI-maintained renderer (`@a2ui/react`) directly instead of going
through a third-party runtime.

## Backend

**`csv_store.py`** — loads `CSV_PATH` (env var) into a pandas DataFrame once
at process startup. Fails fast with a clear error (mirroring
`restaurant_finder`'s `MissingAPIKeyError` pattern) if the file is missing
or unparseable.

**`tools.py`** — generic, domain-agnostic functions exposed to the LLM as
callable tools (not hardcoded to any one CSV's columns):
- `describe_columns()` → column names, dtypes, a few sample rows, so the
  model can ground itself in what data actually exists before querying.
- `query_data(filters?, group_by?, sort_by?, limit?)` → runs a constrained
  pandas operation (filter/group/sort/limit) and returns rows as JSON.
  Deliberately not raw `eval`/arbitrary pandas code, both for safety and so
  bad input (e.g. unknown column name) returns a structured error string
  back to the model instead of crashing the request.

**`agent.py`** (`DynamicUIAgent`):
1. Builds the system prompt via the `a2ui_agent` SDK's `A2uiSchemaManager`,
   pointed at the custom catalog (`dynamic_ui_catalog.json`), so the model
   knows what components it may emit and how.
2. Calls Gemini directly via the `google-genai` SDK with the CSV tools
   declared as function-calling tools, using its automatic function-calling
   loop (resolves tool calls without us hand-writing the loop — this is
   what keeps "no ADK" actually simple).
3. The A2UI payload is captured via a dedicated **tool call**, not embedded
   tagged text: an additional tool, `send_a2ui_json_to_client(a2ui_json: str)`,
   is declared alongside the CSV tools in the same `google-genai` tool list.
   This re-implements the mechanism from the SDK's ADK-only
   `a2ui/adk/send_a2ui_to_client_toolset.py` directly against `google-genai`'s
   function-calling (without importing anything ADK-specific, since that
   module is hard-coupled to `google.adk.tools.base_tool`/`base_toolset`):
   the tool handler runs the argument through `a2ui_agent`'s
   `parser.payload_fixer.parse_and_fix()` (JSON healing) and the catalog's
   validator, returning the validated payload. Chosen over the tag
   convention (`<a2ui-json>...</a2ui-json>` + `parser.parse_response`)
   because the tag convention's main benefit — incremental parsing of a
   growing string — only matters for streaming, which v1 doesn't have; the
   tool-call form reuses the same function-calling loop already needed for
   the CSV tools, and keeps conversational text and the UI payload naturally
   separate (the payload only exists when the model actually calls the
   tool).
4. Single-turn, non-streaming: one user message in, one resolved A2UI
   payload out.

**`agent_executor.py`** — implements the A2A `AgentExecutor` interface
(same shape as `restaurant_finder`'s), calling `DynamicUIAgent` and
wrapping the validated A2UI messages (from the `send_a2ui_json_to_client`
tool call) as A2A `DataPart`s via `a2ui_agent`'s `a2a/parts.py`
(`create_a2ui_part`).

**`__main__.py`** — same shape as `restaurant_finder`: click-configurable
host/port, agent card advertising the A2UI v0.9 extension,
`A2AStarletteApplication` + `DefaultRequestHandler` + `InMemoryTaskStore`,
served via uvicorn.

## Frontend

**`app/api/agent/route.ts`** — server-side proxy, the Next.js port of the
Vite shell's `middleware/a2a.ts`. Uses `@a2a-js/sdk`'s
`A2AClient.fromCardUrl('http://localhost:8000/.well-known/agent-card.json', ...)`,
sends the user's message via `message/send` with header
`X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9`, returns the
A2UI parts from the response as JSON. Non-streaming, matching the backend.

**`components/catalog/`** — a custom `Table` component definition via
`createComponentImplementation` (Zod schema + `description` fed into the
backend's catalog/system-prompt), paired with a real React renderer.
Combined with the basic catalog via
`createCatalog(definitions, renderers, {catalogId: 'dynamic-ui', includeBasicCatalog: true})`
so the model can still fall back to `Card`/`List`/`Text` for non-tabular
answers. `Table` is the only custom component in v1 scope — a `Chart`
component (via Recharts) is a stretch addition, not committed: since the
catalog is the trust boundary (the model can only target components we've
registered and described), simply not including `Chart` means the model
will never be told it exists and will fall back to `Table`/`Card`/`List`
for anything that would otherwise be a chart. Adding `Chart` later is
additive — no rework of what's below.

**`app/page.tsx`** — chat UI: text input + running message list (questions +
short agent text acknowledgements), plus a render area holding the live
`<A2uiSurface>`. One `MessageProcessor` instance (`@a2ui/web_core/v0_9`)
constructed with the combined catalog, fed each response via
`processMessages(...)`; `onSurfaceCreated` supplies the surface passed to
`<A2uiSurface surface={surface} />`. Each new question replaces/updates the
current surface — one "current answer" view, not an accumulating scrollback
of past renders.

## Error handling

- **Startup**: missing `GEMINI_API_KEY` or unreadable/missing `CSV_PATH` →
  fail fast with a clear message, before the server binds.
- **Tool errors** (bad column name, empty filter result, etc.): the tool
  returns a structured error/empty-result string back to the model rather
  than raising, so it can rephrase or explain instead of the request
  crashing.
- **No valid A2UI JSON produced**: if the `send_a2ui_json_to_client` tool
  call's argument fails `parse_and_fix`/catalog validation, the tool returns
  a structured error back to the model (same pattern as the SDK's ADK
  toolset), giving it a chance to retry within the same turn. If the model
  never successfully calls the tool at all, the agent falls back to a plain
  `Text` component (basic catalog) carrying the model's raw text or a
  friendly "couldn't render that" message — the UI never receives malformed
  JSON.
- **Agent unreachable from the frontend**: `app/api/agent/route.ts` catches
  connection errors and returns a JSON error response; `page.tsx` shows it
  as an inline error state in the chat, not a raw stack trace or crashed
  page.

## Future: streaming

Not built now — recorded so a later upgrade doesn't require rediscovering
the trade-offs. Deferring is low-risk: none of the pieces below leak into
the CSV tools, catalog, or component-rendering code, which is most of the
actual feature.

What would change, roughly in order of cost:

1. **Frontend — cheap, near no-op.** `MessageProcessor`/`<A2uiSurface>`
   (`@a2ui/web_core`) are already built to consume incremental updates;
   today they're fed one full batch instead of several partial ones.
   Switching just means feeding partial batches as they arrive instead of
   waiting for the full response.
2. **Next.js proxy (`app/api/agent/route.ts`) — moderate.** Swap the
   fetch-await-full-response for relaying an SSE stream from the agent.
   Next.js Route Handlers support streaming response bodies natively; this
   is a restructure of the plumbing, not new logic.
3. **A2A transport (`agent_executor.py`) — moderate.** Swap `message/send`
   for `message/stream`; the executor becomes an async generator/event
   emitter instead of "compute once, return." The `a2a-sdk` already
   supports this (agent cards can advertise `"streaming": true`, as
   `restaurant_finder`'s does).
4. **A2UI payload convention — a deliberate reversion, not additive.** The
   tool-call convention (`send_a2ui_json_to_client`) was chosen *because*
   v1 is non-streaming — a function-call argument arrives as one complete
   blob, not something renderable incrementally. Real streaming benefit
   requires switching back to the tag convention
   (`<a2ui-json>...</a2ui-json>` + `a2ui_agent`'s `parser.parse_response`
   and its streaming parser), which is what the SDK actually built
   incremental parsing support for. This is a narrow, contained swap (the
   tool declaration + a prompt-instruction change), not a rewrite, but it
   is undoing today's choice rather than building on top of it.
5. **Backend agent loop (`agent.py`) — the expensive part.**
   `google-genai`'s automatic function-calling helper is a blocking
   round-trip wrapper and doesn't compose with streaming. Going streaming
   means hand-writing the loop: stream chunks, detect function-call parts,
   execute the tool, feed the result back in, continue streaming. This is
   genuinely new code — it's the complexity Google ADK would otherwise
   absorb, and it's the main reason "add streaming" isn't a small change
   despite items 1–3 being fairly contained.

Net: fine to wait. Revisit if the demo feels laggy or a token-by-token
"typing" effect becomes a real requirement — not before.

## Testing

Skipped for v1 per explicit scope decision — no pytest suite, no
Vitest/RTL component tests, no recording script. Verification is a manual
smoke test: run both processes, ask real questions in the browser, confirm
the rendered UI matches what was asked.
