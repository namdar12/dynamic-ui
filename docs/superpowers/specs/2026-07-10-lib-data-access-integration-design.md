# dynamic-ui: lib-data-access integration — design

## Summary

Replaces `dynamic-ui`'s CSV-backed data source with a live connection to
[lib-data-access](/Users/namdarmesri/Companies/E360/ep/lib-data-access), a
sibling DDL-first data-access library that projects a Postgres-backed
schema as both REST and a live MCP server (every read/write operation is
an MCP tool, auto-generated from the schema). This supersedes the CSV
data-source design in
`2026-07-09-dynamic-ui-design.md` — the agent no longer reads a flat file;
it queries real relational data (with joins, typed CRUD, and an
OData-style query grammar) through `lib-data-access`'s MCP endpoint.

Nothing about A2UI rendering changes: the catalog (`Table`/`Chart`),
`agent_executor.py`'s A2A wire format, and the entire Next.js frontend are
unaffected — they only depend on `DynamicUIAgent.answer()`'s existing
`(text, a2ui_messages)` contract, which this design preserves.

## Context established before this design

- `lib-data-access` is running locally: Postgres (Docker) → `schema.sql`
  (tax-incentives domain: `vendor`, `gl_line`, `rule_exception`) →
  `lib-data-access gen` → generated SQLAlchemy models/DTOs/registry →
  `DataService.from_registry(...)` serving REST + a live MCP server on
  `http://localhost:8001/mcp/` (moved off `:8000` to avoid colliding with
  `dynamic-ui`'s own backend, which stays on `:8000`).
- Two real bugs were found and fixed in `lib-data-access` itself to get it
  running: a stale path-dependency mismatch in its `pyproject.toml`
  (`../../template/...` → `../...`, matching where the sibling repos
  actually live), and a missing `psycopg2-binary` dependency needed by its
  codegen step (added to the `codegen` dependency group).
- **A real `google-genai` limitation was found and worked around.** The
  documented pattern — pass a live `mcp.ClientSession` directly into
  `GenerateContentConfig.tools` and let automatic function calling handle
  it — crashes: `generate_content` unconditionally deep-copies the config
  before dispatch, and a live session contains an unpicklable
  `asyncio.Future`, producing `TypeError: cannot pickle '_asyncio.Future'
  object`. The declarative alternative, `types.McpServer(streamable_http_transport=...)`,
  doesn't crash but silently does nothing for a local server — that path
  is gated behind Vertex AI's server-side tool infrastructure (Google's
  own backend connects to the URL, which can't reach `localhost`).
- **The working alternative — a hand-rolled tool-calling loop — is
  verified end-to-end against the real running `lib-data-access` server**,
  not just a toy stand-in: MCP tool discovery, schema conversion via the
  public `FunctionDeclaration.parameters_json_schema` field (no dependency
  on `google-genai`'s private `_mcp_utils` internals), a manual multi-turn
  loop, and correct final answers from real Postgres data, including
  parallel tool calls in a single turn and complex generated schemas
  (nested `$defs`, `anyOf` unions) that a simple stand-in tool wouldn't
  have exercised.

## Goals

- `dynamic-ui`'s agent answers questions using `lib-data-access`'s live
  data instead of a CSV file — real relational data, real CRUD, real
  OData-style filtering, via the auto-generated MCP tools.
- No change to the A2UI rendering pipeline: same catalog, same wire
  format, same frontend.
- Fail fast and loudly if the MCP server is unreachable at startup, same
  philosophy as the CSV-missing case it replaces.

## Non-goals

- No changes to `lib-data-access` beyond what was already needed to get
  it running (the two bug fixes above) — this design doesn't extend or
  modify its generated tools, schema, or seeded data.
- No changes to the frontend, the catalog, or `agent_executor.py`'s wire
  format.
- Still no automated test suite (unchanged project-wide decision from the
  original spec) — verification is the same "run it, ask real questions,
  confirm the answer" pattern used throughout this project, now against
  real Postgres data instead of the CSV fixture.
- No support for switching between CSV and `lib-data-access` at runtime —
  this is a full replacement, not a configurable choice.

## Architecture

```
backend/
  agent.py           # rewritten: opens/holds the MCP session, manual tool-calling loop
  agent_executor.py  # one-line change: await agent.answer(query) (already an async fn)
  __main__.py        # adds a Starlette lifespan hook to open/close the MCP session
  csv_store.py        # deleted
  tools.py             # deleted
  catalog/             # unchanged
  .env                  # CSV_PATH replaced with LIB_DATA_ACCESS_MCP_URL
```

Two independent local processes, as before, plus `lib-data-access` as a
third (already running, out of scope to change): `dynamic-ui`'s backend
(`:8000`) now depends on `lib-data-access`'s MCP endpoint (`:8001/mcp/`)
at runtime instead of a local CSV file.

## Backend

### `agent.py` — the core rewrite

1. **Startup** (`DynamicUIAgent.__init__`): unchanged in shape — builds
   the catalog, agent card, and the `send_a2ui_json_to_client` tool
   declaration. No DB/MCP connection happens here — an async session
   can't be opened synchronously during this constructor.

   **The system prompt's `workflow_description` must stop naming specific
   tools.** Today it hardcodes `"call describe_columns and/or query_data
   as needed"` — those tools no longer exist. The available tools are now
   discovered dynamically from `lib-data-access` at `connect()` time and
   aren't known when `_build_system_prompt()` runs, so the text must be
   generic: point the model at `describe_query` (one of
   `lib-data-access`'s generated tools, whose own description is exactly
   "Describe how to query an entity... call this before composing a
   filter/apply") as the schema-discovery entry point, without naming any
   other tool. This mirrors how `describe_columns` was the CSV version's
   discovery step — same role, dynamically-provided tool.
2. **`async def connect(self, stack: contextlib.AsyncExitStack)`** —
   called once from the app's lifespan hook. Opens
   `streamablehttp_client(mcp_url)` and `ClientSession`, both entered via
   the passed `AsyncExitStack` so they live for the server's whole
   lifetime and close cleanly on shutdown (mirrors the verified spike's
   `async with streamablehttp_client(...) as (...): async with
   ClientSession(...) as session:`, just spanning the app's lifetime
   instead of one function call). Calls `session.initialize()` then
   `session.list_tools()`, converts each MCP tool to a
   `types.FunctionDeclaration(name=t.name, description=t.description,
   parameters_json_schema=t.inputSchema)`, and stores the session plus the
   combined tool list (MCP-sourced + `send_a2ui_json_to_client`) on
   `self`.
3. **`async def answer(self, query: str) -> tuple[str, Optional[list[dict]]]`**
   (now async) — the manual multi-turn loop verified in the spike:
   `automatic_function_calling` disabled, call
   `client.aio.models.generate_content(...)`, inspect the response for
   `function_call` parts, route each requested call to
   `self._session.call_tool(name, args)` if it's MCP-sourced or to the
   local `send_a2ui_json_to_client` handler otherwise, wrap each result as
   a `types.Part.from_function_response(...)`, append to `contents`, and
   repeat until the model returns a turn with no function calls. Same
   return contract as today — nothing downstream needs to know the loop
   changed.

### `agent_executor.py`

One-line change: `text, a2ui_messages = await self._agent.answer(query)`.
`execute()` is already `async def` per the A2A framework, so this is not
a sync/async boundary change — just adding the `await`.

### `__main__.py`

Adds:
```python
@asynccontextmanager
async def lifespan(app):
    async with AsyncExitStack() as stack:
        await agent.connect(stack)
        yield
```
passed to `server.build(lifespan=lifespan)` (confirmed `build()` forwards
`**kwargs` to Starlette's constructor, which natively supports
`lifespan`). The old `CSV_PATH`/`load_dataframe` fail-fast check is
replaced by requiring `LIB_DATA_ACCESS_MCP_URL` to be set; a connection
failure inside `agent.connect()` during lifespan startup crashes the
process loudly rather than serving a broken agent — same philosophy as
the CSV-missing case, applied to the new dependency.

## Error handling

- **Startup**: `LIB_DATA_ACCESS_MCP_URL` unset, or the MCP server
  unreachable during `agent.connect()` → crash loudly before the server
  binds. Same fail-fast pattern as the original CSV-missing case.
- **A tool call fails mid-conversation** (e.g. `lib-data-access` returns
  one of its normalized errors — a `not_found` category, a validation
  failure): the error is fed back as that function call's response
  (`types.Part.from_function_response(name=..., response={"error": ...})`)
  so the model can explain or retry, rather than the request crashing.
  This mirrors `lib-data-access`'s own design (`ErrorCategory`-mapped,
  `INTERNAL` never leaks the underlying cause) and the "tools never raise"
  philosophy already established for the CSV tools this replaces.
- **No valid A2UI payload produced, frontend proxy errors**: unchanged —
  still handled at the `agent_executor.py`/`route.ts`/`page.tsx` layers
  exactly as before.

## Testing

Unchanged from the original spec's decision: no automated test suite.
Verification is running both processes and asking real questions against
the real `lib-data-access`-backed data (e.g. "list all vendors", "which GL
lines are over $1000", "show me GL lines for a specific vendor with their
rule exceptions" — exercising `$expand`/joins, which the CSV-backed
version never had), confirming both the answer's correctness and that a
sensible A2UI component renders.
