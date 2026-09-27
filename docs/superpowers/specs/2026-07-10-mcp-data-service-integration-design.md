# dynamic-ui: MCP data-service integration — design

- Status: implemented (2026-07-10)
- Supersedes: `2026-07-09-dynamic-ui-design.md` (CSV-backed design)

## Context

The original dynamic-ui design answered questions over a local CSV file. This
design replaces the CSV data source with a live connection to an MCP data
service — a data-access layer that projects a relational schema as a live MCP
server, where every read/write operation is an MCP tool auto-generated from
the schema. The agent answers questions using real relational data instead of
a flat file, and the service stays swappable: any MCP server exposing the same
discovery convention works.

## Goal

`DynamicUIAgent` opens a persistent MCP `ClientSession` to the data service at
backend startup, discovers its tools via `list_tools()`, and answers questions
through a hand-rolled Gemini tool-calling loop — no Google ADK. The frontend
and the A2A contract are unaffected.

## Architecture & design

### Backend: `DynamicUIAgent` (persistent MCP session)

- At startup, `__main__.py`'s Starlette lifespan hook opens the MCP session
  inside an `AsyncExitStack` (kept alive for the process lifetime):
  `streamablehttp_client(MCP_DATA_URL)` → `ClientSession` → `initialize()`.
- `DynamicUIAgent.connect()` then calls `list_tools()` and converts every
  discovered MCP tool's JSON Schema into a Gemini `FunctionDeclaration` via
  the public `parameters_json_schema` field. A `send_a2ui_json_to_client`
  declaration is appended for UI emission.
- `answer()` becomes `async` but keeps its return contract:
  `(reply_text, a2ui_messages_or_None)`.

### Tool discovery: the `describe_query` convention

The system prompt names exactly one tool: `describe_query`. Called with an
entity name, it returns that entity's fields and its query grammar (filter
syntax, sort, limit, joins). The model's workflow is: call `describe_query`
on the relevant entity/entities first, then call the appropriate discovered
`query_*`/CRUD tool(s). Entity names are never hardcoded in the agent — the
data service can evolve its schema without code changes here.

### MCP ↔ Gemini bridge (manual dispatch)

`google-genai`'s automatic function calling is explicitly disabled
(`AutomaticFunctionCallingConfig(disable=True)`). Rationale: `generate_content`
unconditionally deep-copies the request config, and a live MCP `ClientSession`
holds an unpicklable `asyncio.Future` — passing the session to automatic
dispatch crashes. Converting each MCP tool schema to a plain
`FunctionDeclaration` and routing `call_tool(name, args)` ourselves sidesteps
this; verified against a running MCP data service before committing to the
design. Only the public `parameters_json_schema` field is used for conversion.

A safety cap (`MAX_TOOL_TURNS = 8`) bounds the loop in case the model never
converges to a final answer.

### A2UI capture (unchanged)

The model renders its answer by calling `send_a2ui_json_to_client` exactly
once with an A2UI JSON array string. The agent parses it (`parse_and_fix`),
validates it against `backend/catalog/dynamic_ui_catalog.json`, and returns it
alongside a brief one-sentence conversational reply. Validation failures are
returned to the model as tool errors so it can retry.

### Frontend (unchanged)

The Next.js app proxies questions through `app/api/agent/route.ts` to the
backend over A2A (non-streaming, single-turn) and renders returned `DataPart`s
with `@a2ui/react` v0.9. No frontend changes were needed for this integration.

## Error handling

- Data service unreachable at startup → the Starlette lifespan hook fails
  loudly and the backend refuses to serve (fail fast, no silent fallback to
  stale data).
- Mid-loop tool failure → returned to the model as an error payload; the loop
  continues until `MAX_TOOL_TURNS`.
- Unparseable filter / unknown entity → the data service returns an error,
  surfaced to the model the same way.

## Open questions (resolved during implementation)

- Manual vs. automatic function calling → manual, due to the deep-copy crash
  documented above.
- Session lifetime → one persistent session per backend process, owned by the
  lifespan `AsyncExitStack`.
- Schema evolution → handled by `describe_query` + dynamic discovery; no
  per-entity code in the agent.

## Testing strategy

No automated test suite (project-wide decision). Every change is verified by
running the real stack — mock or real MCP data service on `:8001`, backend on
`:8000`, frontend on `:3000` — and checking real output. See the implementation
plan's verification steps.

## References

- `docs/superpowers/specs/2026-07-09-dynamic-ui-design.md` — original CSV design
- `docs/superpowers/plans/2026-07-10-mcp-data-service-integration.md` — implementation plan
- `mock-data/` — synthetic MCP data server implementing the `describe_query` + `query_*` convention
